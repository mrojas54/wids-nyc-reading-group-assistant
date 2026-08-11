"""Tests for scripts/venue_keys.py — the Calendar-vs-database venue comparison.

The 2026-08-10 meeting-37 incident is the anchor: the exact two strings that
disagreed, and the exact corrected string that must read as in-sync. If those
three cases hold, the detector fires when it should and stays quiet when it
should. See docs/venue-drift.md.
"""

from datetime import UTC, datetime

from scripts.venue_keys import (
    address_key,
    classify,
    drift_slug,
    name_key,
    tidy,
)

# The strings exactly as they stood, from the Google Calendar event
# (kpkh9gfid19m5kbm4bf4tlgdus) and meetings.location.
CAL_PRINCE = (
    "Prince Tea House Ktown | Dessert Spot at Fifth Ave, "
    "324 5th Ave, New York, NY 10001, USA"
)
DB_PRINCE = "Prince Tea House - Ktown, 324 5th Ave, New York, NY 10001"
DB_JACKS_STALE = "Jack's Wife Freda - Soho, 226 Lafayette St, New York, NY 10012"


def test_import_smoke():
    assert callable(classify)


# --- keys ------------------------------------------------------------------


def test_google_and_house_style_reduce_to_the_same_keys():
    assert name_key(CAL_PRINCE) == name_key(DB_PRINCE) == "prince tea house ktown"
    assert (
        address_key(CAL_PRINCE)
        == address_key(DB_PRINCE)
        == "324 5th ave new york ny 10001"
    )


def test_apostrophes_elide_rather_than_split():
    assert name_key(DB_JACKS_STALE) == "jacks wife freda soho"


def test_street_suffixes_canonicalize():
    assert address_key("X, 100 Fifth Avenue, New York, NY 10011") == address_key(
        "X, 100 Fifth Ave, New York, NY 10011"
    )
    assert address_key("X, 5 West 8th Street, NY") == "5 w 8th st ny"


def test_country_field_dropped_only_at_the_end():
    assert address_key("X, 1 A St, NY 10001, USA") == address_key("X, 1 A St, NY 10001")
    assert address_key("X, 1 A St, United States") == "1 a st"


def test_bare_venue_name_has_no_address_key():
    assert name_key("Think Coffee") == "think coffee"
    assert address_key("Think Coffee") == ""


def test_empty_and_none_are_handled():
    for empty in (None, "", "   ", ",,"):
        assert name_key(empty) == ""
        assert address_key(empty) == ""
        assert tidy(empty) == ""


# --- tidy ------------------------------------------------------------------


def test_tidy_strips_tagline_and_country_but_not_casing():
    assert tidy(CAL_PRINCE) == "Prince Tea House Ktown, 324 5th Ave, New York, NY 10001"


def test_tidy_does_not_invent_the_house_style_dash():
    # The " - Ktown" neighborhood dash is not derivable from Google's string;
    # tidy() must not guess it. The operator adds it by hand.
    assert " - " not in tidy(CAL_PRINCE)
    assert tidy(CAL_PRINCE) != DB_PRINCE


# --- classification --------------------------------------------------------


def test_the_incident_is_material_drift():
    result = classify(DB_JACKS_STALE, CAL_PRINCE)
    assert result.classification == "material"
    assert result.alertable is True
    assert result.writable is False
    assert result.suggested_location.startswith("Prince Tea House Ktown, 324 5th Ave")


def test_the_correction_reads_as_in_sync():
    result = classify(DB_PRINCE, CAL_PRINCE)
    assert result.classification == "in_sync"
    assert (result.alertable, result.writable) == (False, False)


def test_same_address_different_name_is_cosmetic_not_alertable():
    result = classify(
        "Prince Tea House - Koreatown, 324 5th Ave, New York, NY 10001", CAL_PRINCE
    )
    assert result.classification == "cosmetic"
    assert result.alertable is False
    assert result.writable is False


def test_null_database_location_backfills():
    result = classify(None, CAL_PRINCE)
    assert result.classification == "backfill"
    assert result.writable is True
    assert result.alertable is False
    assert result.suggested_location == tidy(CAL_PRINCE)


def test_missing_calendar_location_never_blanks_the_row():
    result = classify(DB_PRINCE, None)
    assert result.classification == "calendar_missing"
    assert result.writable is False
    assert result.alertable is False


def test_both_empty_is_a_no_op():
    assert classify(None, None).classification == "no_location"


def test_bare_names_fail_toward_surfacing():
    # No street address on either side: whole-string comparison, and any
    # difference escalates rather than being written off as cosmetic.
    assert classify("Think Coffee", "Think Coffee").classification == "in_sync"
    assert classify("Think Coffee", "Prince Tea House").classification == "material"


def test_address_present_on_one_side_only_is_material():
    result = classify("Think Coffee", CAL_PRINCE)
    assert result.classification == "material"
    assert result.alertable is True


# --- the migration 026 tiebreaker ------------------------------------------

EARLIER = datetime(2026, 8, 10, 22, 10, 11, tzinfo=UTC)
LATER = datetime(2026, 8, 11, 6, 46, 0, tzinfo=UTC)


def test_database_written_after_the_event_suppresses_the_alert():
    result = classify(
        DB_JACKS_STALE, CAL_PRINCE, meeting_updated_at=LATER, event_updated=EARLIER
    )
    assert result.classification == "material_db_newer"
    assert result.alertable is False
    assert result.writable is False


def test_newer_event_alone_does_not_authorize_anything():
    # Google bumps event.updated on any change, an attendee RSVP included, so
    # this direction must stay a plain alertable material drift.
    result = classify(
        DB_JACKS_STALE, CAL_PRINCE, meeting_updated_at=EARLIER, event_updated=LATER
    )
    assert result.classification == "material"
    assert result.alertable is True
    assert result.writable is False


def test_missing_timestamps_never_downgrade():
    # Pre-migration-026 state: meetings has no updated_at at all.
    result = classify(DB_JACKS_STALE, CAL_PRINCE, event_updated=LATER)
    assert result.classification == "material"
    assert result.alertable is True


def test_equal_timestamps_do_not_downgrade():
    result = classify(
        DB_JACKS_STALE, CAL_PRINCE, meeting_updated_at=EARLIER, event_updated=EARLIER
    )
    assert result.classification == "material"


# --- idempotency key -------------------------------------------------------


def test_drift_slug_is_stable_and_keyed_to_the_calendar_value():
    slug = drift_slug(classify(DB_JACKS_STALE, CAL_PRINCE))
    assert slug == "324-5th-ave-new-york-ny-10001"
    # Same Calendar venue reached from a different stale database value keys the
    # same, so re-alerting is driven by the Calendar side changing.
    assert drift_slug(classify("Somewhere Else, 1 A St, NY 10001", CAL_PRINCE)) == slug


def test_drift_slug_falls_back_to_the_name_when_there_is_no_address():
    assert (
        drift_slug(classify("Think Coffee", "Prince Tea House")) == "prince-tea-house"
    )
