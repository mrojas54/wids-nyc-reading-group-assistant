# Reading-Group Announcement Email + Newest-Paper/Prerequisites Generator — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the `ReadingGroupEmail.dc.html` design into a real flat email template and add a generator that fills the newest paper's card fields plus its AI-drafted, editable prerequisites.

**Architecture:** A new flat `new-paper-announcement.{html,txt}` template (court/queens voice, email-client-safe table markup) rendered by the existing flat-Mustache pipeline. A `scripts/generate_prerequisites.py` module runs in two modes — `gather` (emit a generation contract for the agent) and `render` (map persisted prerequisites onto template tokens and emit the Gmail-draft JSON). The AI drafting happens in the agent between the two modes (no new Python AI dependency). Prerequisites persist as JSONB on `papers`.

**Tech Stack:** Python 3.11 (uv), psycopg 3, existing `scripts/quotes.py` + a new `scripts/prerequisites.py` composer, Supabase/Postgres, Gmail MCP (send path, unchanged).

## Global Constraints

- Python `>=3.11`; run modules as `uv run python -m scripts.<name>`.
- Tests run via `uv run pytest -c tests/pytest.ini <path> -v`; lint `uv run ruff check scripts tests`; types `uv run ty check`.
- **No new runtime dependencies** — agent-in-the-loop drafting means no `anthropic` SDK/secret on the Python side.
- Email templates are **email-client-safe, table-based** markup (MSO conditional comments, VML button, inlined literal hex, hidden preheader, `@media` overrides) with a plain-text `.txt` twin — mirror `assets/emails/template/rsvp-confirmation.html`.
- Render **refuses to emit if any `{{ token }}` is unresolved** (reuse the existing guard).
- Header voice for this template: **court/queens** (the `courtVoice` branch of the design).
- Migration is **additive and nullable**; assigned number **022** (verified unused on all remote branches 2026-07-13).
- DB functions take a `conn`; only `main()` connects. Reuse the `SUPABASE_DB_URL` + `web/.env.local` loading pattern from `scripts/zotero_push.py`.

---

## File Structure

- Create `migrations/022_papers_prerequisites.sql` — additive nullable `papers.prerequisites JSONB`.
- Create `scripts/prerequisites.py` — `prereq_tokens(lede, items)` composer (mirrors `discussion_questions.py`).
- Create `tests/prerequisites_test.py`.
- Create `assets/emails/template/new-paper-announcement.html` + `.txt` — the ported template.
- Modify `scripts/render_email_previews.py` — sample tokens + `render_pair` for the new template; export the reusable `render`.
- Modify `tests/render_email_previews_test.py` — assert the new template renders with zero unresolved tokens.
- Create `scripts/generate_prerequisites.py` — newest-paper selection, `authors_short`, gather contract, token building, render, persist, `main`.
- Create `tests/generate_prerequisites_test.py`.
- Create `scheduled_tasks/new-paper-announcement.md` — the agent orchestration prompt (gather → draft → persist → render → Gmail draft).
- Modify `docs/runbooks/transactional-emails.md` — add the new template→consumer row.

---

### Task 1: Migration — `papers.prerequisites` JSONB column

**Files:**
- Create: `migrations/022_papers_prerequisites.sql`

**Interfaces:**
- Produces: a nullable `papers.prerequisites JSONB` column holding `{lede, items, summary, short_title, status, model, generated_at}`.

- [ ] **Step 1: Write the migration**

```sql
-- migrations/022_papers_prerequisites.sql
-- Editable, AI-drafted "recommended prerequisites" bundle for a paper,
-- consumed by the new-paper-announcement email (scripts/generate_prerequisites.py).
-- Additive + nullable so existing rows and the papers RLS policies are unaffected.
BEGIN;

ALTER TABLE papers ADD COLUMN prerequisites JSONB;

COMMENT ON COLUMN papers.prerequisites IS
  'AI-drafted announcement bundle: {lede, items:[…], summary, short_title, '
  'status:"draft"|"approved", model, generated_at}. Edited before send; '
  'NULL until generated. See docs/superpowers/specs/2026-07-13-reading-group-email-and-prerequisites-design.md';

COMMIT;
```

- [ ] **Step 2: Sanity-check the SQL locally**

Run: `grep -c "ADD COLUMN prerequisites JSONB" migrations/022_papers_prerequisites.sql`
Expected: `1`

- [ ] **Step 3: Apply to a Supabase dev branch and verify** *(operator-gated — do NOT apply to prod without explicit confirmation)*

Apply via the Supabase MCP `apply_migration` against a dev branch, then verify:

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'papers' AND column_name = 'prerequisites';
```
Expected: one row, `jsonb`, `YES`.

- [ ] **Step 4: Commit**

```bash
git add migrations/022_papers_prerequisites.sql
git commit -m "feat(db): add nullable papers.prerequisites JSONB (migration 022)"
```

---

### Task 2: `scripts/prerequisites.py` — prerequisites token composer

**Files:**
- Create: `scripts/prerequisites.py`
- Test: `tests/prerequisites_test.py`

**Interfaces:**
- Produces: `prereq_tokens(lede: str, items: list[str]) -> dict[str, str]` returning keys `"prereqs.lede"`, `"prereqs.html"`, `"prereqs.text"`. HTML-escapes each item for `prereqs.html`; leaves `prereqs.text` plain. Raises `ValueError` if `lede` is blank, `items` is empty, or any item is a blank/non-string.

- [ ] **Step 1: Write the failing test**

```python
# tests/prerequisites_test.py
import pytest

from scripts.prerequisites import prereq_tokens


def test_prereq_tokens_shape_and_lede():
    t = prereq_tokens("Groundwork first.", ["Linear algebra", "Attention", "LSTMs"])
    assert set(t) == {"prereqs.lede", "prereqs.html", "prereqs.text"}
    assert t["prereqs.lede"] == "Groundwork first."


def test_prereq_tokens_text_is_numbered_plain():
    t = prereq_tokens("L", ["First", "Second & third"])
    assert t["prereqs.text"] == "01. First\n\n02. Second & third"


def test_prereq_tokens_html_escapes_items_and_numbers_them():
    t = prereq_tokens("L", ["A & B", "plain"])
    assert "A &amp; B" in t["prereqs.html"]      # escaped
    assert "A & B" not in t["prereqs.html"]
    assert t["prereqs.html"].count("<tr>") == 2  # one row per item
    assert "01" in t["prereqs.html"] and "02" in t["prereqs.html"]


def test_prereq_tokens_last_row_has_no_bottom_border():
    t = prereq_tokens("L", ["only", "last"])
    # Exactly one dashed separator between two rows (last row omits it).
    assert t["prereqs.html"].count("border-bottom:1px dashed") == 1


@pytest.mark.parametrize("bad", [("", ["x"]), ("L", []), ("L", ["", "y"]), ("L", [1])])
def test_prereq_tokens_rejects_bad_input(bad):
    lede, items = bad
    with pytest.raises(ValueError):
        prereq_tokens(lede, items)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest -c tests/pytest.ini tests/prerequisites_test.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'scripts.prerequisites'`.

- [ ] **Step 3: Write the implementation**

```python
# scripts/prerequisites.py
"""Recommended-prerequisites token composition for the new-paper announcement.

Mirrors scripts/discussion_questions.py: a pure transform from a lede + list of
items into the three Mustache tokens the email template injects — a lede, an
email-safe HTML <tr> block, and a plain-text numbered list. Keeping the
HTML/text split here lets render_email_previews stay a flat {{ token }}
substitution (one token can't be both HTML-escaped and plain).
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest -c tests/pytest.ini tests/prerequisites_test.py -v`
Expected: PASS (5 tests / parametrize cases).

- [ ] **Step 5: Lint + type**

Run: `uv run ruff check scripts/prerequisites.py tests/prerequisites_test.py && uv run ty check`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add scripts/prerequisites.py tests/prerequisites_test.py
git commit -m "feat: add prerequisites token composer (prereqs.lede/html/text)"
```

---

### Task 3: The template pair + preview-harness wiring

**Files:**
- Create: `assets/emails/template/new-paper-announcement.html`
- Create: `assets/emails/template/new-paper-announcement.txt`
- Modify: `scripts/render_email_previews.py`
- Modify: `tests/render_email_previews_test.py`

**Interfaces:**
- Consumes: `prereq_tokens` (Task 2), `quote_tokens`/`select_quote`/`load_bundle` (`scripts/quotes.py`), the module-level `render` (`scripts/render_email_previews.py`).
- Produces: two template files whose complete token set is
  `recipient.firstName`, `lead.name`, `lead.initial`, `lead.blurb`,
  `paper.title`, `paper.shortTitle`, `paper.summary`, `paper.authorsShort`,
  `paper.url`, `prereqs.lede`, `prereqs.html` (html) / `prereqs.text` (txt),
  `signoff.names`, `quote.text`, `quote.by`, `quote.role`,
  `links.availability`, `links.rsvpManage`.

**Porting instructions (email-safe HTML):** Port the design's `courtVoice`
branch by mirroring the structure of `assets/emails/template/rsvp-confirmation.html`
(role="presentation" tables, `.pad-x` cells, MSO conditional `<style>`, VML
`<v:roundrect>` for the CTA, hidden preheader div, `@media max-width:620px`
overrides, all colors inlined as literal hex from the design:
`#1a160f` page, `#fefcef` card, `#ddd4be` border/dots, `#467560` CTA green,
`#c8226d`/`#a8175a`/`#861148` magenta accents, `#152a23` headings, `#7e6f55`
eyebrows). Blocks, in order — header comment (source + required/optional token
list + refuse-if-unresolved note), court header (mark PNG at
`https://wids-nyc-reading-group-assistant.vercel.app/branding/mark-reader-192.png`,
"✦ Women of Data Science NYC ✦" eyebrow, "A New Queen Has Stepped Up to Reign
This Month" serif hero, italic subhead, magenta rule, "WiDS · NYC AI Reading
Group"), greeting `Hi {{ recipient.firstName }},`, two intro paragraphs
(`{{ lead.name }}` leads; `{{ paper.shortTitle }}` — `{{ paper.summary }}`),
co-lead card (`{{ lead.initial }}`/`{{ lead.name }}`/`{{ lead.blurb }}`), CTA
`Share your availability` → `{{ links.availability }}`, paper card
(`{{ paper.title }}`/`{{ paper.authorsShort }}`/`Read the paper` →
`{{ paper.url }}`), "Recommended pre-requisites" section
(`{{ prereqs.lede }}` then a `<table>` whose rows are `{{ prereqs.html }}`),
sign-off (`{{ signoff.names }}`), closing quote
(`{{ quote.text }}`/`{{ quote.by }}`/`{{ quote.role }}`), footer
(`Manage your RSVPs` → `{{ links.rsvpManage }}`). The `.txt` twin mirrors
`rsvp-confirmation.txt`: greeting, intro, availability link, THIS MONTH'S PAPER
block, RECOMMENDED PRE-REQUISITES (`{{ prereqs.lede }}` + `{{ prereqs.text }}`),
sign-off, quote, footer.

- [ ] **Step 1: Write both template files** following the porting instructions above (reference `rsvp-confirmation.{html,txt}` for the exact table/MSO scaffolding).

- [ ] **Step 2: Add sample tokens + render call in `render_email_previews.py`**

Add near the other token dicts:

```python
NEW_PAPER_TOKENS = {
    "recipient.firstName": "Maya",
    "lead.name": "Claudia",
    "lead.initial": "C",
    "lead.blurb": "Claudia works on time-series forecasting and volunteered to "
                  "steer us through this one.",
    "paper.title": "Hybrid LSTM–Transformer Architecture with Multi-Scale "
                   "Feature Fusion for High-Accuracy Gold Futures Price Forecasting",
    "paper.shortTitle": "A Hybrid LSTM–Transformer Model for Gold Futures Forecasting",
    "paper.summary": "it pairs an LSTM with a transformer and multi-scale "
                     "feature fusion to forecast gold futures prices.",
    "paper.authorsShort": "Zhao, Guo & Wang",
    "paper.url": "https://doi.org/10.3390/math13101551",
    "signoff.names": "Michelle & Claudia",
    "links.availability": "https://wids-nyc-reading-group-assistant.vercel.app/availability",
    "links.rsvpManage": "https://wids-nyc-reading-group-assistant.vercel.app/me/rsvps",
}

# Illustrative prerequisites for the preview (production values come from
# papers.prerequisites via scripts/generate_prerequisites.py).
PREVIEW_PREREQS = (
    "A little groundwork will make the discussion land harder.",
    [
        "Skim how an LSTM cell carries state across a sequence.",
        "Recall what self-attention computes in a transformer block.",
        "Have a one-line intuition for why feature fusion can help forecasting.",
    ],
)
```

In `main()`, after the existing `q = ...`/`qtokens = ...` lines, add:

```python
    from scripts.prerequisites import prereq_tokens
    pq = prereq_tokens(PREVIEW_PREREQS[0], list(PREVIEW_PREREQS[1]))
    new_paper, u_new = render_pair(
        "new-paper-announcement", {**NEW_PAPER_TOKENS, **q, **pq}
    )
```

Add `u_new` to the `unresolved` aggregation and a `"new_paper_announcement": {"html": new_paper["html"], "text": new_paper["txt"]}` entry to the emitted JSON.

- [ ] **Step 3: Extend `tests/render_email_previews_test.py`**

Add a test asserting the new template resolves fully:

```python
def test_new_paper_announcement_has_no_unresolved_tokens(tmp_path, monkeypatch):
    # main() writes *_rendered.* and returns 0 only when every {{token}} resolved.
    import scripts.render_email_previews as rep
    monkeypatch.setattr("sys.stdout", __import__("io").StringIO())
    assert rep.main() == 0
    rendered = (rep.TEMPLATES / "new-paper-announcement_rendered.html").read_text()
    assert "{{" not in rendered
    assert "Recommended pre-requisites" in rendered
```

*(If `render_email_previews_test.py` already drives `main()`, fold the two new
asserts into the existing test instead of adding a duplicate `main()` run.)*

- [ ] **Step 4: Run the preview + tests**

Run: `uv run python -m scripts.render_email_previews > /dev/null && uv run pytest -c tests/pytest.ini tests/render_email_previews_test.py -v`
Expected: exit 0 (no unresolved tokens) and PASS.

- [ ] **Step 5: Visual check** — open `assets/emails/template/new-paper-announcement_rendered.html` in the browser preview; confirm the court header, paper card, and numbered prerequisites render correctly at desktop and 375px.

- [ ] **Step 6: Commit**

```bash
git add assets/emails/template/new-paper-announcement.html assets/emails/template/new-paper-announcement.txt scripts/render_email_previews.py tests/render_email_previews_test.py
git commit -m "feat: add new-paper-announcement email template + preview coverage"
```

---

### Task 4: Generator — newest-paper selection + `authors_short`

**Files:**
- Create: `scripts/generate_prerequisites.py`
- Test: `tests/generate_prerequisites_test.py`

**Interfaces:**
- Produces:
  - `authors_short(authors: list[str]) -> str` — surnames of the first authors: 1→"A", 2→"A & B", 3→"A, B & C", ≥4→"A et al." (surname = last whitespace token; empty list → "").
  - `select_newest_paper(conn) -> dict[str, Any]` — the paper of the most recent meeting with a `paper_id` (order `scheduled_at DESC NULLS LAST, id DESC`), falling back to the most recently added paper. Returns `{id, title, url, abstract, authors, year, prerequisites}`. Raises `LookupError` if there are no papers.

- [ ] **Step 1: Write the failing tests**

```python
# tests/generate_prerequisites_test.py
import pytest

from scripts.generate_prerequisites import authors_short, select_newest_paper


@pytest.mark.parametrize("authors,expected", [
    ([], ""),
    (["Li Zhao"], "Zhao"),
    (["Li Zhao", "Mei Guo"], "Zhao & Guo"),
    (["Li Zhao", "Mei Guo", "Wei Wang"], "Zhao, Guo & Wang"),
    (["Li Zhao", "Mei Guo", "Wei Wang", "Ana Ng"], "Zhao et al."),
    (["Plato"], "Plato"),
])
def test_authors_short(authors, expected):
    assert authors_short(authors) == expected


class _FakeCursor:
    def __init__(self, rows): self._rows = rows; self._i = 0
    def __enter__(self): return self
    def __exit__(self, *a): return False
    def execute(self, sql, params=None): self._sql = sql
    def fetchone(self):
        # Return the first queued result set's single row (or None).
        return self._rows[self._i] if self._i < len(self._rows) else None


class _FakeConn:
    def __init__(self, rows): self._rows = rows
    def cursor(self): return _FakeCursor(self._rows)


def test_select_newest_paper_returns_meeting_paper():
    row = (2, "T", "http://x", "abstract", ["Li Zhao"], 2025, None)
    paper = select_newest_paper(_FakeConn([row]))
    assert paper["id"] == 2 and paper["title"] == "T" and paper["authors"] == ["Li Zhao"]


def test_select_newest_paper_raises_when_no_papers():
    with pytest.raises(LookupError):
        select_newest_paper(_FakeConn([None]))
```

*(Note: `select_newest_paper` issues the meeting-join query first, then the
`added_at` fallback only when it returns no row. In the test, a single-row
`_FakeConn` satisfies the first query; the `[None]` conn returns None to both,
so the fallback also misses and it raises. If your implementation runs two
cursors, adjust `_FakeCursor` to pop per-query result sets — keep the assertion
that a present row is returned and an absent one raises `LookupError`.)*

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest -c tests/pytest.ini tests/generate_prerequisites_test.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'scripts.generate_prerequisites'`.

- [ ] **Step 3: Write the module skeleton + these two functions**

```python
# scripts/generate_prerequisites.py
"""Generate the newest paper's card fields + editable prerequisites, and render
the new-paper-announcement email.

Two modes (the AI drafting happens in the agent BETWEEN them, so no Anthropic
dependency lives here):

    # 1. emit a generation contract for the newest paper:
    uv run python -m scripts.generate_prerequisites --mode gather

    # 2. after the agent drafts + persists papers.prerequisites, render the email
    #    (per-send tokens — recipient/lead/signoff/links — arrive on stdin as JSON):
    echo '{"recipient.firstName":"Maya", ...}' \\
        | uv run python -m scripts.generate_prerequisites --mode render

Env (from web/.env.local, process env wins):
    SUPABASE_DB_URL   Postgres connection string for the project DB.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import date
from pathlib import Path
from typing import Any

import psycopg

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_ENV_FILE = REPO_ROOT / "web" / ".env.local"
_ENV_LINE_RE = re.compile(r'^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$')

_PAPER_COLS = "id, title, url, abstract, authors, year, prerequisites"


def authors_short(authors: list[str]) -> str:
    """Compact author credit from surnames: 'A', 'A & B', 'A, B & C', 'A et al.'."""
    surnames = [a.strip().rsplit(" ", 1)[-1] for a in authors if a and a.strip()]
    if not surnames:
        return ""
    if len(surnames) == 1:
        return surnames[0]
    if len(surnames) == 2:
        return f"{surnames[0]} & {surnames[1]}"
    if len(surnames) == 3:
        return f"{surnames[0]}, {surnames[1]} & {surnames[2]}"
    return f"{surnames[0]} et al."


def _row_to_paper(row: tuple[Any, ...]) -> dict[str, Any]:
    keys = ("id", "title", "url", "abstract", "authors", "year", "prerequisites")
    paper = dict(zip(keys, row))
    paper["authors"] = list(paper["authors"]) if paper["authors"] else []
    return paper


def select_newest_paper(conn: psycopg.Connection) -> dict[str, Any]:
    """The paper of the most recent meeting that has one; else the newest-added
    paper. Raises LookupError when no papers exist."""
    with conn.cursor() as cur:
        cur.execute(
            f"SELECT p.{_PAPER_COLS.replace(', ', ', p.')} "
            "FROM meetings m JOIN papers p ON p.id = m.paper_id "
            "WHERE m.paper_id IS NOT NULL "
            "ORDER BY m.scheduled_at DESC NULLS LAST, m.id DESC LIMIT 1"
        )
        row = cur.fetchone()
    if row is not None:
        return _row_to_paper(row)
    with conn.cursor() as cur:
        cur.execute(f"SELECT {_PAPER_COLS} FROM papers ORDER BY added_at DESC LIMIT 1")
        row = cur.fetchone()
    if row is None:
        raise LookupError("no papers in the database")
    return _row_to_paper(row)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest -c tests/pytest.ini tests/generate_prerequisites_test.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/generate_prerequisites.py tests/generate_prerequisites_test.py
git commit -m "feat: newest-paper selection + authors_short for the generator"
```

---

### Task 5: Generator — gather mode (generation contract)

**Files:**
- Modify: `scripts/generate_prerequisites.py`
- Test: `tests/generate_prerequisites_test.py`

**Interfaces:**
- Produces: `build_gather_contract(paper: dict) -> dict` — `{paper_id, title, abstract, authors, url, instructions}` where `instructions` deterministically describes the four fields the agent must draft: `short_title`, `summary`, `lede`, `items` (exactly 3).

- [ ] **Step 1: Write the failing test**

```python
def test_build_gather_contract_shape():
    from scripts.generate_prerequisites import build_gather_contract
    paper = {"id": 2, "title": "T", "abstract": "A", "authors": ["Li Zhao"],
             "url": "http://x", "year": 2025, "prerequisites": None}
    c = build_gather_contract(paper)
    assert c["paper_id"] == 2 and c["title"] == "T" and c["url"] == "http://x"
    assert set(c["instructions"]["produce"]) == {"short_title", "summary", "lede", "items"}
    assert c["instructions"]["items_count"] == 3
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest -c tests/pytest.ini tests/generate_prerequisites_test.py::test_build_gather_contract_shape -v`
Expected: FAIL — `ImportError`/`AttributeError` on `build_gather_contract`.

- [ ] **Step 3: Implement**

```python
def build_gather_contract(paper: dict[str, Any]) -> dict[str, Any]:
    """Emit the JSON the agent uses to draft the announcement's generated fields.

    The agent reads this, drafts with Claude, and persists the result to
    papers.prerequisites (status='draft') via the Supabase MCP.
    """
    return {
        "paper_id": paper["id"],
        "title": paper["title"],
        "abstract": paper.get("abstract") or "",
        "authors": paper.get("authors") or [],
        "url": paper["url"],
        "instructions": {
            "produce": ["short_title", "summary", "lede", "items"],
            "items_count": 3,
            "guidance": (
                "short_title: a <=12-word rewrite of the title for the intro line. "
                "summary: ONE sentence (<=30 words) completing 'she'll steer the "
                "discussion on <short_title> — <summary>'. lede: one line framing "
                "the prerequisites. items: exactly 3 concrete things to review "
                "before the discussion (concepts/skills), each <=20 words. "
                "Return JSON {short_title, summary, lede, items:[3]}."
            ),
        },
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest -c tests/pytest.ini tests/generate_prerequisites_test.py::test_build_gather_contract_shape -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/generate_prerequisites.py tests/generate_prerequisites_test.py
git commit -m "feat: gather-mode generation contract for prerequisites"
```

---

### Task 6: Generator — token building, render, persist, and `main`

**Files:**
- Modify: `scripts/generate_prerequisites.py`
- Modify: `tests/generate_prerequisites_test.py`

**Interfaces:**
- Consumes: `prereq_tokens` (Task 2), `render` (`scripts/render_email_previews.py`), `quote_tokens`/`select_quote`/`load_bundle` (`scripts/quotes.py`), `select_newest_paper`/`authors_short`/`build_gather_contract` (Tasks 4–5).
- Produces:
  - `build_tokens(paper, prereqs, per_send, quote) -> dict[str, str]` — the full flat token dict for the template.
  - `render_new_paper_email(tokens) -> dict[str, str]` — `{"html","text"}`; raises `ValueError` listing any unresolved tokens.
  - `save_prerequisites(conn, paper_id, payload) -> None` — `UPDATE papers SET prerequisites = %s::jsonb WHERE id = %s`.
  - `main(argv=None) -> int` — `--mode gather|render`.

- [ ] **Step 1: Write the failing tests**

```python
def test_build_tokens_maps_all_template_keys():
    from scripts.generate_prerequisites import build_tokens
    paper = {"id": 2, "title": "Full Title", "url": "http://x",
             "authors": ["Li Zhao", "Mei Guo", "Wei Wang"]}
    prereqs = {"lede": "Groundwork.", "items": ["a", "b", "c"],
               "summary": "it forecasts gold.", "short_title": "Short T"}
    per_send = {"recipient.firstName": "Maya", "lead.name": "Claudia",
                "lead.initial": "C", "lead.blurb": "leads this one.",
                "signoff.names": "Michelle & Claudia",
                "links.availability": "http://a", "links.rsvpManage": "http://r"}
    quote = {"quote.text": "q", "quote.by": "Grace Hopper", "quote.role": "CS"}
    t = build_tokens(paper, prereqs, per_send, quote)
    assert t["paper.title"] == "Full Title"
    assert t["paper.shortTitle"] == "Short T"
    assert t["paper.summary"] == "it forecasts gold."
    assert t["paper.authorsShort"] == "Zhao, Guo & Wang"
    assert t["prereqs.lede"] == "Groundwork." and "<tr>" in t["prereqs.html"]
    assert t["recipient.firstName"] == "Maya" and t["quote.by"] == "Grace Hopper"


def test_render_new_paper_email_raises_on_unresolved():
    from scripts.generate_prerequisites import render_new_paper_email
    with pytest.raises(ValueError):
        render_new_paper_email({"recipient.firstName": "Maya"})  # missing most tokens
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest -c tests/pytest.ini tests/generate_prerequisites_test.py -k "build_tokens or render_new_paper" -v`
Expected: FAIL — functions not defined.

- [ ] **Step 3: Implement the remaining functions + `main`**

```python
def build_tokens(
    paper: dict[str, Any],
    prereqs: dict[str, Any],
    per_send: dict[str, str],
    quote: dict[str, str],
) -> dict[str, str]:
    """Assemble every {{ token }} the new-paper-announcement template needs."""
    from scripts.prerequisites import prereq_tokens

    tokens: dict[str, str] = {
        "paper.title": paper["title"],
        "paper.url": paper["url"],
        "paper.shortTitle": prereqs["short_title"],
        "paper.summary": prereqs["summary"],
        "paper.authorsShort": authors_short(paper.get("authors") or []),
    }
    tokens.update(prereq_tokens(prereqs["lede"], list(prereqs["items"])))
    tokens.update(per_send)
    tokens.update(quote)
    return tokens


def render_new_paper_email(tokens: dict[str, str]) -> dict[str, str]:
    """Render the .html + .txt pair; raise ValueError if any token is unresolved."""
    from scripts.render_email_previews import TEMPLATES, render

    out: dict[str, str] = {}
    unresolved: list[str] = []
    for ext, key in (("html", "html"), ("txt", "text")):
        src = (TEMPLATES / f"new-paper-announcement.{ext}").read_text(encoding="utf-8")
        rendered, missing = render(src, tokens)
        unresolved.extend(missing)
        out[key] = rendered
    if unresolved:
        raise ValueError(f"unresolved tokens: {sorted(set(unresolved))}")
    return out


def save_prerequisites(conn: psycopg.Connection, paper_id: int, payload: dict[str, Any]) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE papers SET prerequisites = %s::jsonb WHERE id = %s",
            (json.dumps(payload), paper_id),
        )
    conn.commit()


def _parse_env_file(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.exists():
        return out
    for line in path.read_text().splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        m = _ENV_LINE_RE.match(line)
        if not m:
            continue
        key, val = m.group(1), m.group(2)
        if (val[:1], val[-1:]) in (('"', '"'), ("'", "'")):
            val = val[1:-1]
        out[key] = val
    return out


def _db_url() -> str:
    env = _parse_env_file(DEFAULT_ENV_FILE)
    url = os.environ.get("SUPABASE_DB_URL") or env.get("SUPABASE_DB_URL")
    if not url:
        raise SystemExit("error: missing env var SUPABASE_DB_URL")
    return url


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="generate_prerequisites.py")
    p.add_argument("--mode", choices=("gather", "render"), required=True)
    args = p.parse_args(argv)

    conn = psycopg.connect(_db_url())
    try:
        paper = select_newest_paper(conn)
        if args.mode == "gather":
            json.dump(build_gather_contract(paper), sys.stdout)
            return 0

        # render
        prereqs = paper.get("prerequisites")
        if not prereqs:
            print(
                f"error: papers.prerequisites is empty for paper {paper['id']}; "
                "run --mode gather and persist the agent's draft first.",
                file=sys.stderr,
            )
            return 1
        per_send = json.loads(sys.stdin.read())
        from scripts.quotes import load_bundle, quote_tokens, select_quote
        quote = quote_tokens(select_quote(load_bundle(), date.today().toordinal()))
        tokens = build_tokens(paper, prereqs, per_send, quote)
        rendered = render_new_paper_email(tokens)
        json.dump({"paper_id": paper["id"], **rendered}, sys.stdout)
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Run the full generator test file**

Run: `uv run pytest -c tests/pytest.ini tests/generate_prerequisites_test.py -v`
Expected: PASS (all tests).

- [ ] **Step 5: Lint + type the module**

Run: `uv run ruff check scripts/generate_prerequisites.py tests/generate_prerequisites_test.py && uv run ty check`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add scripts/generate_prerequisites.py tests/generate_prerequisites_test.py
git commit -m "feat: prerequisites token building, render, persist + CLI"
```

---

### Task 7: Orchestration prompt + runbook

**Files:**
- Create: `scheduled_tasks/new-paper-announcement.md`
- Modify: `docs/runbooks/transactional-emails.md`

**Interfaces:**
- Consumes: `scripts/generate_prerequisites.py` (both modes), the Supabase MCP `execute_sql`/`apply_migration`, the Gmail MCP draft step, `assets/emails/template/new-paper-announcement.{html,txt}`.

- [ ] **Step 1: Write `scheduled_tasks/new-paper-announcement.md`** — an agent prompt following the existing `scheduled_tasks/*.md` shape, with these steps: (1) run `uv run python -m scripts.generate_prerequisites --mode gather` and read the contract; (2) draft `{short_title, summary, lede, items:[3]}` with Claude per the contract's guidance; (3) persist with `UPDATE papers SET prerequisites = '<json>'::jsonb WHERE id = <paper_id>` via `execute_sql`, `status:"draft"`, plus `model` and `generated_at`; (4) for each active member, pipe the per-send tokens (recipient/lead/signoff/links) into `--mode render` and create a Gmail **draft** (never auto-send); (5) log to `command_log` (`source='scheduled_task'`, `name='new-paper-announcement'`).

- [ ] **Step 2: Add the template row to `docs/runbooks/transactional-emails.md`** — `new-paper-announcement.{html,txt}` → consumer `scheduled_tasks/new-paper-announcement.md`; list the required tokens; note prerequisites come from `papers.prerequisites`.

- [ ] **Step 3: Dry-run walkthrough** — with `SUPABASE_DB_URL` set against a dev branch, run `--mode gather`, hand-draft a sample payload, `execute_sql` the UPDATE, then run `--mode render` with a sample per-send JSON and confirm a fully-resolved HTML/text pair is emitted.

- [ ] **Step 4: Commit**

```bash
git add scheduled_tasks/new-paper-announcement.md docs/runbooks/transactional-emails.md
git commit -m "docs: orchestration prompt + runbook for new-paper-announcement"
```

---

## Self-Review

**Spec coverage:**
- Template (flat, court voice, email-safe, prereqs block, preview coverage) → Task 3. ✅
- Newest-paper selection → Task 4. ✅
- Derived paper-card fields (shortTitle/summary/authorsShort) → Tasks 4 & 6. ✅
- AI-drafted prerequisites, agent-in-the-loop → Tasks 5 (contract) + 7 (agent step). ✅
- Saved-for-edit persistence in `papers.prerequisites` → Tasks 1 & 6 (`save_prerequisites`). ✅
- Render → Gmail draft → operator review → Task 6 (`render`) + Task 7 (draft step). ✅
- Testing (composer, selection, token mapping, unresolved guard) → Tasks 2, 4, 6. ✅
- Migration additive/nullable, number 022 → Task 1. ✅

**Placeholder scan:** No TBD/TODO. The template body (Task 3) is specified block-by-block with the exact token list and a concrete reference file rather than 300 lines of inlined table HTML — deliberate for a large email asset, not a vague placeholder.

**Type consistency:** `select_newest_paper`→dict consumed by `build_gather_contract`/`build_tokens`; `prereqs` dict keys (`lede`, `items`, `summary`, `short_title`) consistent across Tasks 5–7 and the JSONB shape in Task 1; token names identical between the template (Task 3), `prereq_tokens` (Task 2, `prereqs.*`), and `build_tokens` (Task 6).

## Notes / deviations from the design canvas

- The design's `questions.item1..3` become the repo's escaped row-block idiom
  `{{ prereqs.html }}` (+ `prereqs.lede`/`prereqs.text`), matching how
  `pre-meeting-reminder` renders its list and fixing the HTML-vs-plain escaping
  that three raw tokens can't handle. Same visual result.
- Only the `courtVoice` header is ported (per the locked voice decision); the
  standard-mark variant and the other toggle blocks (meet strip, inline
  availability poll, callout note) are out of scope for this per-purpose template.
```