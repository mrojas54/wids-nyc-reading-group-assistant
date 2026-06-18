"""Discussion-question composition for the pre-meeting reminder email.

Loads a static questions JSON and composes the three Mustache tokens the
email template injects: a count-aware lede, an email-safe HTML row block,
and a plain-text numbered list. Mirrors scripts/quotes.py (pure load +
transform, no template logic) so render_email_previews can stay a flat
{{ token }} substitution.

The static source is a v1 seam: repoint SAMPLE_PATH (or pass `path`) at a
per-paper source later without touching the template or the composer.

Run tests via:
    uv run pytest tests/discussion_questions_test.py -v
"""
from __future__ import annotations

import html
import json
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SAMPLE_PATH = REPO_ROOT / "data" / "discussion-questions" / "sample.json"

_NUMBER_WORDS = {
    1: "One", 2: "Two", 3: "Three", 4: "Four", 5: "Five", 6: "Six",
    7: "Seven", 8: "Eight", 9: "Nine", 10: "Ten", 11: "Eleven", 12: "Twelve",
}

# Full email-safe font stacks, reused by the composed HTML rows so they match
# the template's inline styles exactly.
_SANS = "'Geist',system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif"
_MONO = "'Geist Mono',ui-monospace,Menlo,monospace"


def load_questions(path: Path = SAMPLE_PATH) -> list[str]:
    """Read the static questions JSON: {"questions": ["…", …]}.

    Raises RuntimeError (actionable) when the file is missing, not valid
    JSON, or the `questions` array is absent / empty / contains a
    blank-or-non-string entry — so a broken source fails loudly in
    preview/CI instead of silently rendering an empty list.
    """
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        raise RuntimeError(
            f"Discussion-questions file not found at {path}."
        ) from None
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise RuntimeError(
            f"Discussion-questions file at {path} is not valid JSON ({exc})."
        ) from exc
    raw = data.get("questions") if isinstance(data, dict) else None
    if not isinstance(raw, list) or not raw:
        raise RuntimeError(
            f'Discussion-questions file at {path} must have a non-empty '
            '"questions" array.'
        )
    result: list[str] = []
    for q in raw:
        if not isinstance(q, str) or not q.strip():
            raise RuntimeError(
                f'Every entry in {path} "questions" must be a non-empty string.'
            )
        result.append(q)
    return result


def _count_word(n: int) -> str:
    return _NUMBER_WORDS.get(n, str(n))


def question_tokens(questions: list[str]) -> dict[str, str]:
    """Compose the three email tokens from a question list.

    questions.lede  — count-aware lede sentence.
    questions.html  — <tr> rows for the template's question <table>; question
                      text is HTML-escaped; dashed separators between rows.
    questions.text  — plain numbered list for the .txt counterpart.
    """
    lede = (
        f"{_count_word(len(questions))} to chew on — "
        "pick the ones that pull at you."
    )
    rows: list[str] = []
    last = len(questions) - 1
    for i, q in enumerate(questions):
        border = "" if i == last else "border-bottom:1px dashed #b9ae96;"
        num = f"{i + 1:02d}"
        cell = html.escape(q, quote=False)
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
    text = "\n\n".join(f"{i + 1:02d}. {q}" for i, q in enumerate(questions))
    return {
        "questions.lede": lede,
        "questions.html": "\n".join(rows),
        "questions.text": text,
    }
