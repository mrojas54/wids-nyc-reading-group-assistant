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

# The canonical WiDS NYC wordmark (mark + "WiDS NYC" + rule + "AI Reading
# Group") — see docs/runbooks/transactional-emails.md, "Wordmark component".
# Spliced via a literal, non-Mustache placeholder rather than an HTML comment
# or a {{ }} token: an HTML comment would be deleted by strip_html_comments()
# below, and a {{ }} token would be corrupted by welcome_availability.py's
# blanket html.escape() over every token value. Read once at import time so
# no caller ever supplies (or goes stale on) the wordmark value itself.
WORDMARK_PLACEHOLDER = "__WORDMARK_BLOCK__"
WORDMARK_BLOCK = (TEMPLATES / "_wordmark_shared.html").read_text(encoding="utf-8").strip()

# The canonical primary-CTA button skeleton (height, arcsize, font, padding,
# border treatment) — see docs/runbooks/transactional-emails.md, "Shared
# fragments". Unlike the wordmark this fragment still carries {{ cta.* }}
# Mustache tokens after splicing: label/href/color/width genuinely vary per
# send (a different label per template, and availability-reminder's magenta
# "primary ask" exception vs every other template's sage), so those resolve
# through the normal per-template token dict in the render() pass that
# follows the splice. Only the literal skeleton placeholder is non-Mustache,
# for the same comment-stripping/escaping reasons as the wordmark.
CTA_PLACEHOLDER = "__CTA_BLOCK__"
CTA_BLOCK = (TEMPLATES / "_cta_shared.html").read_text(encoding="utf-8").strip()

# The canonical "WiDS NYC AI Reading Group" footer brand line. Only the
# literal branding text is shared — the functional link next to it (Member
# portal / RSVP management / mailto unsubscribe / none) differs per template
# on purpose and stays hand-written in each template's own footer.
FOOTER_BRAND_PLACEHOLDER = "__FOOTER_BRAND_BLOCK__"
FOOTER_BRAND_BLOCK = (TEMPLATES / "_footer_brand_shared.html").read_text(encoding="utf-8").strip()

# Every non-Mustache splice placeholder, applied in this order before
# strip_html_comments()/render(). Order doesn't matter today (the fragments
# don't nest inside one another), but is fixed for reproducibility.
SPLICE_BLOCKS = (
    (WORDMARK_PLACEHOLDER, WORDMARK_BLOCK),
    (CTA_PLACEHOLDER, CTA_BLOCK),
    (FOOTER_BRAND_PLACEHOLDER, FOOTER_BRAND_BLOCK),
)


def splice_shared_blocks(html_text: str) -> str:
    """Replace every shared-fragment placeholder with its canonical markup.

    Must run before strip_html_comments() and before any token dict is built
    — see the placeholder constants above for why.
    """
    for placeholder, block in SPLICE_BLOCKS:
        html_text = html_text.replace(placeholder, block)
    return html_text


def find_surviving_placeholders(html_text: str) -> list[str]:
    """Which splice placeholders (if any) are still literally present."""
    return [placeholder for placeholder, _ in SPLICE_BLOCKS if placeholder in html_text]

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
    # Canonical CTA skeleton (assets/emails/template/_cta_shared.html) — sage,
    # the default color; only availability-reminder gets the magenta exception.
    "cta.bg": "#467560",
    "cta.borderColor": "#355c4b",
    "cta.width": "200",
    "cta.href": "https://wids-nyc-reading-group-assistant.vercel.app/events/6/cal.ics",
    "cta.label": "Add to calendar →",
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
    # Magenta is availability-reminder's documented design-system exception —
    # every other template's CTA is the sage default.
    "cta.bg": "#c8226d",
    "cta.borderColor": "#a51858",
    "cta.width": "200",
    "cta.href": "https://wids-nyc-reading-group-assistant.vercel.app/availability",
    "cta.label": "Open availability →",
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
    "cta.bg": "#467560",
    "cta.borderColor": "#355c4b",
    "cta.width": "236",
    "cta.href": "https://wids-nyc-reading-group-assistant.vercel.app/events/6/cal.ics",
    "cta.label": "Join / add to calendar →",
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
    "cta.bg": "#467560",
    "cta.borderColor": "#355c4b",
    "cta.width": "236",
    "cta.href": "https://wids-nyc-reading-group-assistant.vercel.app/availability",
    "cta.label": "Share your availability →",
}

# Illustrative prerequisites for the preview (production values come from
# papers.prerequisites via scripts/generate_prerequisites.py). Items may be a
# plain string or a {text, url} mapping — a url renders a clickable link.
PREVIEW_PREREQS = (
    "A little groundwork will make the discussion land harder.",
    [
        {"text": "Skim how an LSTM cell carries state across a sequence.",
         "url": "https://colah.github.io/posts/2015-08-Understanding-LSTMs/"},
        {"text": "Recall what self-attention computes in a transformer block.",
         "url": "https://jalammar.github.io/illustrated-transformer/"},
        "Have a one-line intuition for why feature fusion can help forecasting.",
    ],
)

MUSTACHE = re.compile(r"\{\{\s*([A-Za-z0-9_.]+)\s*\}\}")


class RenderError(RuntimeError):
    """Raised when a template cannot be turned into a mailable body."""


# Documentation comments must not ship. HTML comments are not rendered, but
# they are in the message source — visible through "Show original" — and the
# head comments carry repo file paths, migration numbers, design rationale,
# and the *alternate* wording of copy the recipient is reading. None of that
# belongs in a member's inbox, and it is several KB on every send.
#
# Stripping also closes a leak the templates could only dodge by convention:
# render() substitutes every delimited token it finds, comments included, so a
# token documented in live `{{ … }}` syntax inside a comment got replaced with
# the recipient's real value and shipped it. rsvp-confirmation's head comment
# rendered as "Template tokens are Mustache-style (Maya)" for exactly that
# reason. The templates were de-delimited by hand on 2026-07-27 to work around
# it; stripping first makes that convention no longer load-bearing.
#
# Outlook's conditional comments MUST survive, including the deliberately
# malformed downlevel-revealed pair (`<!--[if !mso]><!-- -->` … `<!--<![endif]-->`).
# A lookahead-based "skip anything starting with [if" is NOT sufficient, and
# getting this wrong is expensive. The downlevel-revealed opener contains a
# *nested* `<!--`; a scanner that declines to match at the outer delimiter
# simply matches at the inner one, strips `<!-- -->`, and leaves
# `<!--[if !mso]>` unclosed — which swallows the CTA anchor into an open
# comment in every non-Outlook client. The button vanishes in Gmail and Apple
# Mail while still looking perfect in Outlook.
#
# So the conditionals are lifted out to sentinels first, longest form before
# shortest, and restored afterwards. Sentinels use NUL, which cannot occur in
# the template.
CONDITIONALS = (
    "<!--[if !mso]><!-- -->",
    "<!--<![endif]-->",
    "<!--[if mso]>",
    "<![endif]-->",
)
_ANY_COMMENT = re.compile(r"<!--[\s\S]*?-->")


def strip_html_comments(html_text: str) -> str:
    """Remove documentation comments, preserving MSO/VML conditionals.

    Run this on the HTML body *before* substitution: the head comments list
    token names, and stripping first keeps them out of the unresolved tally
    entirely — and out of the substituted output.
    """
    for i, token in enumerate(CONDITIONALS):
        html_text = html_text.replace(token, f"\x00c{i}\x00")
    html_text = _ANY_COMMENT.sub("", html_text)
    for i, token in enumerate(CONDITIONALS):
        html_text = html_text.replace(f"\x00c{i}\x00", token)
    if "\x00" in html_text:
        raise RenderError("comment-stripping sentinel survived")
    return html_text


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
        body = src.read_text(encoding="utf-8")
        if ext == "html":
            # Splice shared fragments before anything else: strip_html_comments
            # only removes real HTML comments and would never touch these
            # placeholders, but ordering it first keeps the fragments' own
            # markup subject to the same comment-stripping pass as the rest
            # of the body, in case a future edit reintroduces a doc comment.
            body = splice_shared_blocks(body)
            # Before substitution — see strip_html_comments. The .txt twins
            # carry no HTML comments; their doc header is a [[BEGIN:_doc]]
            # block, which is a composer's concern, not this one's.
            body = strip_html_comments(body)
        rendered, unresolved = render(body, tokens)
        if ext == "html":
            surviving = find_surviving_placeholders(rendered)
            if surviving:
                raise RenderError(
                    f"{stem}.html: {surviving} survived rendering — "
                    "a shared-fragment splice did not run or was reintroduced after it"
                )
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
