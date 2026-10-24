"""Tests for scripts/reminder_manifest.py: per-recipient availability-reminder rendering.

The CLI path (``gmail_raw_drafts reminder-manifest``) and the manifest's round trip
through ``batch --dry-run`` stay in ``gmail_raw_drafts_test.py``.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from scripts import gmail_raw_drafts as g
from scripts import reminder_manifest as rm


def test_gmail_raw_drafts_uses_the_reminder_manifest_helpers():
    """The CLI must not grow a second renderer or filename rule beside this module."""
    assert g.write_reminder_manifest is rm.write_reminder_manifest
    assert g.load_recipients is rm.load_recipients
    assert g.load_tokens is rm.load_tokens
    assert g._slug is rm._slug


def test_reminder_manifest_does_not_import_the_gmail_client():
    """Rendering a manifest needs no network library; keep it importable without one."""
    src = Path(rm.__file__).read_text(encoding="utf-8")
    assert "httpx" not in src and "gmail_raw_drafts import" not in src


def test_reminder_manifest_pending_state_strips_paper_tokens_before_rendering(tmp_path: Path):
    """The draft path must be paper-free by construction like the preview is:
    hand it the *full* token set and the pending body still carries no paper."""
    from scripts.quotes import load_bundle, quote_tokens, select_quote
    from scripts.render_email_previews import REMINDER_TOKENS

    tokens = {**REMINDER_TOKENS, **quote_tokens(select_quote(load_bundle(), 20617))}
    path = rm.write_reminder_manifest(
        recipients=[{"first": "Niki", "email": "niki@example.com"}],
        tokens=tokens, state="paper_pending", out_dir=tmp_path, subject="Sub",
    )
    [entry] = json.loads(path.read_text(encoding="utf-8"))
    for key in ("html", "text"):
        body = (tmp_path / entry[key]).read_text(encoding="utf-8")
        assert "Paper Pal coming soon" in body
        assert "Hybrid LSTM" not in body and "doi.org" not in body and "papers/2" not in body


def test_reminder_manifest_paper_state_still_needs_the_paper_tokens(tmp_path: Path):
    from scripts.quotes import load_bundle, quote_tokens, select_quote
    from scripts.render_email_previews import REMINDER_PAPER_PENDING_TOKENS

    tokens = {**REMINDER_PAPER_PENDING_TOKENS, **quote_tokens(select_quote(load_bundle(), 20617))}
    with pytest.raises(rm.DraftError, match="unresolved tokens.*paper.title"):
        rm.write_reminder_manifest(
            recipients=[{"first": "Niki", "email": "niki@example.com"}],
            tokens=tokens, state="paper", out_dir=tmp_path, subject="Sub",
        )


def test_reminder_manifest_and_preview_render_byte_identical_bodies(tmp_path: Path):
    """The whole point of sharing render_body: the draft *is* the preview."""
    from scripts.quotes import load_bundle, quote_tokens, select_quote
    from scripts.render_email_previews import (
        REMINDER_PAPER_PENDING_BLOCKS,
        REMINDER_PAPER_PENDING_TOKENS,
        REMINDER_TOKENS,
        TEMPLATES,
        render_body,
    )

    q = quote_tokens(select_quote(load_bundle(), 20617))
    for state, base, blocks in (
        ("paper", REMINDER_TOKENS, {"paper": True, "paper_pending": False}),
        ("paper_pending", REMINDER_PAPER_PENDING_TOKENS, REMINDER_PAPER_PENDING_BLOCKS),
    ):
        tokens = {**base, **q}
        path = rm.write_reminder_manifest(
            recipients=[{"first": "Maya", "email": "maya@example.com"}],
            tokens=tokens, state=state, out_dir=tmp_path / state, subject="Sub",
        )
        [entry] = json.loads(path.read_text(encoding="utf-8"))
        for ext, key in (("html", "html"), ("txt", "text")):
            src = (TEMPLATES / f"availability-reminder.{ext}").read_text(encoding="utf-8")
            expected, unresolved = render_body(src, ext, blocks, {**tokens, "recipient.firstName": "Maya"})
            assert unresolved == []
            assert (tmp_path / state / entry[key]).read_text(encoding="utf-8") == expected
