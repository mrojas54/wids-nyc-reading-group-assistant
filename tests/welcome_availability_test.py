"""Tests for scripts/welcome_availability.py.

The handoff's stated risk is the two bodies drifting apart, so most of these
assert the HTML and .txt twin move together. Run via:
    uv run pytest -c tests/pytest.ini tests/welcome_availability_test.py -v
"""
from __future__ import annotations


def test_module_imports():
    """Smoke test: the composer is importable."""
    from scripts.welcome_availability import compose
    assert callable(compose)


import pytest

from scripts.welcome_availability import (
    LEFTOVER_MARKER,
    OPTIONAL_BLOCKS,
    Blocks,
    CompositionError,
    Content,
    compose,
)

#: Operator's pick for handoff Open Question 5 — the group's in-house address,
#: not a name slot. Both bodies must carry it identically.
GREETING = "Hey Queen,"

TOKENS = {
    # Passed but unused by this template (the greeting carries no name). Kept
    # in the fixture to prove an extra token is harmless: render() only
    # complains about tokens the template needs and the caller omitted.
    "recipient.firstName": "Priyanka",
    "vouch.name": "Michelle Rojas",
    "answerBy": "Mon, Aug 3",
    "links.availability": "https://example.test/availability?meeting=37",
    "links.companion": "https://example.test/papers/40",
    "signoff.names": "Michelle & Claudia",
    "operator.email": "ops@example.test",
    "paper.title": "Meta-Harness: End-to-End Optimization of Model Harnesses",
    "paper.byline": "Lee, Nair, Zhang et al.",
    "paper.citation": "arXiv:2603.28052",
    "paper.hook": "What if you stopped tuning the model?",
    "quote.text": "Like what you do, and then you will do your best.",
    "quote.by": "Katherine Johnson",
}


def _compose(**block_kwargs) -> dict[str, str]:
    return compose(Content(tokens=TOKENS, blocks=Blocks(**block_kwargs)))


def test_defaults_compose_both_bodies():
    bodies = _compose()
    assert set(bodies) == {"html", "txt"}
    assert bodies["html"].lstrip().startswith("<!doctype html>")
    assert bodies["txt"].startswith(GREETING)


def test_both_bodies_use_the_same_greeting():
    """The two greetings drifted in the handoff itself — HTML said "Hey Queen,"
    while the twin said "Hi [First name],". Pin them together."""
    bodies = _compose()
    assert GREETING in bodies["html"]
    assert bodies["txt"].startswith(GREETING)
    # And no stale personalised greeting survives in either body.
    for body in bodies.values():
        assert "Hi Priyanka" not in body
        assert "Hi {{" not in body


def test_greeting_carries_no_name_so_middle_name_members_are_safe():
    """A member who goes by her middle name is mis-greeted by
    split_part(name,' ',1). This register sidesteps that entirely."""
    bodies = compose(
        Content(tokens={**TOKENS, "recipient.firstName": "Sai"})
    )
    for body in bodies.values():
        assert "Sai" not in body


def test_no_marker_or_literal_token_survives():
    """compose() raises rather than returning either — assert it stays clean.

    Uses the module's precise marker regex, not a substring check: both
    templates document the marker syntax in their own header comments, so
    `"BEGIN-BLOCK" in body` is true for a correctly composed body.
    """
    for body in _compose().values():
        assert LEFTOVER_MARKER.search(body) is None
        assert "{{" not in body


def test_marker_regex_ignores_prose_about_markers():
    """Regression guard for the substring-check trap described above."""
    assert LEFTOVER_MARKER.search("<!-- BEGIN-BLOCK: <name> --> is the syntax") is None
    assert LEFTOVER_MARKER.search("[[BEGIN:<name>]] / [[END:<name>]] lines") is None
    assert LEFTOVER_MARKER.search("<!-- BEGIN-BLOCK: vouch -->") is not None
    assert LEFTOVER_MARKER.search("[[END:vouch]]") is not None


def _visible_text(html_body: str) -> str:
    """Text a mail client would actually paint — comments and CSS excluded."""
    from html.parser import HTMLParser

    class Extract(HTMLParser):
        def __init__(self) -> None:
            super().__init__(convert_charrefs=True)
            self.chunks: list[str] = []
            self._skip = 0

        def handle_starttag(self, tag, attrs):
            if tag in ("style", "script", "title"):
                self._skip += 1

        def handle_endtag(self, tag):
            if tag in ("style", "script", "title") and self._skip:
                self._skip -= 1

        def handle_data(self, data):
            if not self._skip:
                self.chunks.append(data)

        # handle_comment is intentionally not overridden: comment bodies are
        # dropped, which is the whole point of the check below.

    parser = Extract()
    parser.feed(html_body)
    return " ".join(" ".join(parser.chunks).split())


def test_head_comment_never_leaks_into_visible_text():
    """Regression: a nested comment close dumped the whole doc block on-screen.

    The head comment used to reproduce the literal marker syntax, whose `-->`
    terminated the comment early — every implementation note after it rendered
    as body text at the top of the email. Nothing in the token or marker checks
    catches that, because the markup is structurally fine; only the rendered
    text is wrong.
    """
    visible = _visible_text(_compose()["html"])
    for leak in (
        "BLOCK MARKERS",
        "scripts/welcome_availability.py",
        "Port decisions",
        "Compatibility target",
        "operator-supplied, no schema column",
    ):
        assert leak not in visible, f"head comment leaked into the body: {leak!r}"


def test_visible_text_starts_at_the_headline():
    """Whatever precedes the mark is preheader or nothing — never prose."""
    visible = _visible_text(_compose()["html"])
    headline = "So glad you're here"
    assert headline in visible
    # Only the hidden preheader may precede it.
    assert visible.index(headline) < 200, visible[:200]


def test_txt_doc_comment_never_ships():
    """The .txt file's own header comment is a block and must be stripped."""
    txt = _compose()["txt"]
    assert "Plain-text twin of welcome-availability.html" not in txt
    assert "block markers consumed by" not in txt


def test_exactly_one_header_renders():
    standard = _compose(court_voice=False)["html"]
    assert "So glad you're here" in standard
    assert "A Member Said Your Name" not in standard

    court = _compose(court_voice=True)["html"]
    assert "A Member Said Your Name" in court
    assert "one open chair" in court
    assert "So glad you're here" not in court


def test_court_voice_does_not_change_the_twin():
    """The twin opens at the greeting either way — HTML-only by design."""
    assert _compose(court_voice=True)["txt"] == _compose(court_voice=False)["txt"]


@pytest.mark.parametrize(
    ("block", "html_probe", "txt_probe"),
    [
        ("vouch", "Vouched in by", "VOUCHED IN BY"),
        ("meet_strip", "Every two months", "THE GROUP"),
        ("availability", "What we need from you", "WHAT WE NEED FROM YOU"),
        ("note", "Signing in the first time", "SIGNING IN THE FIRST TIME"),
        ("paper_card", "This cycle's paper", "THIS CYCLE'S PAPER"),
        ("quote", "Katherine Johnson", "Katherine Johnson"),
    ],
)
def test_block_drops_from_both_bodies_together(block, html_probe, txt_probe):
    """The whole point of one content object: a toggle moves both bodies."""
    on = _compose(**{block: True})
    assert html_probe in on["html"]
    assert txt_probe in on["txt"]

    off = _compose(**{block: False})
    assert html_probe not in off["html"]
    assert txt_probe not in off["txt"]


def test_every_optional_block_is_covered_by_the_drop_test():
    """Guard against adding a block and forgetting to parametrize it."""
    covered = {
        "vouch",
        "meet_strip",
        "availability",
        "note",
        "paper_card",
        "quote",
    }
    assert covered == set(OPTIONAL_BLOCKS)


def test_always_on_blocks_survive_everything_off():
    bodies = _compose(
        vouch=False,
        meet_strip=False,
        availability=False,
        note=False,
        paper_card=False,
        quote=False,
    )
    # Greeting (C), CTA (G), sign-off (J), footer (L) carry no markers.
    assert GREETING in bodies["html"]
    assert "Open availability" in bodies["html"]
    assert "See you in the room" in bodies["html"]
    assert "vouched you in. " in bodies["html"]

    assert GREETING in bodies["txt"]
    assert "Open availability:" in bodies["txt"]
    assert "See you in the room," in bodies["txt"]
    assert bodies["txt"].rstrip().endswith("Reply to come off this list.")


def test_twin_is_hard_wrapped_except_urls():
    """The handoff wraps the twin at ~68; per-cycle tokens must wrap too."""
    from scripts.welcome_availability import TXT_WIDTH

    for line in _compose()["txt"].split("\n"):
        if len(line) <= TXT_WIDTH:
            continue
        # Only an unwrappable single token (a URL) may exceed the width.
        assert " " not in line.strip(), f"unwrapped line: {line!r}"


def test_wrapping_never_breaks_a_url():
    txt = _compose()["txt"]
    assert "https://example.test/availability?meeting=37" in txt
    assert "https://example.test/papers/40" in txt


def test_wrapping_preserves_bullet_indentation():
    lines = _compose()["txt"].split("\n")
    bullets = [ln for ln in lines if ln.lstrip().startswith("·")]
    assert bullets, "the ask block should render three bullets"
    assert all(ln.startswith("  ·") for ln in bullets), bullets


def test_no_orphan_word_lines_in_prose():
    """Regression: pre-wrapped copy + a longer real name produced an orphan.

    The README's twin was laid out around a short "[Member]" placeholder. With
    a real name substituted, line-by-line wrapping left "she's / your /
    person" — a one-word line mid-paragraph. Prose is now stored unwrapped so
    the whole paragraph re-flows.
    """
    lines = _compose()["txt"].split("\n")
    for i, line in enumerate(lines[1:-1], start=1):
        if len(line.split()) != 1:
            continue
        # An orphan is a one-word line *inside* a paragraph — i.e. with
        # non-blank text both above and below it. A lone word that starts or
        # ends a block (a heading, a URL, the footer's em-dash rule) is fine.
        mid_paragraph = lines[i - 1].strip() != "" and lines[i + 1].strip() != ""
        assert not mid_paragraph, (
            f"orphan word line at {i}: {line!r} "
            f"between {lines[i - 1]!r} and {lines[i + 1]!r}"
        )


def test_long_vouch_name_still_reflows_cleanly():
    long_name = "Alexandra Konstantinopoulos-Fitzgerald"
    bodies = compose(Content(tokens={**TOKENS, "vouch.name": long_name}))
    txt = bodies["txt"]
    assert long_name in txt
    for line in txt.split("\n"):
        assert len(line) <= 68 or " " not in line.strip(), line


def test_long_token_value_is_wrapped():
    """A 140-column hook is what motivated the wrap step."""
    long_hook = "word " * 60
    bodies = compose(Content(tokens={**TOKENS, "paper.hook": long_hook.strip()}))
    assert all(len(ln) <= 68 or " " not in ln.strip()
               for ln in bodies["txt"].split("\n"))


def test_cta_href_survives_in_both_bodies():
    bodies = _compose()
    assert "https://example.test/availability?meeting=37" in bodies["html"]
    assert "https://example.test/availability?meeting=37" in bodies["txt"]


def test_companion_link_is_a_token_not_a_hardcoded_url():
    """The prototype hardcoded /papers/40 for click-through during review."""
    src = (
        __import__("pathlib")
        .Path(__file__)
        .resolve()
        .parent.parent
        / "assets/emails/template/welcome-availability.html"
    ).read_text(encoding="utf-8")
    assert "{{ links.companion }}" in src
    assert "vercel.app/papers/40" not in src


def test_missing_token_raises_rather_than_mailing_braces():
    thin = {k: v for k, v in TOKENS.items() if k != "vouch.name"}
    with pytest.raises(CompositionError) as excinfo:
        compose(Content(tokens=thin))
    assert "vouch.name" in str(excinfo.value)


def test_vouch_off_still_requires_the_name_and_says_so_loudly():
    """Documented wart, not an oversight.

    `vouch.name` appears in three places — the intro sentence, the vouch card,
    and the footer — but only the card sits inside the toggled block, because
    the other two are mid-sentence and the no-voucher copy is a decision the
    operator has to make. So `Blocks(vouch=False)` without the token raises
    instead of quietly shipping a sentence with a hole in it. If no-voucher
    copy ever lands, wrap those two sites and delete this test.
    """
    thin = {k: v for k, v in TOKENS.items() if k != "vouch.name"}
    with pytest.raises(CompositionError) as excinfo:
        compose(Content(tokens=thin, blocks=Blocks(vouch=False)))
    assert "vouch.name" in str(excinfo.value)


def test_paper_tokens_not_required_when_paper_card_is_off():
    """Toggling a block off should also drop its token requirements."""
    thin = {k: v for k, v in TOKENS.items() if not k.startswith("paper.")}
    bodies = compose(Content(tokens=thin, blocks=Blocks(paper_card=False)))
    assert "THIS CYCLE'S PAPER" not in bodies["txt"]
