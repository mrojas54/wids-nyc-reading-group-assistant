"""Recommended-prerequisites token composition for the new-paper announcement.

Mirrors scripts/discussion_questions.py: a pure transform from a lede + list of
items into the three Mustache tokens the email template injects — a lede, an
email-safe HTML <tr> block, and a plain-text numbered list. Keeping the
HTML/text split here lets render_email_previews stay a flat {{ token }}
substitution (one token can't be both HTML-escaped and plain).

Each item is either a plain string or a mapping ``{"text": ..., "url": ...}``.
When a ``url`` is present the HTML row renders a clickable ``<a>`` and the
plain-text line appends the bare URL, so members get a link to review the
concept before the discussion.

Run tests via:
    uv run pytest -c tests/pytest.ini tests/prerequisites_test.py -v
"""
from __future__ import annotations

import html
from typing import Any

# Font stacks match the template's inline styles exactly (email-safe).
_SANS = "'Geist',system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif"
_MONO = "'Geist Mono',ui-monospace,Menlo,monospace"


def _item_text_url(item: Any) -> tuple[str, str | None]:
    """Normalise an item to ``(text, url_or_None)``.

    Accepts a plain string (no link) or a ``{"text", "url"}`` mapping where
    ``url`` is optional. Raises ValueError on a blank/non-string text or a
    blank/non-string url so a broken draft fails loudly in preview/CI.
    """
    if isinstance(item, str):
        text, url = item, None
    elif isinstance(item, dict):
        text, url = item.get("text"), item.get("url")
    else:
        raise ValueError("every prereq item must be a string or a {text, url} mapping")
    if not isinstance(text, str) or not text.strip():
        raise ValueError("every prereq item must have non-empty text")
    if url is not None and (not isinstance(url, str) or not url.strip()):
        raise ValueError("a prereq item url must be a non-empty string when provided")
    return text, url


def prereq_tokens(lede: str, items: list[Any]) -> dict[str, str]:
    """Compose the three email tokens from a lede + prerequisite items.

    prereqs.lede — the (AI-drafted) framing sentence, verbatim.
    prereqs.html — <tr> rows for the template's <table>; item text HTML-escaped,
                   rendered as a link when the item carries a url; dashed
                   separators between rows (last row omits it).
    prereqs.text — plain numbered list for the .txt counterpart; a linked item
                   appends its bare URL.

    Raises ValueError on a blank lede, empty items, or a malformed item so a
    broken draft fails loudly in preview/CI instead of rendering empty.
    """
    if not isinstance(lede, str) or not lede.strip():
        raise ValueError("prereq lede must be a non-empty string")
    if not items:
        raise ValueError("prereq items must be a non-empty list")
    normalized = [_item_text_url(it) for it in items]

    rows: list[str] = []
    text_lines: list[str] = []
    last = len(normalized) - 1
    for i, (text_val, url) in enumerate(normalized):
        border = "" if i == last else "border-bottom:1px dashed #b9ae96;"
        num = f"{i + 1:02d}"
        cell = html.escape(text_val, quote=False)
        if url:
            href = html.escape(url, quote=True)
            cell = (
                f'<a href="{href}" style="color:#c8226d;'
                f'text-decoration:underline;">{cell}</a>'
            )
        rows.append(
            "<tr>"
            f'<td valign="top" style="padding:14px 14px 14px 0;{border}'
            f"font-family:{_MONO};font-size:12px;color:#c8226d;"
            f'line-height:1.55;width:30px;">{num}</td>'
            f'<td valign="top" style="padding:14px 0;{border}'
            f"font-family:{_SANS};font-size:15px;line-height:1.55;"
            f'color:#1a160f;">{cell}</td>'
            "</tr>"
        )
        line = f"{num}. {text_val}"
        text_lines.append(f"{line} — {url}" if url else line)
    return {
        "prereqs.lede": lede,
        "prereqs.html": "\n".join(rows),
        "prereqs.text": "\n\n".join(text_lines),
    }
