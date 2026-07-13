"""Recommended-prerequisites token composition for the new-paper announcement.

Mirrors scripts/discussion_questions.py: a pure transform from a lede + list of
items into the three Mustache tokens the email template injects — a lede, an
email-safe HTML <tr> block, and a plain-text numbered list. Keeping the
HTML/text split here lets render_email_previews stay a flat {{ token }}
substitution (one token can't be both HTML-escaped and plain).

Run tests via:
    uv run pytest -c tests/pytest.ini tests/prerequisites_test.py -v
"""
from __future__ import annotations

import html

# Font stacks match the template's inline styles exactly (email-safe).
_SANS = "'Geist',system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif"
_MONO = "'Geist Mono',ui-monospace,Menlo,monospace"


def prereq_tokens(lede: str, items: list[str]) -> dict[str, str]:
    """Compose the three email tokens from a lede + prerequisite items.

    prereqs.lede — the (AI-drafted) framing sentence, verbatim.
    prereqs.html — <tr> rows for the template's <table>; items HTML-escaped;
                   dashed separators between rows (last row omits it).
    prereqs.text — plain numbered list for the .txt counterpart.

    Raises ValueError on a blank lede, empty items, or a blank/non-string item
    so a broken draft fails loudly in preview/CI instead of rendering empty.
    """
    if not isinstance(lede, str) or not lede.strip():
        raise ValueError("prereq lede must be a non-empty string")
    if not items:
        raise ValueError("prereq items must be a non-empty list")
    for it in items:
        if not isinstance(it, str) or not it.strip():
            raise ValueError("every prereq item must be a non-empty string")

    rows: list[str] = []
    last = len(items) - 1
    for i, it in enumerate(items):
        border = "" if i == last else "border-bottom:1px dashed #b9ae96;"
        num = f"{i + 1:02d}"
        cell = html.escape(it, quote=False)
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
    text = "\n\n".join(f"{i + 1:02d}. {it}" for i, it in enumerate(items))
    return {
        "prereqs.lede": lede,
        "prereqs.html": "\n".join(rows),
        "prereqs.text": text,
    }
