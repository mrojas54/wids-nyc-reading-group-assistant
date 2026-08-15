"""Playbook SQL must dollar-quote interpolated venue and email strings.

Single-quoted interpolation breaks on apostrophes (Jack's Wife Freda) and
is an injection footgun if a Calendar editor is hostile.
"""

from __future__ import annotations

from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
TASKS = REPO / "scheduled_tasks"

FORBIDDEN = (
    "'<db_location>'",
    "'<calendar_location>'",
    "'<calendar_location or null>'",
    "SET location = '<result.suggested_location>'",
    "'email', '<email>'",
)


def test_playbooks_dollar_quote_venues_and_emails() -> None:
    offenders: list[str] = []
    for name in (
        "calendar-rsvp-sync.md",
        "pre-meeting-reminder.md",
        "availability-chase.md",
    ):
        text = (TASKS / name).read_text(encoding="utf-8")
        for needle in FORBIDDEN:
            if needle in text:
                offenders.append(f"{name}: {needle}")
    assert offenders == []
