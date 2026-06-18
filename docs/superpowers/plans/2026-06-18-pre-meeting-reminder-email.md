# Pre-Meeting Reminder Email Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the Claude Design hifi handoff into a production, email-client-safe `pre-meeting-reminder.{html,txt}` template pair, fed by a static discussion-questions JSON and the existing quote rotation, wired into the preview/token-check harness.

**Architecture:** A pure Python composer (`scripts/discussion_questions.py`, mirroring `scripts/quotes.py`) reads a static `data/discussion-questions/sample.json` and emits three Mustache tokens (`questions.lede/html/text`). The email templates stay logic-free; `scripts/render_email_previews.py` substitutes the question tokens + the existing `quote.*` tokens via flat `{{ }}` replacement. Nothing is wired into the live scheduled task this pass.

**Tech Stack:** Python ≥3.11, `uv` (run/sync), `pytest`, `ruff`, `ty` (type checker — the repo migrated off mypy). Email = table-based HTML + a plain `.txt` alternative.

## Global Constraints

Every task's requirements implicitly include this section. Values copied verbatim from the spec (`docs/superpowers/specs/2026-06-18-pre-meeting-reminder-email-design.md`).

- **Tokens are Mustache-style `{{ name.path }}` only.** The renderer does flat substitution with **no partials, no conditionals, no loops** — anything variable-length or computed is pre-composed in Python and injected as a ready-made token.
- **Email-client-safe markup:** table-based layout, all colors inlined as literal hex, VML `roundrect` fallback for the CTA button, hidden preheader, `@media (max-width:600px)` responsive block, self-hosted/fallback font stacks (Geist → system sans; Newsreader → Charter/Georgia serif; Geist Mono → `ui-monospace`/Menlo). **No `rgba()` backgrounds** (Outlook drops them) — use solid hex. **No `background-image`** as a dependency (clients strip it).
- **Handoff palette (authoritative):** magenta `#c8226d`/`#a8175a`/`#861148`; sage `#467560`/`#355c4b`/`#244338`/`#152a23`/`#95b9a3`; paper `#fefcef`/`#ddd4be`/`#b9ae96`/`#a89978`; foreground `#1a160f`/`#29241b`/`#594d3b`/`#7e6f55`; dark backdrop `#1a160f`.
- **Reuse existing token names** where the sibling templates already define them (`recipient.firstName`, `links.calendar`, `paper.title`, `paper.companionUrl`, `links.rsvpManage`, `links.portalBase`, `quote.text/by/role`). Only true data is tokenized; handoff prose is baked in as static copy.
- **Quote block is optional-with-fallback** (an unresolved quote never blocks a send). **Every other unresolved token fails the preview build** (`render_email_previews.main()` returns 1).
- **Never ships:** the Tweaks panel (`tweaks-panel.jsx`), the `.meta-strip` and `.post-note` prototype chrome.
- **Do NOT touch** `scheduled_tasks/pre-meeting-reminder.md`, any migration/schema, or the `web/` app. Recipients + per-paper question auto-load are deferred follow-ups.
- **Quality gates before every commit:** `uv run ruff check` clean, `uv run ty check` clean, `uv run pytest` green. Use `uv` for all commands (never bare `python`/`pip`). Run from the repo root (`pyproject.toml` lives there — there is no `python/` subdir).

---

### Task 1: Discussion-questions composer + static source

Pure load + transform, no I/O coupling to the templates. Built test-first.

**Files:**
- Create: `scripts/discussion_questions.py`
- Create: `data/discussion-questions/sample.json`
- Test: `tests/discussion_questions_test.py`

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces (later tasks rely on these exact signatures):
  - `SAMPLE_PATH: pathlib.Path` — the v1 static source location (the single seam a later per-paper auto-loader repoints).
  - `load_questions(path: pathlib.Path = SAMPLE_PATH) -> list[str]` — reads `{"questions": [...]}`; raises `RuntimeError` on missing file / invalid JSON / absent-or-empty array / any non-string-or-blank entry.
  - `question_tokens(questions: list[str]) -> dict[str, str]` — returns exactly the keys `"questions.lede"`, `"questions.html"`, `"questions.text"`.

- [ ] **Step 1: Write the failing tests**

Create `tests/discussion_questions_test.py`:

```python
"""Tests for scripts/discussion_questions.py.

Run via:
    uv run pytest tests/discussion_questions_test.py -v
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from scripts.discussion_questions import (
    SAMPLE_PATH,
    load_questions,
    question_tokens,
)


def _write(path: Path, obj: object) -> Path:
    path.write_text(json.dumps(obj), encoding="utf-8")
    return path


def test_sample_source_ships_and_loads():
    assert SAMPLE_PATH.exists()
    qs = load_questions()
    assert len(qs) == 8
    assert all(isinstance(q, str) and q.strip() for q in qs)


def test_load_missing_file_raises(tmp_path):
    with pytest.raises(RuntimeError, match="not found"):
        load_questions(tmp_path / "nope.json")


def test_load_bad_json_raises(tmp_path):
    p = tmp_path / "bad.json"
    p.write_text("{not json", encoding="utf-8")
    with pytest.raises(RuntimeError, match="not valid JSON"):
        load_questions(p)


def test_load_empty_array_raises(tmp_path):
    p = _write(tmp_path / "empty.json", {"questions": []})
    with pytest.raises(RuntimeError, match="non-empty"):
        load_questions(p)


def test_load_missing_key_raises(tmp_path):
    p = _write(tmp_path / "nokey.json", {"items": ["a"]})
    with pytest.raises(RuntimeError, match="non-empty"):
        load_questions(p)


def test_load_blank_entry_raises(tmp_path):
    p = _write(tmp_path / "blank.json", {"questions": ["ok", "   "]})
    with pytest.raises(RuntimeError, match="non-empty string"):
        load_questions(p)


def test_tokens_keys_exact():
    tokens = question_tokens(["a", "b"])
    assert set(tokens) == {"questions.lede", "questions.html", "questions.text"}


def test_lede_is_count_aware():
    assert question_tokens(["a"] * 8)["questions.lede"].startswith("Eight to chew on")
    assert question_tokens(["a"] * 3)["questions.lede"].startswith("Three to chew on")
    # past the word map, falls back to the digit
    assert question_tokens(["a"] * 13)["questions.lede"].startswith("13 to chew on")


def test_html_numbers_zero_padded_and_one_row_each():
    html = question_tokens(["first", "second"])["questions.html"]
    assert ">01<" in html
    assert ">02<" in html
    assert html.count("<tr>") == 2


def test_html_dashed_border_on_all_but_last_row():
    # 3 rows -> 2 non-last rows x 2 cells each = 4 dashed borders.
    html = question_tokens(["a", "b", "c"])["questions.html"]
    assert html.count("border-bottom:1px dashed") == 4


def test_html_escapes_ampersand():
    html = question_tokens(["S&P 500 vs NASDAQ"])["questions.html"]
    assert "S&amp;P 500" in html


def test_text_is_plain_numbered_and_unescaped():
    text = question_tokens(["S&P 500", "second"])["questions.text"]
    assert "01. S&P 500" in text
    assert "02. second" in text
    assert "&amp;" not in text
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run pytest tests/discussion_questions_test.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'scripts.discussion_questions'`.

- [ ] **Step 3: Create the static question source**

Create `data/discussion-questions/sample.json` (the handoff's eight questions verbatim, plain text — per-phrase bold is dropped so the future auto-loader needn't emit markup):

```json
{
  "questions": [
    "Why did the authors combine LSTM and Transformer instead of relying on a single architecture?",
    "Do the six selected features — NASDAQ, S&P 500, silver futures, USD/CNY, China bond yield, and a coal ETF — genuinely make sense for predicting gold futures?",
    "Can the hybrid model truly handle sudden market shocks — war, rate hikes, banking crises — or does it only learn past patterns?",
    "The model performs well but is more complex and slower. Is the extra accuracy worth the extra computation cost?",
    "Is prediction accuracy enough, or should the paper also show the model helps with real trading, hedging, or risk decisions?",
    "If it works for Shanghai gold futures, could it also predict Indian or COMEX gold prices?",
    "The paper says ARIMA, GARCH, and VAR are limited for gold forecasting. Do the authors explain that limitation clearly enough?",
    "XGBoost–SHAP is used to select key features. Is this a strong method, or could it still miss important market variables?"
  ]
}
```

- [ ] **Step 4: Write the composer module**

Create `scripts/discussion_questions.py`:

```python
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
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `uv run pytest tests/discussion_questions_test.py -v`
Expected: PASS (12 tests).

- [ ] **Step 6: Lint + type-check**

Run: `uv run ruff check scripts/discussion_questions.py tests/discussion_questions_test.py`
Expected: `All checks passed!`
Run: `uv run ty check`
Expected: no errors (ty's scope is `scripts/`).

- [ ] **Step 7: Commit**

```bash
git add scripts/discussion_questions.py data/discussion-questions/sample.json tests/discussion_questions_test.py
git commit -m "feat: discussion-questions composer for pre-meeting reminder email"
```

---

### Task 2: `pre-meeting-reminder` template pair + preview/test wiring

The template files + their registration in the preview harness form one test cycle (a template can't be meaningfully verified without the renderer). Failing tests first, then the templates + wiring.

**Files:**
- Create: `assets/emails/template/pre-meeting-reminder.html`
- Create: `assets/emails/template/pre-meeting-reminder.txt`
- Modify: `scripts/render_email_previews.py`
- Test: `tests/render_email_previews_test.py`

**Interfaces:**
- Consumes (from Task 1): `load_questions() -> list[str]`, `question_tokens(list[str]) -> dict[str, str]` with keys `questions.lede/html/text`.
- Produces: a fourth entry `"pre_meeting_reminder"` in the JSON document `render_email_previews.main()` prints, and `pre-meeting-reminder_rendered.{html,txt}` artifacts.

- [ ] **Step 1: Write the failing tests**

Append to `tests/render_email_previews_test.py`:

```python
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
```

Also extend the existing `test_preview_main_resolves_quotes_from_pool` loop to cover the new email — change its key tuple to:

```python
    for key in ("rsvp_confirmation", "availability_thanks", "availability_reminder", "pre_meeting_reminder"):
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run pytest tests/render_email_previews_test.py -v`
Expected: FAIL — the new template files don't exist (`FileNotFoundError`) and `payload["pre_meeting_reminder"]` is a `KeyError`.

- [ ] **Step 3: Create the plain-text template**

Create `assets/emails/template/pre-meeting-reminder.txt`:

```
WiDS · NYC AI Reading Group
===========================

Good morning gorgeous {{ recipient.firstName }},

A quick reminder that we meet {{ meeting.dayName }}. Below is where to be,
the paper, and a few questions to get the conversation going.


WHEN     {{ meeting.when }}
WHERE    {{ meeting.location }}
LEADING  {{ meeting.leader }}

Join / add to calendar:
{{ links.calendar }}


THIS MONTH'S PAPER
{{ paper.title }}
{{ paper.subtitle }}
Open in Paper Pal: {{ paper.companionUrl }}


DISCUSSION QUESTIONS
{{ questions.lede }}

{{ questions.text }}


BEFORE YOU ARRIVE
Skim the methods and results sections if nothing else, and jot down one
question of your own — the best discussions usually start with someone
else's.


See you {{ meeting.dayName }},
{{ signoff.names }}


"{{ quote.text }}"
— {{ quote.by }}, {{ quote.role }}

---
You're getting this because you RSVP'd to a WiDS NYC reading group event.
Manage your RSVPs: {{ links.rsvpManage }}
```

- [ ] **Step 4: Create the HTML template**

Create `assets/emails/template/pre-meeting-reminder.html`:

```html
<!doctype html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="color-scheme" content="light only">
  <meta name="supported-color-schemes" content="light only">
  <title>Reading group reminder</title>

  <!--
    Pre-meeting reminder email — WiDS NYC AI Reading Group Planner.

    Source design: Claude Design handoff "design_handoff_pre_meeting_reminder /
    Pre-Meeting Reminder Email.html". High-fidelity port to email-client-safe
    table markup; the prototype's CSS variables are inlined as literal hex.

    Email-safety deltas vs the browser prototype (see the spec
    docs/superpowers/specs/2026-06-18-pre-meeting-reminder-email-design.md):
      1. The cream dotted-grid card background (radial-gradient +
         background-attachment:local) is dropped — clients strip
         background-images. The card is solid cream #fefcef on the dark
         #1a160f backdrop.
      2. The prototype's inline-SVG logo lockup is replaced by the hosted PNG
         brand mark (mark-reader-192.png), matching the sibling templates —
         inline-SVG logos do not render in Gmail/Outlook. Small decorative
         icons stay inline SVG, as the sibling templates already do.
      3. The numbered discussion list (CSS ::before counters) is a table whose
         01/02… cells are real text, composed server-side by
         scripts/discussion_questions.py and injected as {{ questions.html }}.
      4. Per-phrase bold inside questions is dropped (escaped plain text) so the
         future per-paper auto-loader needn't emit markup.

    Tokens are Mustache-style ({{ recipient.firstName }}), resolved by the agent
    driving Gmail MCP (scripts/render_email_previews.py). Wiring into
    scheduled_tasks/pre-meeting-reminder.md is deferred (spec §8).
  -->

  <!--[if mso]>
  <style type="text/css">
    table, td, div, h1, h2, p, span { font-family: Arial, Helvetica, sans-serif !important; }
    .serif, .paper-title, .lockup-name, .signoff-name, .quote-text, .leading { font-family: Georgia, "Times New Roman", serif !important; }
  </style>
  <![endif]-->

  <style type="text/css">
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; border-collapse: collapse; }
    img { -ms-interpolation-mode: bicubic; border: 0; outline: none; text-decoration: none; }
    body { margin: 0 !important; padding: 0 !important; width: 100% !important; }
    a { color: #355c4b; }

    @media only screen and (max-width: 600px) {
      .container { width: 100% !important; }
      .pad-x { padding-left: 26px !important; padding-right: 26px !important; }
      .body-text { font-size: 15px !important; }
      .paper-title { font-size: 17px !important; }
      .mstrip-cell { display: block !important; width: 100% !important; border-right: 0 !important; border-bottom: 1px solid #ddd4be !important; }
      .mstrip-cell-last { border-bottom: 0 !important; }
    }
  </style>
</head>

<body style="margin:0;padding:0;background-color:#1a160f;font-family:'Geist',system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;color:#1a160f;">

  <!-- Hidden preheader (inbox-preview text). -->
  <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;font-family:sans-serif;">
    {{ meeting.dayName }} reminder &mdash; {{ paper.title }}.
    &#847; &zwnj; &nbsp; &#8199; &#65279; &#8199; &nbsp; &zwnj; &#847;
  </div>

  <!-- ===== Outer wrapper (dark page backdrop) ===== -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#1a160f" style="background-color:#1a160f;">
    <tr>
      <td align="center" style="padding:32px 12px 48px;">

        <!-- ===== Email card (solid cream) ===== -->
        <table role="presentation" class="container" width="640" cellpadding="0" cellspacing="0" border="0" style="width:640px;max-width:640px;background-color:#fefcef;border:1px solid #ddd4be;border-radius:6px;">

          <!-- ── Centered logo lockup ── -->
          <tr>
            <td class="pad-x" align="center" style="padding:40px 52px 0 52px;">
              <img src="https://wids-nyc-reading-group-assistant.vercel.app/branding/mark-reader-192.png"
                   width="48" height="48" alt="WiDS NYC"
                   style="display:block;border:0;border-radius:10px;width:48px;height:48px;margin:0 auto;">
              <div class="lockup-name serif" style="margin-top:10px;font-family:Newsreader,Charter,'Iowan Old Style',Georgia,serif;font-weight:600;font-size:22px;letter-spacing:-0.02em;color:#152a23;line-height:1.15;">
                Reading Group Planner
              </div>
              <div style="margin:10px auto;width:24px;height:2px;background-color:#c8226d;line-height:0;font-size:0;">&nbsp;</div>
              <div style="font-family:'Geist',system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:11px;text-transform:uppercase;letter-spacing:0.14em;color:#7e6f55;line-height:1.4;">
                WiDS &middot; NYC AI Reading Group
              </div>
            </td>
          </tr>

          <!-- ── Greeting ── -->
          <tr>
            <td class="pad-x" style="padding:28px 52px 0 52px;">
              <p class="body-text" style="margin:0;font-family:'Geist',system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:17px;font-weight:500;line-height:1.5;color:#152a23;">
                Good morning gorgeous {{ recipient.firstName }},
              </p>
            </td>
          </tr>

          <!-- ── Intro paragraph ── -->
          <tr>
            <td class="pad-x" style="padding:12px 52px 0 52px;">
              <p class="body-text" style="margin:0;font-family:'Geist',system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.65;color:#1a160f;">
                A quick reminder that we meet <b style="font-weight:600;">{{ meeting.dayName }}</b>. Below is where to be, the paper, and a few <b style="font-weight:600;">questions</b> to get the conversation going.
              </p>
            </td>
          </tr>

          <!-- ── Meeting strip (When / Where / Leading) ── -->
          <tr>
            <td class="pad-x" style="padding:22px 52px 0 52px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #ddd4be;border-radius:6px;background-color:#faf8ef;">
                <tr>
                  <td class="mstrip-cell" width="33.33%" valign="top" style="padding:14px 18px;border-right:1px solid #ddd4be;">
                    <div style="font-family:'Geist',system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:10.5px;text-transform:uppercase;letter-spacing:0.14em;font-weight:600;color:#7e6f55;padding-bottom:4px;">When</div>
                    <div style="font-family:'Geist',system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;font-weight:500;color:#152a23;">{{ meeting.when }}</div>
                  </td>
                  <td class="mstrip-cell" width="33.33%" valign="top" style="padding:14px 18px;border-right:1px solid #ddd4be;">
                    <div style="font-family:'Geist',system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:10.5px;text-transform:uppercase;letter-spacing:0.14em;font-weight:600;color:#7e6f55;padding-bottom:4px;">Where</div>
                    <div style="font-family:'Geist',system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;font-weight:500;color:#152a23;">{{ meeting.location }}</div>
                  </td>
                  <td class="mstrip-cell mstrip-cell-last" width="33.33%" valign="top" style="padding:14px 18px;">
                    <div style="font-family:'Geist',system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:10.5px;text-transform:uppercase;letter-spacing:0.14em;font-weight:600;color:#7e6f55;padding-bottom:4px;">Leading</div>
                    <div class="leading serif" style="font-family:Newsreader,Charter,'Iowan Old Style',Georgia,serif;font-style:italic;font-size:15px;font-weight:500;color:#152a23;">{{ meeting.leader }}</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ── Primary CTA ── -->
          <tr>
            <td class="pad-x" style="padding:18px 52px 0 52px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td class="btn-cell" align="center" bgcolor="#467560" style="border-radius:10px;background-color:#467560;">
                    <!--[if mso]>
                    <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="{{ links.calendar }}" style="height:46px;v-text-anchor:middle;width:236px;" arcsize="22%" strokecolor="#467560" fillcolor="#467560">
                      <w:anchorlock/>
                      <center style="color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:500;">Join / add to calendar &rarr;</center>
                    </v:roundrect>
                    <![endif]-->
                    <!--[if !mso]><!-- -->
                    <a href="{{ links.calendar }}"
                       style="display:inline-block;padding:14px 22px;font-family:'Geist',system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:16px;font-weight:500;color:#ffffff;text-decoration:none;line-height:1;">
                      Join / add to calendar &rarr;
                    </a>
                    <!--<![endif]-->
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ── Paper card (magenta left border) ── -->
          <tr>
            <td class="pad-x" style="padding:28px 52px 0 52px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#faf8ef;border-left:2px solid #c8226d;border-radius:0 6px 6px 0;">
                <tr>
                  <td style="padding:14px 18px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td valign="middle" style="padding-right:8px;line-height:0;">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#861148" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>
                        </td>
                        <td valign="middle" style="font-family:'Geist',system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:10.5px;text-transform:uppercase;letter-spacing:0.14em;font-weight:600;color:#861148;">This month's paper</td>
                      </tr>
                    </table>
                    <h2 class="paper-title serif" style="margin:8px 0 4px 0;font-family:Newsreader,Charter,'Iowan Old Style',Georgia,serif;font-size:19px;font-weight:500;line-height:1.3;color:#152a23;">
                      {{ paper.title }}
                    </h2>
                    <div class="serif" style="font-family:Newsreader,Charter,'Iowan Old Style',Georgia,serif;font-style:italic;font-size:14px;color:#594d3b;">
                      {{ paper.subtitle }}
                    </div>
                    <div style="margin-top:8px;">
                      <a href="{{ paper.companionUrl }}" style="font-family:'Geist',system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:13px;font-weight:500;color:#355c4b;text-decoration:underline;text-underline-offset:2px;">
                        Open in Paper Pal &nearr;
                      </a>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ── Discussion questions ── -->
          <tr>
            <td class="pad-x" style="padding:28px 52px 0 52px;">
              <div style="font-family:'Geist',system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:10.5px;text-transform:uppercase;letter-spacing:0.14em;font-weight:600;color:#7e6f55;">Discussion questions</div>
              <p class="serif" style="margin:6px 0 0 0;font-family:Newsreader,Charter,'Iowan Old Style',Georgia,serif;font-style:italic;font-size:15px;color:#a8175a;">
                {{ questions.lede }}
              </p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:8px;">
                {{ questions.html }}
              </table>
            </td>
          </tr>

          <!-- ── Before you arrive (sage box) ── -->
          <tr>
            <td class="pad-x" style="padding:26px 52px 0 52px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#eef4f0;border:1px solid #d4e3da;border-radius:6px;">
                <tr>
                  <td style="padding:16px 18px;">
                    <div style="font-family:'Geist',system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:10.5px;text-transform:uppercase;letter-spacing:0.14em;font-weight:600;color:#355c4b;padding-bottom:4px;">Before you arrive</div>
                    <div style="font-family:'Geist',system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:#29241b;">
                      Skim the methods and results sections if nothing else, and jot down one question of your own &mdash; the best discussions usually start with someone else's.
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ── Sign-off ── -->
          <tr>
            <td class="pad-x" style="padding:28px 52px 0 52px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="border-top:1px dashed #b9ae96;padding-top:18px;">
                    <p style="margin:0;font-family:'Geist',system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;color:#29241b;line-height:1.55;">See you {{ meeting.dayName }},</p>
                    <p class="signoff-name serif" style="margin:6px 0 0 0;font-family:Newsreader,Charter,'Iowan Old Style',Georgia,serif;font-style:italic;font-size:18px;color:#244338;line-height:1.4;">{{ signoff.names }}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ── Closing quote (rotating women-in-STEM) ── -->
          <tr>
            <td class="pad-x" align="center" style="padding:26px 52px 0 52px;">
              <div style="margin:0 auto;width:36px;height:1px;background-color:#c8226d;line-height:0;font-size:0;">&nbsp;</div>
              <div style="margin-top:14px;font-family:'Geist',system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:10.5px;text-transform:uppercase;letter-spacing:0.14em;font-weight:600;color:#7e6f55;">In her words</div>
              <p class="quote-text serif" style="margin:10px auto 0;max-width:460px;font-family:Newsreader,Charter,'Iowan Old Style',Georgia,serif;font-style:italic;font-size:17px;line-height:1.45;color:#152a23;">
                &ldquo;{{ quote.text }}&rdquo;
              </p>
              <p style="margin:8px 0 0 0;font-family:'Geist',system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:12px;color:#594d3b;line-height:1.5;">
                &mdash; <span style="font-weight:600;color:#29241b;">{{ quote.by }}</span>, <span style="color:#a89978;">{{ quote.role }}</span>
              </p>
            </td>
          </tr>

          <!-- ── Footer ── -->
          <tr>
            <td class="pad-x" align="center" style="padding:26px 44px 30px 44px;">
              <p style="margin:0;font-family:'Geist',system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:11px;line-height:1.55;color:#594d3b;">
                You're getting this because you RSVP'd to a WiDS NYC reading group event.
                <a href="{{ links.rsvpManage }}" style="color:#355c4b;text-decoration:underline;text-underline-offset:2px;">Manage your RSVPs</a>.
              </p>
            </td>
          </tr>

        </table>
        <!-- ===== /Email card ===== -->

      </td>
    </tr>
  </table>

</body>
</html>
```

- [ ] **Step 5: Wire the template into the preview renderer**

In `scripts/render_email_previews.py`:

(a) Add the import next to the existing `scripts.quotes` import:

```python
from scripts.discussion_questions import load_questions, question_tokens
from scripts.quotes import load_bundle, quote_tokens, select_quote
```

(b) Add the sample token dict after `REMINDER_TOKENS`:

```python
PRE_MEETING_TOKENS = {
    "recipient.firstName": "Maya",
    "meeting.dayName": "Tuesday",
    "meeting.when": "Tue, Jun 23 · 6:30pm",
    "meeting.location": "Jack's Wife Freda",
    "meeting.leader": "Michelle & Claudia",
    "links.calendar": "https://wids-nyc-reading-group-assistant.vercel.app/events/6/cal.ics",
    "paper.title": "A Hybrid LSTM–Transformer Model for Gold Futures Price Forecasting",
    "paper.subtitle": "with XGBoost–SHAP feature selection on Shanghai gold futures",
    "paper.companionUrl": "https://wids-nyc-reading-group-assistant.vercel.app/papers/2",
    "signoff.names": "Michelle & Claudia",
    "links.rsvpManage": "https://wids-nyc-reading-group-assistant.vercel.app/me/rsvps",
    "links.portalBase": "https://wids-nyc-reading-group-assistant.vercel.app",
}
```

(c) Replace the body of `main()` so it composes question tokens, renders the new pair, folds its unresolved tokens into the check, and adds it to the JSON document:

```python
def main() -> int:
    q = quote_tokens(select_quote(load_bundle(), PREVIEW_DATE_KEY))
    qtokens = question_tokens(load_questions())
    rsvp, u_rsvp = render_pair("rsvp-confirmation", {**RSVP_TOKENS, **q})
    thanks, u_thanks = render_pair("availability-thanks", {**AVAIL_TOKENS, **q})
    reminder, u_reminder = render_pair("availability-reminder", {**REMINDER_TOKENS, **q})
    pre_meeting, u_pre = render_pair(
        "pre-meeting-reminder", {**PRE_MEETING_TOKENS, **q, **qtokens}
    )
    unresolved = sorted(set(u_rsvp + u_thanks + u_reminder + u_pre))
    if unresolved:
        print(f"ERROR: unresolved tokens in rendered output: {unresolved}", file=sys.stderr)
        return 1
    json.dump(
        {
            "rsvp_confirmation": {"html": rsvp["html"], "text": rsvp["txt"]},
            "availability_thanks": {"html": thanks["html"], "text": thanks["txt"]},
            "availability_reminder": {"html": reminder["html"], "text": reminder["txt"]},
            "pre_meeting_reminder": {"html": pre_meeting["html"], "text": pre_meeting["txt"]},
        },
        sys.stdout,
    )
    return 0
```

- [ ] **Step 6: Run the full preview run + tests**

Run: `uv run python -m scripts.render_email_previews > /dev/null && echo OK`
Expected: `OK` (exit 0, zero unresolved tokens). This also writes `assets/emails/template/pre-meeting-reminder_rendered.{html,txt}`.
Run: `uv run pytest tests/render_email_previews_test.py -v`
Expected: PASS (existing tests + the 3 new ones).

- [ ] **Step 7: Lint + type-check + full suite**

Run: `uv run ruff check`
Expected: `All checks passed!`
Run: `uv run ty check`
Expected: no errors.
Run: `uv run pytest`
Expected: full suite green.

- [ ] **Step 8: Commit**

The `*_rendered.*` artifacts sit next to the sources. Check whether the existing rendered files are tracked or git-ignored and follow that precedent (do not newly commit generated artifacts if the repo ignores them):

```bash
git status --short assets/emails/template/
git add assets/emails/template/pre-meeting-reminder.html assets/emails/template/pre-meeting-reminder.txt scripts/render_email_previews.py tests/render_email_previews_test.py
git commit -m "feat: pre-meeting reminder email template + preview wiring"
```

---

## Self-Review

**1. Spec coverage**

- §1 Template port → Task 2 Steps 3–4 (full HTML + txt, email-safe, palette, VML CTA, responsive, degradations documented in-file). ✓
- §2 Tokens → Task 2 templates use exactly the §2 token set; sample values in `PRE_MEETING_TOKENS` (Step 5b). ✓
- §3 Discussion questions (static JSON + `discussion_questions.py` composer, count-aware lede, escaped HTML rows, plain text) → Task 1. ✓
- §4 Quote integration (reuse `quotes.py`, drop hardcoded set) → Task 2 quote block + `q` tokens in `main()`. ✓
- §5 Preview rendering → Task 2 Step 5. ✓
- §6 Testing → Task 1 Step 1 (composer) + Task 2 Step 1 (template/preview). ✓
- §7 Error handling → `load_questions` raises (Task 1, tested); quote optional-with-fallback unchanged; non-quote unresolved → exit 1 (Task 2 preserves the check). ✓
- §8 Follow-ups / out-of-scope → no task touches the scheduled task, schema, or `web/`. ✓
- Open note (greeting copy) → kept verbatim "Good morning gorgeous {{ recipient.firstName }}," in both templates, as the spec directs. ✓

**2. Placeholder scan** — no "TBD/TODO/handle errors appropriately"; every code step shows complete code; the HTML/txt are full files, not excerpts. ✓

**3. Type consistency** — `load_questions`/`question_tokens` signatures and the token keys (`questions.lede/html/text`) are identical in Task 1's definition, Task 1's tests, Task 2's `main()` usage, and Task 2's tests. `render_pair`/`render` signatures are used exactly as they exist in `render_email_previews.py`. The JSON key `"pre_meeting_reminder"` matches between `main()` and every test that reads it. ✓

## Notes for the implementer

- The hosted PNG mark (`/branding/mark-reader-192.png`) is already deployed and used by `availability-reminder.html` — no new asset.
- `&` appears unescaped in two sample token *values* ("Michelle & Claudia"); the renderer substitutes values raw and real clients render a bare `&` fine. If a future real value contains `<`/`>`/`&` that must be entity-safe, that's a renderer concern (per-format escaping), out of scope here.
- The `.txt` intro says "a few questions" (not "eight") to avoid drift if the question count changes; the count-aware `{{ questions.lede }}` carries the actual number.
- Don't ship `tweaks-panel.jsx` or the prototype `.meta-strip`/`.post-note` — they aren't referenced anywhere in these files by design.
