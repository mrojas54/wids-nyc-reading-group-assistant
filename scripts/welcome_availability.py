"""Composer for the welcome-and-availability email (HTML + plain-text twin).

The Claude Design handoff ("Vouched in group email") specifies nine per-send
content switches. They are *not* runtime state — they are resolved once at
render time and frozen into the body. ``scripts/render_email_previews.render``
is a flat ``{{ token }}`` substituter with no conditionals, so the branching has
to happen before substitution, exactly as
``docs/runbooks/transactional-emails.md`` requires of every composer.

The handoff's own warning drove the shape of this module:

    Generate both bodies from one content object so a block toggled off drops
    from both; keeping them in sync by hand is the thing most likely to drift.

So ``compose()`` takes one :class:`Content` and returns both bodies. A block
name appears in ``welcome-availability.html`` as
``<!-- BEGIN-BLOCK: name --> … <!-- END-BLOCK: name -->`` and in
``welcome-availability.txt`` as ``[[BEGIN:name]] … [[END:name]]``. One toggle
governs both; there is no way to drop a section from one body only.

The header is not a block at all. A second "court" header once shipped
alongside the standard one, selected by a ``court_voice`` toggle; it was not
part of the Claude design and has been removed outright, so the template now
has exactly one header and nothing to switch between. (The court/queens voice
still belongs to ``new-paper-announcement`` — a different template with its
own locked voice decision.)

One invariant is enforced rather than documented: no marker and no
``{{ token }}`` survives composition. Either one means a malformed body, and
:class:`CompositionError` is raised instead of returning something mailable.

Run tests via:
    uv run pytest -c tests/pytest.ini tests/welcome_availability_test.py -v
"""
from __future__ import annotations

import html
import re
import textwrap
from dataclasses import dataclass, field
from typing import Literal

from scripts.render_email_previews import (
    TEMPLATES,
    RenderError,
    find_surviving_placeholders,
    render,
    splice_shared_blocks,
    strip_html_comments,
)

STEM = "welcome-availability"

# Blocks that are always on and therefore carry no markers: the header (A),
# the greeting + intro (C), the CTA (G), the sign-off (J), and the footer (L).
OPTIONAL_BLOCKS = (
    "vouch",
    "meet_strip",
    "availability",
    "note",
    "paper_card",
    "quote",
)

# `[[BEGIN:_doc]] … [[END:_doc]]` wraps the .txt file's own header comment. It
# is a block like any other and is always stripped.
_DOC_BLOCK = "_doc"

_HTML_BLOCK = (
    r"[ \t]*<!-- BEGIN-BLOCK: {name} -->.*?<!-- END-BLOCK: {name} -->[ \t]*\n?"
)
_TXT_BLOCK = r"[ \t]*\[\[BEGIN:{name}\]\]\n.*?[ \t]*\[\[END:{name}\]\][ \t]*\n?"

_LEFTOVER_TOKEN = re.compile(r"\{\{[^}]*\}\}")

# Deliberately precise: both templates *document* the marker syntax in their
# own header comments, writing the placeholder as a literal `<name>`. A loose
# `"BEGIN-BLOCK" in body` check matches that prose and reports a survived
# marker on a perfectly composed body. Requiring a real identifier between the
# delimiters distinguishes an actual marker from prose about markers.
LEFTOVER_MARKER = re.compile(
    r"<!--\s*(?:BEGIN|END)-BLOCK:\s*[A-Za-z0-9_]+\s*-->"
    r"|\[\[(?:BEGIN|END):[A-Za-z0-9_]+\]\]"
)


class CompositionError(RuntimeError):
    """Raised when a body would ship malformed — never returned to a caller."""


@dataclass(frozen=True)
class Blocks:
    """The per-send content switches. Defaults match the handoff's table."""

    vouch: bool = True
    meet_strip: bool = True
    availability: bool = True
    note: bool = True
    paper_card: bool = True
    quote: bool = True

    def enabled(self) -> set[str]:
        """Block names that should survive composition."""
        return {name for name in OPTIONAL_BLOCKS if getattr(self, name)}


@dataclass(frozen=True)
class Content:
    """One content object → both bodies."""

    tokens: dict[str, str]
    blocks: Blocks = field(default_factory=Blocks)


def _strip_blocks(body: str, pattern: str, keep: set[str], names: tuple[str, ...]) -> str:
    """Drop disabled blocks whole; unwrap the markers around enabled ones."""
    for name in names:
        block_re = re.compile(pattern.format(name=re.escape(name)), re.S)
        if name in keep:
            # Keep the contents, drop only the two marker lines.
            body = block_re.sub(lambda m: _unwrap(m.group(0), name), body)
        else:
            body, _ = block_re.subn("", body)
    return body


def _unwrap(block: str, name: str) -> str:
    """Remove the BEGIN/END marker lines, preserving the block's body."""
    for marker in (
        rf"[ \t]*<!-- BEGIN-BLOCK: {re.escape(name)} -->[ \t]*\n?",
        rf"[ \t]*<!-- END-BLOCK: {re.escape(name)} -->[ \t]*\n?",
        rf"[ \t]*\[\[BEGIN:{re.escape(name)}\]\][ \t]*\n?",
        rf"[ \t]*\[\[END:{re.escape(name)}\]\][ \t]*\n?",
    ):
        block = re.sub(marker, "", block)
    return block


# Documentation comments must not ship — this template's header comment alone
# is ~5 KB of repo file paths, migration numbers, design rationale, and the
# *alternate* wording of copy the recipient is reading. The stripper (and the
# reasoning behind its sentinel dance, which is what keeps the Outlook
# conditionals alive) lives in `scripts.render_email_previews` so this composer
# and the preview/JSON renderer cannot drift apart on what ships.


def _strip_html_comments(body: str) -> str:
    """Strip doc comments, restating failures as :class:`CompositionError`.

    ``compose()`` promises exactly one failure type, so the shared stripper's
    :class:`RenderError` is translated rather than allowed to escape.
    """
    try:
        return strip_html_comments(body)
    except RenderError as exc:
        raise CompositionError(str(exc)) from exc


#: The handoff hard-wraps the plain-text twin at ~68 characters.
TXT_WIDTH = 68


def _wrap_txt(body: str) -> str:
    """Re-wrap the twin to TXT_WIDTH after substitution.

    The fixed copy in welcome-availability.txt is already wrapped, so this is
    a no-op for it. What it exists for is the per-cycle tokens — paper.title,
    paper.hook, quote.text — which arrive as single long strings and would
    otherwise ship one 140-column line into a plain-text reader.

    Lines with no spaces are left alone: that is how the bare URL lines
    ({{ links.availability }}, Companion:) survive intact, since a wrapped
    URL is a broken URL.
    """
    out: list[str] = []
    for line in body.split("\n"):
        stripped = line.strip()
        if len(line) <= TXT_WIDTH or " " not in stripped:
            out.append(line)
            continue
        indent = line[: len(line) - len(line.lstrip())]
        out.extend(
            textwrap.wrap(
                stripped,
                width=TXT_WIDTH,
                initial_indent=indent,
                subsequent_indent=indent,
                break_long_words=False,
                break_on_hyphens=False,
            )
        )
    return "\n".join(out)


def _compose_one(
    ext: Literal["html", "txt"], content: Content
) -> tuple[str, list[str]]:
    src = (TEMPLATES / f"{STEM}.{ext}").read_text(encoding="utf-8")
    pattern = _HTML_BLOCK if ext == "html" else _TXT_BLOCK
    keep = content.blocks.enabled()

    names = OPTIONAL_BLOCKS
    if ext == "txt":
        # The twin carries its own doc comment, which never ships.
        names = (_DOC_BLOCK,) + OPTIONAL_BLOCKS

    body = _strip_blocks(src, pattern, keep, names)
    tokens = content.tokens
    if ext == "html":
        # Splice shared fragments (wordmark, CTA skeleton, footer brand line)
        # before comment-stripping and before the blanket html.escape() below
        # — see render_email_previews.SPLICE_BLOCKS for why these can't be
        # {{ }} tokens (escape() would corrupt the wordmark's raw markup) or
        # HTML comments (strip_html_comments() would delete them). The {{
        # cta.* }} tokens embedded inside the spliced CTA skeleton are plain
        # text/URLs, so they resolve normally through the escaped tokens dict
        # below along with everything else.
        body = splice_shared_blocks(body)
        # Before substitution: the header comment lists token names, and
        # stripping first keeps them out of the unresolved tally entirely.
        body = _strip_html_comments(body)
        # render() is a plain string substituter with no escaping, so a token
        # value goes into the markup verbatim. "Michelle & Claudia" then ships
        # a bare ampersand — which browsers forgive, but is invalid, and a name
        # or paper title containing < or > would break the document outright.
        # No token in this template is meant to carry markup (unlike
        # availability-reminder's paper.citation, which deliberately holds an
        # <em>), so escaping all of them is safe and closes the whole class.
        tokens = {k: html.escape(v, quote=True) for k, v in tokens.items()}
    rendered, unresolved = render(body, tokens)
    if ext == "txt":
        rendered = _wrap_txt(rendered)
    return rendered, unresolved


def compose(content: Content) -> dict[str, str]:
    """Return ``{"html": ..., "txt": ...}`` for one send.

    Raises :class:`CompositionError` if a token is unresolved or a marker
    survives in either body — both mean the body is not mailable, and a loud
    failure here is cheaper than a member receiving a literal ``{{ … }}``.
    """
    bodies: dict[str, str] = {}
    unresolved: list[str] = []
    for ext in ("html", "txt"):
        body, missing = _compose_one(ext, content)
        bodies[ext] = body
        unresolved.extend(missing)

    if unresolved:
        raise CompositionError(
            f"unresolved tokens: {sorted(set(unresolved))}"
        )

    for ext, body in bodies.items():
        if LEFTOVER_MARKER.search(body):
            raise CompositionError(f"block marker survived composition in .{ext}")
        if _LEFTOVER_TOKEN.search(body):
            leftover = sorted(set(_LEFTOVER_TOKEN.findall(body)))
            raise CompositionError(f"literal braces left in .{ext}: {leftover}")
        surviving = find_surviving_placeholders(body)
        if surviving:
            raise CompositionError(
                f"{surviving} survived composition in .{ext} — "
                "a shared-fragment splice did not run"
            )

    return bodies


# --------------------------------------------------------------------------
# Preview
# --------------------------------------------------------------------------
# render_email_previews.main() can't drive this template — render_pair() reads
# straight off disk and has no way to resolve blocks first. So the preview
# lives here and writes the same gitignored *_rendered.{html,txt} pair the
# other templates produce, keeping `uv run python -m scripts.<x>` muscle
# memory intact.

PREVIEW_TOKENS = {
    "recipient.firstName": "Priyanka",
    "vouch.firstName": "Michelle",
    "vouch.blurb": (
        "I'm your person for anything you want to ask before the first "
        "meeting."
    ),
    "answerBy": "Mon, Aug 3",
    "links.availability": (
        "https://wids-nyc-reading-group-assistant.vercel.app/availability?meeting=37"
    ),
    "links.companion": (
        "https://wids-nyc-reading-group-assistant.vercel.app/papers/40"
    ),
    "signoff.names": "Michelle & Claudia",
    "operator.email": "hello@example.org",
    "paper.title": "Meta-Harness: End-to-End Optimization of Model Harnesses",
    "paper.byline": "Lee, Nair, Zhang et al.",
    "paper.citation": "arXiv:2603.28052",
    "paper.hook": (
        "What if you stopped tuning the model and let an agent rewrite the "
        "code around it instead — the retrieval, the memory, the prompt "
        "assembly?"
    ),
    "cta.bg": "#467560",
    "cta.borderColor": "#355c4b",
    "cta.width": "210",
    "cta.href": "https://wids-nyc-reading-group-assistant.vercel.app/availability?meeting=37",
    "cta.label": "Open availability →",
}

# Fixed date_key so preview output is deterministic in CI.
PREVIEW_DATE_KEY = 20658


def main() -> int:
    """Render both bodies with sample data; write the *_rendered pair."""
    from scripts.quotes import load_bundle, quote_tokens, select_quote

    quote = quote_tokens(select_quote(load_bundle(), PREVIEW_DATE_KEY))
    tokens = {**PREVIEW_TOKENS, "quote.text": quote["quote.text"],
              "quote.by": quote["quote.by"]}

    bodies = compose(Content(tokens=tokens, blocks=Blocks()))
    for ext, body in bodies.items():
        dst = TEMPLATES / f"{STEM}_rendered.{ext}"
        dst.write_text(body, encoding="utf-8")
        print(f"wrote {dst.relative_to(TEMPLATES.parents[2])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
