"""Tests for scripts/render_email_previews.py.

Covers the pure `render` token-substitution seam (no file I/O). Run via:
    uv run pytest tests/render_email_previews_test.py -v
"""
from __future__ import annotations


def test_module_imports():
    """Smoke test: the script's entry point is importable."""
    from scripts.render_email_previews import main
    assert callable(main)


import pytest

from scripts.render_email_previews import render


def test_render_substitutes_known_token():
    rendered, unresolved = render("Hi {{ name }}!", {"name": "Maya"})
    assert rendered == "Hi Maya!"
    assert unresolved == []


def test_render_tolerates_internal_whitespace():
    tokens = {"x": "A"}
    assert render("{{x}}", tokens)[0] == "A"
    assert render("{{ x }}", tokens)[0] == "A"
    assert render("{{   x   }}", tokens)[0] == "A"


def test_render_handles_dotted_keys():
    rendered, unresolved = render(
        "{{ recipient.firstName }} <{{ links.portalBase }}>",
        {"recipient.firstName": "Maya", "links.portalBase": "https://x"},
    )
    assert rendered == "Maya <https://x>"
    assert unresolved == []


def test_render_substitutes_every_occurrence():
    rendered, _ = render("{{ a }}-{{ a }}-{{ a }}", {"a": "z"})
    assert rendered == "z-z-z"


def test_render_reports_unresolved_and_leaves_token_intact():
    rendered, unresolved = render(
        "{{ known }} and {{ missing }}", {"known": "ok"}
    )
    assert rendered == "ok and {{ missing }}"
    assert unresolved == ["missing"]


def test_render_collects_each_unresolved_occurrence():
    # A token missing twice is reported twice (caller de-dupes via set()).
    _, unresolved = render("{{ gone }}{{ gone }}", {})
    assert unresolved == ["gone", "gone"]


def test_render_no_tokens_is_identity():
    text = "Plain text with no placeholders."
    rendered, unresolved = render(text, {"unused": "x"})
    assert rendered == text
    assert unresolved == []


@pytest.mark.parametrize("malformed", ["{{ }}", "{{}}", "{{ bad-key }}", "{ single }"])
def test_render_ignores_non_matching_braces(malformed):
    # The MUSTACHE pattern requires [A-Za-z0-9_.]+; these don't match and pass through.
    rendered, unresolved = render(malformed, {})
    assert rendered == malformed
    assert unresolved == []


import pathlib

_TEMPLATES = (
    pathlib.Path(__file__).resolve().parent.parent / "assets" / "emails" / "template"
)


@pytest.mark.parametrize("ext", ["html", "txt"])
def test_rsvp_confirmation_carries_quote_tokens(ext):
    text = (_TEMPLATES / f"rsvp-confirmation.{ext}").read_text(encoding="utf-8")
    assert "{{ quote.text }}" in text
    assert "{{ quote.by }}" in text
    assert "{{ quote.role }}" in text


def test_preview_main_renders_three_emails_with_no_unresolved_quote(capsys):
    import json as _json
    from scripts.render_email_previews import main
    assert main() == 0
    payload = _json.loads(capsys.readouterr().out)
    for key in ("rsvp_confirmation", "availability_thanks", "availability_reminder"):
        assert "{{ quote.text }}" not in payload[key]["html"]
        assert "{{ quote.text }}" not in payload[key]["text"]
