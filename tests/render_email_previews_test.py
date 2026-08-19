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


# ---------------------------------------------------------------------------
# Wordmark component — assets/emails/template/_wordmark_shared.html
# See docs/runbooks/transactional-emails.md, "Wordmark component".
# ---------------------------------------------------------------------------

WORDMARK_TEMPLATE_STEMS = (
    "availability-reminder",
    "availability-thanks",
    "pre-meeting-reminder",
    "rsvp-confirmation",
    "new-paper-announcement",
)


@pytest.mark.parametrize("stem", WORDMARK_TEMPLATE_STEMS)
def test_render_pair_splices_canonical_wordmark(stem):
    """Every render_pair-driven template gets the shared wordmark, with no
    leftover placeholder and no dependency on the caller's token dict."""
    from scripts.render_email_previews import WORDMARK_PLACEHOLDER, render_pair
    rendered, _ = render_pair(stem, {})
    html = rendered["html"]
    assert WORDMARK_PLACEHOLDER not in html
    assert "mark-reader-192.png" in html
    assert "WiDS NYC</div>" in html
    assert "AI Reading Group</div>" in html


def test_render_pair_raises_if_wordmark_placeholder_survives(tmp_path, monkeypatch):
    """Defense-in-depth: if a shared source ever collapses to the literal
    placeholder itself, render_pair must fail loudly rather than ship it."""
    import scripts.render_email_previews as rep
    monkeypatch.setattr(rep, "TEMPLATES", tmp_path)
    # SPLICE_BLOCKS is a tuple built once at import time, so patching
    # WORDMARK_BLOCK alone wouldn't change what splice_shared_blocks()
    # actually reads — patch the tuple entry it resolves through instead.
    monkeypatch.setattr(
        rep,
        "SPLICE_BLOCKS",
        ((rep.WORDMARK_PLACEHOLDER, rep.WORDMARK_PLACEHOLDER),),
    )
    (tmp_path / "fake.html").write_text(
        f"<p>{rep.WORDMARK_PLACEHOLDER}</p>", encoding="utf-8"
    )
    (tmp_path / "fake.txt").write_text("hi", encoding="utf-8")
    with pytest.raises(rep.RenderError, match=rep.WORDMARK_PLACEHOLDER):
        rep.render_pair("fake", {})


def test_magic_link_wordmark_matches_shared_source():
    """magic-link.html can't consume the splice mechanism (hand-pasted into
    Supabase), so its hand-synced copy must stay whitespace-identical to the
    shared source, checked between sentinel comments."""
    import re

    from scripts.render_email_previews import TEMPLATES, WORDMARK_BLOCK
    magic_link = (TEMPLATES / "magic-link.html").read_text(encoding="utf-8")
    match = re.search(
        r"<!-- WORDMARK:BEGIN -->(.*?)<!-- WORDMARK:END -->", magic_link, re.S
    )
    assert match is not None, "magic-link.html is missing WORDMARK:BEGIN/END sentinels"
    assert match.group(1).strip() == WORDMARK_BLOCK


def test_magic_link_has_no_placeholder_deploy_url():
    """Smoke check for the exact failure that already shipped once,
    unnoticed: a literal, unfilled YOUR-DEPLOY-URL placeholder."""
    from scripts.render_email_previews import TEMPLATES
    magic_link = (TEMPLATES / "magic-link.html").read_text(encoding="utf-8")
    assert "YOUR-DEPLOY-URL" not in magic_link


# ---------------------------------------------------------------------------
# CTA fragment — assets/emails/template/_cta_shared.html
# ---------------------------------------------------------------------------

from scripts.render_email_previews import (
    AVAIL_TOKENS,
    NEW_PAPER_TOKENS,
    PRE_MEETING_TOKENS,
    REMINDER_TOKENS,
    RSVP_TOKENS,
)

#: stem -> the cta.* token dict already defined for it in this module.
CTA_TEMPLATE_TOKENS = {
    "availability-reminder": REMINDER_TOKENS,
    "rsvp-confirmation": RSVP_TOKENS,
    "pre-meeting-reminder": PRE_MEETING_TOKENS,
    "new-paper-announcement": NEW_PAPER_TOKENS,
}


@pytest.mark.parametrize("stem", sorted(CTA_TEMPLATE_TOKENS))
def test_render_pair_splices_canonical_cta(stem):
    # These minimal per-template dicts don't include quote/question/prereq
    # tokens main() normally merges in — irrelevant to the CTA, so only
    # assert none of the cta.* tokens specifically are unresolved.
    from scripts.render_email_previews import render_pair
    tokens = CTA_TEMPLATE_TOKENS[stem]
    rendered, unresolved = render_pair(stem, tokens)
    assert not [u for u in unresolved if u.startswith("cta.")]
    html = rendered["html"]
    assert "__CTA_BLOCK__" not in html
    assert tokens["cta.label"] in html
    assert f'bgcolor="{tokens["cta.bg"]}"' in html
    assert 'height:46px' in html
    assert 'arcsize="22%"' in html


def test_availability_thanks_has_no_cta_block_or_tokens():
    """availability-thanks is the one template with no primary CTA — the
    splice must be a no-op there, not a missing-token failure."""
    from scripts.render_email_previews import render_pair
    rendered, unresolved = render_pair("availability-thanks", AVAIL_TOKENS)
    assert not [u for u in unresolved if u.startswith("cta.")]
    assert "__CTA_BLOCK__" not in rendered["html"]
    assert "cta.bg" not in rendered["html"]


def test_availability_reminder_cta_uses_the_magenta_exception():
    """The one documented design-system exception: magenta, not sage."""
    from scripts.render_email_previews import render_pair
    rendered, _ = render_pair("availability-reminder", REMINDER_TOKENS)
    assert 'bgcolor="#c8226d"' in rendered["html"]
    assert "#467560" not in rendered["html"]


def test_magic_link_cta_matches_shared_structural_properties():
    """magic-link.html's CTA uses Go template syntax for href/label, so a
    full-body parity check against _cta_shared.html (which still carries
    unresolved {{ cta.* }} Mustache tokens) can't apply directly. Instead
    check that the fixed structural properties — the ones that had actually
    drifted (height, arcsize, font stack, padding, border width) — match."""
    import re

    from scripts.render_email_previews import TEMPLATES
    shared = (TEMPLATES / "_cta_shared.html").read_text(encoding="utf-8")
    magic_link = (TEMPLATES / "magic-link.html").read_text(encoding="utf-8")
    match = re.search(r"<!-- CTA:BEGIN -->(.*?)<!-- CTA:END -->", magic_link, re.S)
    assert match is not None, "magic-link.html is missing CTA:BEGIN/END sentinels"
    cta_block = match.group(1)

    fixed_properties = (
        "height:46px",
        'arcsize="22%"',
        "font-family:'Geist',system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif",
        "font-weight:600",
        "padding:14px 22px",
        "letter-spacing:-0.005em",
        "border-radius:10px",
    )
    for prop in fixed_properties:
        assert prop in shared, f"{prop!r} missing from _cta_shared.html itself"
        assert prop in cta_block, f"magic-link.html's CTA has drifted on {prop!r}"


def test_magic_link_cta_has_no_leftover_deploy_placeholder():
    from scripts.render_email_previews import TEMPLATES
    magic_link = (TEMPLATES / "magic-link.html").read_text(encoding="utf-8")
    assert "cta.href" not in magic_link
    assert "cta.label" not in magic_link


# ---------------------------------------------------------------------------
# Footer brand line — assets/emails/template/_footer_brand_shared.html
# ---------------------------------------------------------------------------

FOOTER_BRAND_TEMPLATE_STEMS = (
    "availability-reminder",
    "availability-thanks",
    "rsvp-confirmation",
)


@pytest.mark.parametrize("stem", FOOTER_BRAND_TEMPLATE_STEMS)
def test_render_pair_splices_canonical_footer_brand(stem):
    from scripts.render_email_previews import (
        FOOTER_BRAND_PLACEHOLDER,
        FOOTER_BRAND_BLOCK,
        render_pair,
    )
    tokens = CTA_TEMPLATE_TOKENS.get(stem, AVAIL_TOKENS)
    rendered, _ = render_pair(stem, tokens)
    html = rendered["html"]
    assert FOOTER_BRAND_PLACEHOLDER not in html
    assert FOOTER_BRAND_BLOCK in html


def test_footer_brand_not_present_where_it_was_never_authored():
    """pre-meeting-reminder and new-paper-announcement never had the shared
    brand-line fragment as a standalone label — consolidating an *existing*
    line is not license to add new footer content to templates that lack it.
    (new-paper-announcement's own RSVP-management prose happens to contain
    the same words in a sentence — "...part of the WiDS NYC AI Reading
    Group." — which is fine; only the shared fragment's own markup must be
    absent.)"""
    from scripts.render_email_previews import FOOTER_BRAND_BLOCK, render_pair
    for stem, tokens in (
        ("pre-meeting-reminder", PRE_MEETING_TOKENS),
        ("new-paper-announcement", NEW_PAPER_TOKENS),
    ):
        rendered, _ = render_pair(stem, tokens)
        assert FOOTER_BRAND_BLOCK not in rendered["html"], stem


def test_magic_link_footer_brand_matches_shared_source():
    import re

    from scripts.render_email_previews import TEMPLATES, FOOTER_BRAND_BLOCK
    magic_link = (TEMPLATES / "magic-link.html").read_text(encoding="utf-8")
    match = re.search(
        r"<!-- FOOTER_BRAND:BEGIN -->(.*?)<!-- FOOTER_BRAND:END -->",
        magic_link,
        re.S,
    )
    assert match is not None, "magic-link.html is missing FOOTER_BRAND:BEGIN/END sentinels"
    assert match.group(1).strip() == FOOTER_BRAND_BLOCK
