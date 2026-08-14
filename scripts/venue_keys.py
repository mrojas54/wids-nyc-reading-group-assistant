"""Compare a Google Calendar event's `location` against `meetings.location`.

Called by `scheduled_tasks/calendar-rsvp-sync.md` (Step 4b, the daily detector)
and `scheduled_tasks/pre-meeting-reminder.md` (Step 1b, the pre-send gate).
Both need the *same* answer — a venue the sync calls "in sync" and the reminder
calls "drift" would hold every send forever — so the comparison lives here as
one tested function rather than as a normalization recipe each task re-derives
by hand at runtime.

Background, worked example, and the resolution workflow: `docs/venue-drift.md`.

The problem in one line: both sides start as the same operator-typed string
(`/wids-schedule-reading-group` writes the venue to `meetings.location` and to
the Calendar event), but editing the venue in Google's UI replaces its copy
with a place record —

    Prince Tea House - Ktown, 324 5th Ave, New York, NY 10001            (DB)
    Prince Tea House Ktown | Dessert Spot at Fifth Ave, 324 5th Ave,
        New York, NY 10001, USA                                    (Calendar)

— so `!=` fires on a venue that has not moved. Splitting each string into a
*name key* and an *address key* separates the noise (Google's chosen place
name, its `|` tagline, the `, USA`) from the signal (the street address, which
is what determines where a member actually goes).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime

__all__ = [
    "VenueComparison",
    "address_key",
    "classify",
    "drift_slug",
    "name_key",
    "tidy",
]

_COUNTRY_FIELDS = frozenset({"usa", "us", "united states", "united states of america"})

# Both sides are normalized with the same map, so fidelity to postal standards
# matters less than consistency: "north" and "n" must simply land together.
_TOKEN_CANON = {
    "avenue": "ave",
    "street": "st",
    "road": "rd",
    "boulevard": "blvd",
    "drive": "dr",
    "lane": "ln",
    "court": "ct",
    "place": "pl",
    "square": "sq",
    "terrace": "ter",
    "highway": "hwy",
    "parkway": "pkwy",
    "suite": "ste",
    "floor": "fl",
    "apartment": "apt",
    "north": "n",
    "south": "s",
    "east": "e",
    "west": "w",
}

# Deleted rather than spaced, so "Jack's" → "jacks" and not "jack s".
_ELIDED = re.compile(r"[’‘'`]")
_NON_ALNUM = re.compile(r"[^a-z0-9]+")


def _fields(location: str | None) -> list[str]:
    """Comma-separated fields, trimmed, empties and a trailing country dropped."""
    if not location:
        return []
    fields = [f.strip() for f in location.split(",")]
    fields = [f for f in fields if f]
    while fields and _NON_ALNUM.sub(" ", fields[-1].lower()).strip() in _COUNTRY_FIELDS:
        fields.pop()
    return fields


def _normalize(text: str) -> str:
    return _NON_ALNUM.sub(" ", _ELIDED.sub("", text.lower())).strip()


def name_key(location: str | None) -> str:
    """The venue name, stripped to comparable form.

    Field 0 up to the first `|` — Google appends a category tagline there
    ("Prince Tea House Ktown | Dessert Spot at Fifth Ave").
    """
    fields = _fields(location)
    if not fields:
        return ""
    return " ".join(_normalize(fields[0].split("|", 1)[0]).split())


def address_key(location: str | None) -> str:
    """Everything after the venue name, canonicalized to comparable form.

    Empty when the location is a bare venue name with no street address —
    `classify` falls back to a whole-string comparison in that case.
    """
    fields = _fields(location)
    if len(fields) < 2:
        return ""
    tokens = _normalize(" ".join(fields[1:])).split()
    return " ".join(_TOKEN_CANON.get(t, t) for t in tokens)


def tidy(location: str | None) -> str:
    """Google's raw string with its two worst artifacts removed.

    Drops the `|` tagline and the trailing country, preserving original casing.
    NOT the house convention: `<Name> - <Neighborhood>, <Street>, …` needs a
    dash before a neighborhood that Google's string never identifies as one, so
    this is a starting point for the operator, never something to write over an
    existing venue. See `docs/venue-drift.md`.
    """
    fields = _fields(location)
    if not fields:
        return ""
    return ", ".join([fields[0].split("|", 1)[0].strip(), *fields[1:]])


@dataclass(frozen=True)
class VenueComparison:
    """Verdict plus every input that produced it, for `command_log.metadata`."""

    classification: str
    writable: bool
    alertable: bool
    db_name_key: str
    db_address_key: str
    calendar_name_key: str
    calendar_address_key: str
    suggested_location: str


def classify(
    db_location: str | None,
    calendar_location: str | None,
    *,
    meeting_updated_at: datetime | None = None,
    event_updated: datetime | None = None,
) -> VenueComparison:
    """Compare the two venues and say what the caller may do about it.

    Classifications:

    - ``no_location``      neither side has a venue — nothing to do.
    - ``backfill``         database empty, Calendar has one. The only automatic
                           venue write: there is nothing to clobber, and the
                           reminder renders "at " without it.
    - ``calendar_missing`` Calendar empty, database has one. Never blank the
                           row on this; the operator may simply not have filled
                           the event in.
    - ``in_sync``          both keys agree.
    - ``cosmetic``         same address, different spelling of the name — what
                           a Calendar edit produces on an unmoved venue.
    - ``material``         addresses differ. Hold the write, alert the operator.
    - ``material_db_newer``addresses differ, but the row was written after
                           Google last touched the event, so the database is
                           the newer write and the operator has most likely
                           already resolved this. Hold the write, no alert.

    The timestamp comparison is asymmetric on purpose. Only
    ``meeting_updated_at > event_updated`` is evidence: Google bumps
    ``event.updated`` on *any* event change, an attendee RSVP included, so the
    reverse says nothing about whether the location was edited — and never
    authorizes a write. ``meeting_updated_at`` is None until migration 026 is
    applied, which just means no drift is ever downgraded.
    """
    db_name, db_addr = name_key(db_location), address_key(db_location)
    cal_name, cal_addr = name_key(calendar_location), address_key(calendar_location)
    suggested = tidy(calendar_location)

    def verdict(
        classification: str, *, writable: bool = False, alertable: bool = False
    ) -> VenueComparison:
        return VenueComparison(
            classification=classification,
            writable=writable,
            alertable=alertable,
            db_name_key=db_name,
            db_address_key=db_addr,
            calendar_name_key=cal_name,
            calendar_address_key=cal_addr,
            suggested_location=suggested,
        )

    db_present = bool(db_name or db_addr)
    cal_present = bool(cal_name or cal_addr)

    if not db_present and not cal_present:
        return verdict("no_location")
    if not db_present:
        return verdict("backfill", writable=True)
    if not cal_present:
        return verdict("calendar_missing")

    # A bare venue name with no street address makes the address comparison
    # meaningless — compare whole strings and fail toward surfacing.
    if not db_addr or not cal_addr:
        same = (db_name, db_addr) == (cal_name, cal_addr)
        if same:
            return verdict("in_sync")
    elif db_addr == cal_addr:
        return verdict("in_sync" if db_name == cal_name else "cosmetic")

    if (
        meeting_updated_at is not None
        and event_updated is not None
        and meeting_updated_at > event_updated
    ):
        return verdict("material_db_newer")
    return verdict("material", alertable=True)


def drift_slug(comparison: VenueComparison) -> str:
    """Stable suffix for the `command_log.idempotency_key` of a drift alert.

    Keys the alert to the Calendar value, so an unresolved drift alerts once
    instead of every day, while a *new* Calendar edit alerts again.
    """
    key = comparison.calendar_address_key or comparison.calendar_name_key
    return key.replace(" ", "-") or "unknown"
