"""Render email templates with realistic sample data.

Writes `*_rendered.html` and `*_rendered.txt` next to each source template,
then prints the rendered HTML + text bodies to stdout as a JSON document
that the Gmail-MCP draft-creation step can consume.

Mustache-style tokens only ({{ name.path }}). No partials, no conditionals
— the templates resolve all branching server-side before substitution.

Run via:
    uv run python -m scripts.render_email_previews
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from scripts.discussion_questions import load_questions, question_tokens
from scripts.prerequisites import prereq_tokens
from scripts.quotes import load_bundle, quote_tokens, select_quote

ROOT = Path(__file__).resolve().parent.parent
TEMPLATES = ROOT / "assets" / "emails" / "template"

# Fixed so previews are byte-reproducible regardless of the calendar date.
PREVIEW_DATE_KEY = 20617

RSVP_TOKENS = {
    "recipient.firstName": "Maya",
    # event.dateLine removed from the template — the lede no longer
    # references the scheduled date (the calendar CTA carries the action).
    "links.calendar": "https://wids-nyc-reading-group-assistant.vercel.app/events/6/cal.ics",
    "paper.title": "Hybrid LSTM–Transformer Architecture with Multi-Scale Feature Fusion for High-Accuracy Gold Futures Price Forecasting",
    "paper.authorsShort": "Zhao, Guo & Wang",
    "paper.companionUrl": "https://wids-nyc-reading-group-assistant.vercel.app/papers/2",
    "haiku.line1": "Geese chart their return",
    "haiku.line2": "the same invisible line —",
    "haiku.line3": "you, too. Welcome in.",
    "links.rsvpManage": "https://wids-nyc-reading-group-assistant.vercel.app/me/rsvps",
    "links.portalBase": "https://wids-nyc-reading-group-assistant.vercel.app",
}

AVAIL_TOKENS = {
    "recipient.firstName": "Maya",
    # Real paper from meetings.paper_id=2 (current prep meeting #6).
    # Paper #6 (Poisoning Attacks) was last cycle — meeting #16, status=done.
    "paper.title": "Hybrid LSTM–Transformer Architecture with Multi-Scale Feature Fusion for High-Accuracy Gold Futures Price Forecasting",
    "paper.authorsShort": "Zhao, Guo & Wang",
    # s2_paper_id = DOI:… → citation composition falls to venue branch:
    # "in <em>Mathematics</em> (2025)"
    "paper.citation": "in <em>Mathematics</em> (2025)",
    "paper.citationText": "in Mathematics (2025)",
    "paper.url": "https://doi.org/10.3390/math13101551",
    # meetings.location is NULL for meeting #6 → renderer would strip the
    # location chip and omit the location piece from metaLine. For this
    # preview we still pass a value so you can see the chip render; the
    # real send via availability-chase will drop the chip entirely.
    "paper.location": "Brooklyn, TBD",
    "paper.duration": "~90 min",
    "paper.companionDropDay": "Wed",
    "paper.metaLine": "Brooklyn, TBD · ~90 min · Paper Pal drops Wed",
    "links.availability": "https://wids-nyc-reading-group-assistant.vercel.app/availability",
    "links.companionPreview": "https://wids-nyc-reading-group-assistant.vercel.app/papers/2",
    "links.portalBase": "https://wids-nyc-reading-group-assistant.vercel.app",
    "operator.displayName": "Michelle Rojas",
}

REMINDER_TOKENS = {
    "recipient.firstName": "Maya",
    "paper.title": "Hybrid LSTM–Transformer Architecture with Multi-Scale Feature Fusion for High-Accuracy Gold Futures Price Forecasting",
    "paper.authorsShort": "Zhao, Guo & Wang",
    "paper.citation": "in <em>Mathematics</em> (2025)",
    "paper.citationText": "in Mathematics (2025)",
    "paper.url": "https://doi.org/10.3390/math13101551",
    "paper.location": "Brooklyn, TBD",
    "paper.duration": "~90 min",
    "paper.companionDropDay": "Wed",
    "paper.metaLine": "Brooklyn, TBD · ~90 min · Paper Pal drops Wed",
    "stats.submittedCount": "5",
    "stats.submittedCountWord": "Five",
    "stats.totalMembers": "12",
    "deadline.soft": "Sunday evening",
    "links.availability": "https://wids-nyc-reading-group-assistant.vercel.app/availability",
    "links.companionPreview": "https://wids-nyc-reading-group-assistant.vercel.app/papers/2",
    "links.portalBase": "https://wids-nyc-reading-group-assistant.vercel.app",
    "operator.displayName": "Michelle Rojas",
}

PRE_MEETING_TOKENS = {
    "recipient.firstName": "Maya",
    "meeting.dayName": "Tuesday",
    "meeting.when": "Tue, Jun 23 · 6:30pm",
    "meeting.location": "Jack's Wife Freda",
    "meeting.leader": "Michelle & Claudia",
    "links.calendar": "https://wids-nyc-reading-group-assistant.vercel.app/events/6/cal.ics",
    "paper.title": "A Hybrid LSTM–Transformer Model for Gold Futures Price Forecasting",
    "paper.subtitle": "with XGBoost–SHAP feature selection on Shanghai gold futures",
    "paper.companionUrl": "https://wids-nyc-reading-group-assistant.vercel.app/papers/2",
    "signoff.names": "Michelle & Claudia",
    "links.rsvpManage": "https://wids-nyc-reading-group-assistant.vercel.app/me/rsvps",
    "links.portalBase": "https://wids-nyc-reading-group-assistant.vercel.app",
}

NEW_PAPER_TOKENS = {
    "recipient.firstName": "Maya",
    "lead.name": "Claudia",
    "lead.initial": "C",
    "lead.blurb": "Claudia works on time-series forecasting and volunteered to "
                  "steer us through this one.",
    "paper.title": "Hybrid LSTM–Transformer Architecture with Multi-Scale "
                   "Feature Fusion for High-Accuracy Gold Futures Price Forecasting",
    "paper.shortTitle": "A Hybrid LSTM–Transformer Model for Gold Futures Forecasting",
    "paper.summary": "it pairs an LSTM with a transformer and multi-scale "
                     "feature fusion to forecast gold futures prices.",
    "paper.authorsShort": "Zhao, Guo & Wang",
    "paper.url": "https://doi.org/10.3390/math13101551",
    "signoff.names": "Michelle & Claudia",
    "links.availability": "https://wids-nyc-reading-group-assistant.vercel.app/availability",
    "links.rsvpManage": "https://wids-nyc-reading-group-assistant.vercel.app/me/rsvps",
}

# Illustrative prerequisites for the preview (production values come from
# papers.prerequisites via scripts/generate_prerequisites.py).
PREVIEW_PREREQS = (
    "A little groundwork will make the discussion land harder.",
    [
        "Skim how an LSTM cell carries state across a sequence.",
        "Recall what self-attention computes in a transformer block.",
        "Have a one-line intuition for why feature fusion can help forecasting.",
    ],
)

MUSTACHE = re.compile(r"\{\{\s*([A-Za-z0-9_.]+)\s*\}\}")


def render(template_text: str, tokens: dict[str, str]) -> tuple[str, list[str]]:
    """Substitute every {{ token }} with its value. Returns (rendered, unresolved)."""
    unresolved: list[str] = []

    def sub(match: re.Match[str]) -> str:
        key = match.group(1)
        if key not in tokens:
            unresolved.append(key)
            return match.group(0)
        return tokens[key]

    return MUSTACHE.sub(sub, template_text), unresolved


def render_pair(stem: str, tokens: dict[str, str]) -> tuple[dict[str, str], list[str]]:
    """Render the .html + .txt pair for `stem`. Returns (rendered_by_ext, unresolved)."""
    out: dict[str, str] = {}
    unresolved_all: list[str] = []
    for ext in ("html", "txt"):
        src = TEMPLATES / f"{stem}.{ext}"
        rendered, unresolved = render(src.read_text(encoding="utf-8"), tokens)
        unresolved_all.extend(unresolved)
        dst = TEMPLATES / f"{stem}_rendered.{ext}"
        dst.write_text(rendered, encoding="utf-8")
        out[ext] = rendered
    return out, unresolved_all


def main() -> int:
    q = quote_tokens(select_quote(load_bundle(), PREVIEW_DATE_KEY))
    qtokens = question_tokens(load_questions())
    rsvp, u_rsvp = render_pair("rsvp-confirmation", {**RSVP_TOKENS, **q})
    thanks, u_thanks = render_pair("availability-thanks", {**AVAIL_TOKENS, **q})
    reminder, u_reminder = render_pair("availability-reminder", {**REMINDER_TOKENS, **q})
    pre_meeting, u_pre = render_pair(
        "pre-meeting-reminder", {**PRE_MEETING_TOKENS, **q, **qtokens}
    )
    pq = prereq_tokens(PREVIEW_PREREQS[0], list(PREVIEW_PREREQS[1]))
    new_paper, u_new = render_pair(
        "new-paper-announcement", {**NEW_PAPER_TOKENS, **q, **pq}
    )
    unresolved = sorted(set(u_rsvp + u_thanks + u_reminder + u_pre + u_new))
    if unresolved:
        print(f"ERROR: unresolved tokens in rendered output: {unresolved}", file=sys.stderr)
        return 1
    json.dump(
        {
            "rsvp_confirmation": {"html": rsvp["html"], "text": rsvp["txt"]},
            "availability_thanks": {"html": thanks["html"], "text": thanks["txt"]},
            "availability_reminder": {"html": reminder["html"], "text": reminder["txt"]},
            "pre_meeting_reminder": {"html": pre_meeting["html"], "text": pre_meeting["txt"]},
            "new_paper_announcement": {"html": new_paper["html"], "text": new_paper["txt"]},
        },
        sys.stdout,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
