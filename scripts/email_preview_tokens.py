"""Sample token values the email previews render with.

Split out of ``render_email_previews`` so the renderer reads as code and the
fixture data (one dict per template, drawn from real meetings and papers) can be
edited without scrolling past it. Values only: the state logic that derives the
availability-reminder's paper-free token set stays in ``render_email_previews``,
because the Gmail draft path runs it on real sends too.
"""
from __future__ import annotations


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

# Real send: vibe_session #41 (2026-09-26), attendees Niki + Rosa.
MEETING_THANKS_TOKENS = {
    "preheader": "Thanks for spending Saturday building with us.",
    "recipient.greeting": "Niki and Rosa",
    "meeting.kindLabel": "Vibe session",
    "meeting.headline": "Thanks for building with us",
    "meeting.dateLine": "Sat, Sep 26",
    "meeting.place": "Greenpoint",
    "body.lede": "Thank you both for coming out on Saturday. A small table made for a really good afternoon of building, and I'm glad you two were at it.",
    "body.next": "I'll share what's next for the group soon.",
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
