"""Tests for scripts/email_preview_tokens.py: the sample data email previews render with."""
from __future__ import annotations

import pytest

from scripts import email_preview_tokens as samples
from scripts import render_email_previews as rep

TOKEN_SETS = [
    "RSVP_TOKENS", "AVAIL_TOKENS", "MEETING_THANKS_TOKENS", "REMINDER_TOKENS",
    "PRE_MEETING_TOKENS", "NEW_PAPER_TOKENS",
]


@pytest.mark.parametrize("name", [*TOKEN_SETS, "PREVIEW_PREREQS"])
def test_render_email_previews_uses_the_shared_samples(name):
    """The renderer must not grow a second copy of a sample beside this module."""
    assert getattr(rep, name) is getattr(samples, name)


@pytest.mark.parametrize("name", TOKEN_SETS)
def test_sample_tokens_are_flat_string_maps(name):
    """render() substitutes str values only; a nested or non-str value would
    surface as a confusing render failure far from the edit that caused it."""
    tokens = getattr(samples, name)
    assert tokens
    assert all(isinstance(k, str) and isinstance(v, str) for k, v in tokens.items())


def test_pending_reminder_sample_is_derived_not_duplicated():
    """The paper-free reminder sample comes from the with-paper one through the
    same strip the real sends use, so it cannot drift into carrying a paper."""
    assert rep.REMINDER_PAPER_PENDING_TOKENS == rep.strip_paper_tokens(samples.REMINDER_TOKENS)
    assert not any(k.startswith("paper.") for k in rep.REMINDER_PAPER_PENDING_TOKENS)
