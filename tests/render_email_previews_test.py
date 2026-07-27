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


# Interleaved import (tests/* suppress E402 — see pyproject.toml).
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


@pytest.mark.parametrize("ext", ["html", "txt"])
def test_availability_reminder_carries_quote_tokens(ext):
    text = (_TEMPLATES / f"availability-reminder.{ext}").read_text(encoding="utf-8")
    assert "{{ quote.text }}" in text
    assert "{{ quote.by }}" in text
    assert "{{ quote.role }}" in text


@pytest.mark.parametrize("ext", ["html", "txt"])
def test_availability_thanks_carries_quote_tokens(ext):
    text = (_TEMPLATES / f"availability-thanks.{ext}").read_text(encoding="utf-8")
    assert "{{ quote.text }}" in text
    assert "{{ quote.by }}" in text
    assert "{{ quote.role }}" in text


def test_preview_main_resolves_quotes_from_pool(capsys):
    import json as _json
    from scripts.quotes import load_bundle, quote_tokens, select_quote
    from scripts.render_email_previews import PREVIEW_DATE_KEY, main
    assert main() == 0
    payload = _json.loads(capsys.readouterr().out)
    expected = quote_tokens(select_quote(load_bundle(), PREVIEW_DATE_KEY))["quote.text"]
    # All three emails now carry the quote block: token resolved AND value present.
    for key in (
        "rsvp_confirmation",
        "availability_thanks",
        "availability_reminder",
        "pre_meeting_reminder",
        "new_paper_announcement",
    ):
        for fmt in ("html", "text"):
            assert "{{ quote.text }}" not in payload[key][fmt]
            assert expected in payload[key][fmt]


def test_preview_main_fails_on_unresolved_token(monkeypatch, capsys):
    import scripts.render_email_previews as rep
    broken = dict(rep.REMINDER_TOKENS)
    broken.pop("paper.title")
    monkeypatch.setattr(rep, "REMINDER_TOKENS", broken)
    assert rep.main() == 1
    assert "unresolved" in capsys.readouterr().err.lower()


@pytest.mark.parametrize("ext", ["html", "txt"])
def test_pre_meeting_reminder_carries_quote_tokens(ext):
    text = (_TEMPLATES / f"pre-meeting-reminder.{ext}").read_text(encoding="utf-8")
    assert "{{ quote.text }}" in text
    assert "{{ quote.by }}" in text
    assert "{{ quote.role }}" in text


def test_pre_meeting_reminder_carries_question_tokens():
    html = (_TEMPLATES / "pre-meeting-reminder.html").read_text(encoding="utf-8")
    txt = (_TEMPLATES / "pre-meeting-reminder.txt").read_text(encoding="utf-8")
    assert "{{ questions.lede }}" in html
    assert "{{ questions.html }}" in html
    assert "{{ questions.lede }}" in txt
    assert "{{ questions.text }}" in txt


def test_preview_main_resolves_question_tokens(capsys):
    import json as _json
    from scripts.discussion_questions import load_questions, question_tokens
    from scripts.render_email_previews import main
    assert main() == 0
    payload = _json.loads(capsys.readouterr().out)
    expected_lede = question_tokens(load_questions())["questions.lede"]
    for fmt in ("html", "text"):
        # no question token left unresolved, and the composed lede is present
        assert "{{ questions." not in payload["pre_meeting_reminder"][fmt]
        assert expected_lede in payload["pre_meeting_reminder"][fmt]


def test_new_paper_announcement_carries_prereq_tokens():
    # The prerequisites block is this email's purpose — guard its source tokens
    # so a deleted block fails loudly (the unresolved-token guard can't see an
    # absent token). HTML injects composed rows; the .txt twin the plain list.
    html = (_TEMPLATES / "new-paper-announcement.html").read_text(encoding="utf-8")
    txt = (_TEMPLATES / "new-paper-announcement.txt").read_text(encoding="utf-8")
    assert "{{ prereqs.lede }}" in html
    assert "{{ prereqs.html }}" in html
    assert "{{ prereqs.lede }}" in txt
    assert "{{ prereqs.text }}" in txt


def test_preview_main_resolves_new_paper_announcement(capsys):
    # main() emits the pair only when every {{ token }} resolved; assert the
    # new-paper template comes through fully hydrated, prereqs section included.
    import json as _json
    from scripts.render_email_previews import main
    assert main() == 0
    payload = _json.loads(capsys.readouterr().out)
    body = payload["new_paper_announcement"]
    for fmt in ("html", "text"):
        assert "{{" not in body[fmt]
    assert "Recommended pre-requisites" in body["html"]


# --- comment stripping -----------------------------------------------------
#
# Head comments are in the message source even when a client does not paint
# them — "Show original" shows the lot. They also used to be *substituted*,
# because render() replaces every delimited token it finds, comments included.

_ALL_STEMS = (
    "rsvp_confirmation",
    "availability_thanks",
    "availability_reminder",
    "pre_meeting_reminder",
    "new_paper_announcement",
)


def _payload(capsys):
    import json as _json
    from scripts.render_email_previews import main
    assert main() == 0
    return _json.loads(capsys.readouterr().out)


def _non_conditional_residue(html: str) -> str:
    """The body with the four Outlook conditional forms lifted out.

    Whatever comment delimiter survives in the result is a doc comment that
    should have been stripped.
    """
    from scripts.render_email_previews import CONDITIONALS
    for token in CONDITIONALS:
        html = html.replace(token, "")
    return html


def test_no_doc_comment_survives_in_any_rendered_html(capsys):
    payload = _payload(capsys)
    for stem in _ALL_STEMS:
        residue = _non_conditional_residue(payload[stem]["html"])
        assert "<!--" not in residue, f"doc comment shipped in {stem}"
        # A stray close means a comment was opened somewhere too.
        assert "-->" not in residue, f"stray comment close in {stem}"


def test_head_comment_prose_never_ships(capsys):
    """Concrete leaks, in case a future stripper passes the delimiter check."""
    payload = _payload(capsys)
    leaks = {
        "rsvp_confirmation": ("Claude Design handoff", "Template tokens are Mustache-style"),
        "availability_thanks": ("Acknowledgement counterpart", "availability-chase.md"),
        "availability_reminder": ("v2 deltas vs v1", "availability-chase.md"),
        "pre_meeting_reminder": ("Email-safety deltas", "browser prototype"),
        "new_paper_announcement": ("court/queens voice branch", "ReadingGroupEmail.dc.html"),
    }
    for stem, prose in leaks.items():
        for leak in prose:
            assert leak not in payload[stem]["html"], f"{stem}: doc comment shipped: {leak!r}"


def test_token_documented_inside_a_comment_never_leaks_a_real_value(capsys):
    """Regression for the bug that motivated stripping.

    `rsvp-confirmation.html`'s head comment reads "Template tokens are
    Mustache-style ({{ recipient.firstName }})". Substituting the comment
    turned that into "… Mustache-style (Maya)" — a real recipient's first name
    shipped inside an HTML comment. Stripping first makes it unreachable, so
    the de-delimiting convention in the templates is no longer load-bearing.
    """
    html = _payload(capsys)["rsvp_confirmation"]["html"]
    assert "Mustache-style" not in html
    assert "Mustache-style (Maya)" not in html


def test_outlook_conditionals_survive_stripping(capsys):
    """The MSO style block and the VML button are comments too — keep them."""
    payload = _payload(capsys)
    for stem in _ALL_STEMS:
        html = payload[stem]["html"]
        assert "<!--[if mso]>" in html, stem
        assert "<![endif]-->" in html, stem
    # availability-thanks has no VML button, so no downlevel-revealed pair.
    for stem in (s for s in _ALL_STEMS if s != "availability_thanks"):
        html = payload[stem]["html"]
        assert "<!--[if !mso]><!-- -->" in html, stem
        assert "<!--<![endif]-->" in html, stem
        assert "v:roundrect" in html, stem


def test_stripping_does_not_disturb_the_text_twins(capsys):
    """The .txt bodies carry no HTML comments and must pass through intact."""
    payload = _payload(capsys)
    for stem in _ALL_STEMS:
        assert "<!--" not in payload[stem]["text"], stem


def test_strip_html_comments_removes_a_doc_comment():
    from scripts.render_email_previews import strip_html_comments
    assert strip_html_comments("a<!-- note -->b") == "ab"
    assert strip_html_comments("a<!--\n multi\n line\n-->b") == "ab"


def test_strip_html_comments_keeps_the_downlevel_revealed_pair():
    """The nested `<!--` in the opener is the trap a naive scanner falls into.

    Matching at the inner delimiter strips `<!-- -->` and leaves
    `<!--[if !mso]>` unclosed, which swallows the CTA anchor in every
    non-Outlook client.
    """
    from scripts.render_email_previews import strip_html_comments
    src = '<!--[if !mso]><!-- --><a href="x">CTA</a><!--<![endif]-->'
    assert strip_html_comments(src) == src


def test_strip_html_comments_keeps_mso_conditionals_and_drops_neighbours():
    from scripts.render_email_previews import strip_html_comments
    src = "<!-- doc --><!--[if mso]><td>x</td><![endif]--><!-- more -->"
    assert strip_html_comments(src) == "<!--[if mso]><td>x</td><![endif]-->"


def test_strip_html_comments_is_idempotent():
    from scripts.render_email_previews import strip_html_comments
    src = '<!-- doc --><!--[if !mso]><!-- --><a>c</a><!--<![endif]-->'
    once = strip_html_comments(src)
    assert strip_html_comments(once) == once


def test_strip_runs_before_substitution(capsys):
    """Order matters: a token inside a comment must not count as unresolved.

    Stripping after substitution would still ship the value; stripping before
    also keeps comment-only token names out of the unresolved tally.
    """
    from scripts.render_email_previews import render, strip_html_comments
    src = "<!-- documented: {{ never.defined }} --><p>{{ known }}</p>"
    rendered, unresolved = render(strip_html_comments(src), {"known": "ok"})
    assert rendered == "<p>ok</p>"
    assert unresolved == []
