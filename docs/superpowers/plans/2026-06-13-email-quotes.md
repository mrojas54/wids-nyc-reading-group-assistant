# Rotating Women-in-STEM Email Quotes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a verified, version-controlled pool of women-in-STEM quotes that rotates deterministically into the availability/reminder emails and a dashboard quote-of-the-day card.

**Architecture:** Per-author folders under `data/quotes/<slug>/` (`author.json` + dated `YYYYMMDD_quotes.json`) are validated by `scripts/build_quotes.py`, which emits a committed, drift-guarded bundle `web/lib/quotes.generated.json`. Two thin selectors with an identical FNV-1a spec — `scripts/quotes.py` (emails) and `web/lib/quotes.ts` (dashboard) — pick one quote per date key. Only `verified: true` quotes with a `sourceUrl` are eligible; the build fails CI otherwise.

**Tech Stack:** Python 3.11 (uv, pytest, ruff, ty), Next.js 16 / React 19 (vitest, @testing-library/react), Mustache-style `{{ token }}` email templates rendered by the agent driving Gmail MCP.

**Spec:** `docs/superpowers/specs/2026-06-12-email-quotes-design.md`

**Conventions:** Conventional Commits; append the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer to every commit per repo rules. Run Python tools with `uv run`. Commit only the explicit paths listed in each step.

---

## File Structure

**New (Python):**
- `scripts/quotes.py` — FNV-1a hash + deterministic selection over the bundle (email side).
- `scripts/build_quotes.py` — validate author folders, resolve newest snapshot, emit bundle, refresh symlinks.
- `tests/quotes_select_test.py` — selection + hash tests.
- `tests/build_quotes_test.py` — build/validation + drift + real-data sourcing tests.

**New (data):**
- `data/quotes/<slug>/author.json`, `data/quotes/<slug>/20260613_quotes.json`, `data/quotes/<slug>/quotes.json` (symlink) — six seed authors.

**New (web):**
- `web/lib/quotes.generated.json` — committed bundle (emitted by build).
- `web/lib/quotes.ts` — TS selector mirroring `scripts/quotes.py`.
- `web/lib/__tests__/quotes.test.ts` — TS selector tests.
- `web/components/QuoteCard.tsx` — dashboard quote-of-the-day card.
- `web/components/__tests__/QuoteCard.test.tsx` — component test.

**Modified:**
- `scripts/render_email_previews.py` + `tests/render_email_previews_test.py` — wire selector, render availability-reminder, assert quote blocks.
- `assets/emails/template/availability-reminder.{html,txt}` — add quote block.
- `assets/emails/template/availability-thanks.{html,txt}` — add quote block.
- `scheduled_tasks/availability-chase.md`, `scheduled_tasks/pre-meeting-reminder.md` — quote-resolution notes + inline plaintext quote line.
- `docs/email-quotes.md` — point at the machine-readable pool.
- `web/app/dashboard/page.tsx` — mount `QuoteCard`.
- `.github/workflows/ci.yml` — add the two new Python test files.

---

## Task 1: Selection core (`scripts/quotes.py`)

**Files:**
- Create: `scripts/quotes.py`
- Test: `tests/quotes_select_test.py`

- [ ] **Step 1: Write the failing test**

Create `tests/quotes_select_test.py`:

```python
"""Tests for scripts/quotes.py (FNV-1a + deterministic selection). Run via:
    uv run pytest -c tests/pytest.ini tests/quotes_select_test.py -v
"""
from __future__ import annotations


def test_fnv1a_known_vectors():
    from scripts.quotes import fnv1a
    # Canonical FNV-1a 32-bit test vectors. The TS side asserts the same three,
    # so both implementations are pinned to the identical algorithm.
    assert fnv1a("") == 0x811C9DC5
    assert fnv1a("a") == 0xE40C292C
    assert fnv1a("foobar") == 0xBF9CF968


def _bundle(*ids):
    return {
        "version": 1,
        "authors": [
            {
                "author": {"id": f"a-{qid}", "name": f"Name {qid}", "role": "Role"},
                "quotes": [
                    {"id": qid, "text": f"T {qid}", "verified": True, "sourceUrl": "https://x"}
                ],
            }
            for qid in ids
        ],
    }


def test_select_is_deterministic():
    from scripts.quotes import select_quote
    b = _bundle("q1", "q2", "q3", "q4", "q5")
    assert select_quote(b, 42).quote["id"] == select_quote(b, 42).quote["id"]


def test_select_scatters_and_is_salted():
    from scripts.quotes import select_quote
    b = _bundle("q1", "q2", "q3", "q4", "q5")
    chosen = {select_quote(b, k).quote["id"] for k in range(200)}
    assert len(chosen) >= 2  # deterministic FNV-1a scatter, not stuck on one quote
    # The salt shifts the selection for at least one key (proves it is wired).
    assert any(
        select_quote(b, k).quote["id"] != select_quote(b, k, "x").quote["id"]
        for k in range(20)
    )


def test_select_only_returns_verified():
    from scripts.quotes import select_quote
    b = {
        "version": 1,
        "authors": [
            {"author": {"id": "a1", "name": "A1", "role": "R"},
             "quotes": [{"id": "u", "text": "unverified", "verified": False}]},
            {"author": {"id": "a2", "name": "A2", "role": "R"},
             "quotes": [{"id": "v", "text": "verified", "verified": True, "sourceUrl": "https://x"}]},
        ],
    }
    for k in range(20):
        assert select_quote(b, k).quote["id"] == "v"


def test_select_empty_pool_returns_fallback():
    from scripts.quotes import select_quote, FALLBACK
    assert select_quote({"version": 1, "authors": []}, 5) == FALLBACK


def test_quote_tokens_maps_author_and_quote():
    from scripts.quotes import quote_tokens, Selection
    sel = Selection(
        author={"id": "x", "name": "Ada Lovelace", "role": "Mathematician"},
        quote={"id": "q", "text": "Hello", "verified": True},
    )
    assert quote_tokens(sel) == {
        "quote.text": "Hello",
        "quote.by": "Ada Lovelace",
        "quote.role": "Mathematician",
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest -c tests/pytest.ini tests/quotes_select_test.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'scripts.quotes'`.

- [ ] **Step 3: Write minimal implementation**

Create `scripts/quotes.py`:

```python
"""Rotating women-in-STEM quote selection (shared spec, Python side).

Loads the generated bundle (web/lib/quotes.generated.json) and selects a quote
deterministically from an integer date key. Mirrors web/lib/quotes.ts — keep the
two in sync; the FNV-1a test vectors pin the algorithm in both languages.

Run tests via:
    uv run pytest -c tests/pytest.ini tests/quotes_select_test.py -v
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
BUNDLE_PATH = REPO_ROOT / "web" / "lib" / "quotes.generated.json"

_FNV_OFFSET = 0x811C9DC5
_FNV_PRIME = 0x01000193
_MASK32 = 0xFFFFFFFF


def fnv1a(s: str) -> int:
    """32-bit FNV-1a hash. Date keys + salt are ASCII, so this agrees
    byte-for-byte with the charCodeAt-based TypeScript implementation."""
    h = _FNV_OFFSET
    for byte in s.encode("utf-8"):
        h ^= byte
        h = (h * _FNV_PRIME) & _MASK32
    return h


@dataclass(frozen=True)
class Selection:
    """A chosen (author, quote) pair — both are the raw bundle dicts."""

    author: dict[str, Any]
    quote: dict[str, Any]


FALLBACK = Selection(
    author={
        "id": "grace-hopper",
        "name": "Grace Hopper",
        "role": "Computer scientist · US Navy rear admiral",
    },
    quote={
        "id": "hopper-always-done",
        "text": "The most dangerous phrase in the language is, "
        "'we've always done it this way.'",
        "verified": True,
    },
)


def load_bundle(path: Path = BUNDLE_PATH) -> dict[str, Any]:
    """Read the committed generated bundle."""
    return json.loads(path.read_text(encoding="utf-8"))


def eligible_pairs(bundle: dict[str, Any]) -> list[Selection]:
    """Flatten verified quotes into (author, quote) pairs, sorted by quote id."""
    pairs = [
        Selection(author=entry["author"], quote=quote)
        for entry in bundle.get("authors", [])
        for quote in entry.get("quotes", [])
        if quote.get("verified")
    ]
    pairs.sort(key=lambda s: s.quote["id"])
    return pairs


def select_quote(bundle: dict[str, Any], date_key: int, salt: str = "") -> Selection:
    """Pick a quote for `date_key`, scattered deterministically by FNV-1a.
    Returns FALLBACK when no verified quotes exist. A pure modulo with no
    cross-day state — keeps the Python/TS pair trivially identical."""
    pairs = eligible_pairs(bundle)
    if not pairs:
        return FALLBACK
    return pairs[fnv1a(f"{date_key}{salt}") % len(pairs)]


def quote_tokens(sel: Selection) -> dict[str, str]:
    """Mustache tokens for the email templates."""
    return {
        "quote.text": sel.quote["text"],
        "quote.by": sel.author["name"],
        "quote.role": sel.author["role"],
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest -c tests/pytest.ini tests/quotes_select_test.py -v`
Expected: PASS (6 tests).

- [ ] **Step 5: Lint + type-check**

Run: `uv run ruff check scripts/quotes.py tests/quotes_select_test.py && uv run ty check`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add scripts/quotes.py tests/quotes_select_test.py
git commit -m "feat: deterministic women-in-STEM quote selector (python)"
```

---

## Task 2: Build + validation (`scripts/build_quotes.py`)

**Files:**
- Create: `scripts/build_quotes.py`
- Test: `tests/build_quotes_test.py`

- [ ] **Step 1: Write the failing test**

Create `tests/build_quotes_test.py`:

```python
"""Tests for scripts/build_quotes.py. Run via:
    uv run pytest -c tests/pytest.ini tests/build_quotes_test.py -v
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest


def _author(folder: Path, slug: str) -> None:
    folder.mkdir(parents=True)
    (folder / "author.json").write_text(
        json.dumps({"id": slug, "name": slug.title(), "role": "Scientist"}),
        encoding="utf-8",
    )


def _quotes(folder: Path, name: str, quotes: list[dict]) -> None:
    (folder / name).write_text(json.dumps(quotes), encoding="utf-8")


def test_newest_quotes_file_picks_latest_date(tmp_path):
    from scripts.build_quotes import newest_quotes_file
    f = tmp_path / "ada"
    _author(f, "ada")
    _quotes(f, "20260101_quotes.json", [{"id": "a", "text": "x", "verified": False}])
    _quotes(f, "20260615_quotes.json", [{"id": "b", "text": "y", "verified": False}])
    assert newest_quotes_file(f).name == "20260615_quotes.json"


def test_assemble_rejects_slug_id_mismatch(tmp_path):
    from scripts.build_quotes import assemble_bundle, QuoteDataError
    f = tmp_path / "ada"
    f.mkdir(parents=True)
    (f / "author.json").write_text(
        json.dumps({"id": "nope", "name": "A", "role": "R"}), encoding="utf-8"
    )
    _quotes(f, "20260101_quotes.json", [{"id": "a", "text": "x", "verified": False}])
    with pytest.raises(QuoteDataError):
        assemble_bundle(tmp_path)


def test_assemble_rejects_verified_quote_without_source(tmp_path):
    from scripts.build_quotes import assemble_bundle, QuoteDataError
    f = tmp_path / "ada"
    _author(f, "ada")
    _quotes(f, "20260101_quotes.json", [{"id": "a", "text": "x", "verified": True}])
    with pytest.raises(QuoteDataError):
        assemble_bundle(tmp_path)


def test_assemble_sorts_authors_and_quotes(tmp_path):
    from scripts.build_quotes import assemble_bundle
    fb = tmp_path / "bohr"
    _author(fb, "bohr")
    _quotes(fb, "20260101_quotes.json", [
        {"id": "z", "text": "t", "verified": True, "sourceUrl": "https://x"},
        {"id": "a", "text": "t", "verified": True, "sourceUrl": "https://x"},
    ])
    fa = tmp_path / "ada"
    _author(fa, "ada")
    _quotes(fa, "20260101_quotes.json", [
        {"id": "m", "text": "t", "verified": True, "sourceUrl": "https://x"},
    ])
    bundle = assemble_bundle(tmp_path)
    assert [e["author"]["id"] for e in bundle["authors"]] == ["ada", "bohr"]
    assert [q["id"] for q in bundle["authors"][1]["quotes"]] == ["a", "z"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest -c tests/pytest.ini tests/build_quotes_test.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'scripts.build_quotes'`.

- [ ] **Step 3: Write minimal implementation**

Create `scripts/build_quotes.py`:

```python
"""Validate per-author quote folders and emit the generated bundle.

Source of truth:  data/quotes/<slug>/author.json + <slug>/YYYYMMDD_quotes.json
Generated:        web/lib/quotes.generated.json   (committed; drift-guarded)

The newest YYYYMMDD_quotes.json per folder is "current" (dates sort
lexicographically, so max-by-name == newest). The quotes.json symlink is a
human convenience only: ignored for resolution, refreshed best-effort after a
successful run.

Run via:
    uv run python scripts/build_quotes.py
Tests:
    uv run pytest -c tests/pytest.ini tests/build_quotes_test.py -v
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
QUOTES_DIR = REPO_ROOT / "data" / "quotes"
BUNDLE_PATH = REPO_ROOT / "web" / "lib" / "quotes.generated.json"
BUNDLE_VERSION = 1

_AUTHOR_REQUIRED = ("id", "name", "role")


class QuoteDataError(ValueError):
    """Raised when an author folder violates the schema or sourcing rules."""


def newest_quotes_file(folder: Path) -> Path:
    """Return the lexicographically-greatest *_quotes.json in `folder`.

    Filenames are YYYYMMDD_quotes.json, so max-by-name == newest date. The
    dateless quotes.json symlink is excluded by the glob pattern.
    """
    candidates = sorted(folder.glob("*_quotes.json"))
    if not candidates:
        raise QuoteDataError(f"{folder.name}: no YYYYMMDD_quotes.json found")
    return candidates[-1]


def load_author(folder: Path) -> dict[str, Any]:
    author_path = folder / "author.json"
    if not author_path.exists():
        raise QuoteDataError(f"{folder.name}: missing author.json")
    author: dict[str, Any] = json.loads(author_path.read_text(encoding="utf-8"))
    for field in _AUTHOR_REQUIRED:
        if not author.get(field):
            raise QuoteDataError(f"{folder.name}: author.{field} is required")
    if author["id"] != folder.name:
        raise QuoteDataError(
            f"{folder.name}: author.id={author['id']!r} must equal the folder slug"
        )
    return author


def load_quotes(folder: Path) -> list[dict[str, Any]]:
    quotes: Any = json.loads(newest_quotes_file(folder).read_text(encoding="utf-8"))
    if not isinstance(quotes, list):
        raise QuoteDataError(f"{folder.name}: quotes file must be a JSON array")
    seen: set[str] = set()
    for q in quotes:
        qid = q.get("id")
        if not qid:
            raise QuoteDataError(f"{folder.name}: a quote is missing 'id'")
        if not q.get("text"):
            raise QuoteDataError(f"{folder.name}/{qid}: 'text' is required")
        if "verified" not in q:
            raise QuoteDataError(f"{folder.name}/{qid}: 'verified' is required")
        if q["verified"] and not q.get("sourceUrl"):
            raise QuoteDataError(
                f"{folder.name}/{qid}: verified quotes require a 'sourceUrl'"
            )
        if qid in seen:
            raise QuoteDataError(f"{folder.name}: duplicate quote id {qid!r}")
        seen.add(qid)
    return quotes


def assemble_bundle(quotes_dir: Path) -> dict[str, Any]:
    """Validate every author folder and return the normalized bundle dict."""
    entries: list[dict[str, Any]] = []
    for folder in sorted(p for p in quotes_dir.iterdir() if p.is_dir()):
        author = load_author(folder)
        quotes = sorted(load_quotes(folder), key=lambda q: q["id"])
        entries.append({"author": author, "quotes": quotes})
    entries.sort(key=lambda e: e["author"]["id"])
    return {"version": BUNDLE_VERSION, "authors": entries}


def refresh_symlink(folder: Path, newest: Path) -> None:
    """Best-effort: point folder/quotes.json at `newest`. Warn, never fail."""
    link = folder / "quotes.json"
    try:
        if link.is_symlink() or link.exists():
            link.unlink()
        link.symlink_to(newest.name)
    except OSError as exc:  # platforms without symlink support
        print(f"WARNING: could not refresh {link}: {exc}", file=sys.stderr)


def write_bundle(bundle: dict[str, Any]) -> None:
    BUNDLE_PATH.parent.mkdir(parents=True, exist_ok=True)
    BUNDLE_PATH.write_text(
        json.dumps(bundle, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )


def main() -> int:
    try:
        bundle = assemble_bundle(QUOTES_DIR)
    except QuoteDataError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    write_bundle(bundle)
    for folder in sorted(p for p in QUOTES_DIR.iterdir() if p.is_dir()):
        refresh_symlink(folder, newest_quotes_file(folder))
    n_quotes = sum(len(e["quotes"]) for e in bundle["authors"])
    print(f"Wrote {len(bundle['authors'])} authors / {n_quotes} quotes to {BUNDLE_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest -c tests/pytest.ini tests/build_quotes_test.py -v`
Expected: PASS (4 tests).

- [ ] **Step 5: Lint + type-check**

Run: `uv run ruff check scripts/build_quotes.py tests/build_quotes_test.py && uv run ty check`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add scripts/build_quotes.py tests/build_quotes_test.py
git commit -m "feat: validate quote folders and emit generated bundle"
```

---

## Task 3: Seed author data + emit bundle + drift guard

**Files:**
- Create: `data/quotes/{grace-hopper,ada-lovelace,katherine-johnson,hedy-lamarr,maryam-mirzakhani,radia-perlman}/author.json`
- Create: matching `20260613_quotes.json` in each folder
- Generate: `web/lib/quotes.generated.json` + the `quotes.json` symlinks (via the build)
- Modify: `tests/build_quotes_test.py` (append real-data guards)

- [ ] **Step 1: Create the six `author.json` files**

`data/quotes/grace-hopper/author.json`:
```json
{
  "id": "grace-hopper",
  "name": "Grace Hopper",
  "role": "Computer scientist · US Navy rear admiral",
  "birthdate": "1906-12-09",
  "deathdate": "1992-01-01",
  "fields": ["computer science", "compilers"],
  "notable_contributions": "Built the first compiler (A-0), drove the creation of COBOL, and popularized the term \"debugging\".",
  "wikipediaUrl": "https://en.wikipedia.org/wiki/Grace_Hopper"
}
```

`data/quotes/ada-lovelace/author.json`:
```json
{
  "id": "ada-lovelace",
  "name": "Ada Lovelace",
  "role": "Mathematician · first computer programmer",
  "birthdate": "1815-12-10",
  "deathdate": "1852-11-27",
  "fields": ["mathematics", "computing"],
  "notable_contributions": "Wrote the first published algorithm intended for a machine — Babbage's Analytical Engine.",
  "wikipediaUrl": "https://en.wikipedia.org/wiki/Ada_Lovelace"
}
```

`data/quotes/katherine-johnson/author.json`:
```json
{
  "id": "katherine-johnson",
  "name": "Katherine Johnson",
  "role": "NASA research mathematician",
  "birthdate": "1918-08-26",
  "deathdate": "2020-02-24",
  "fields": ["mathematics", "aerospace"],
  "notable_contributions": "Calculated trajectories for NASA's first crewed spaceflights, including John Glenn's orbital mission.",
  "wikipediaUrl": "https://en.wikipedia.org/wiki/Katherine_Johnson"
}
```

`data/quotes/hedy-lamarr/author.json`:
```json
{
  "id": "hedy-lamarr",
  "name": "Hedy Lamarr",
  "role": "Actress · inventor",
  "birthdate": "1914-11-09",
  "deathdate": "2000-01-19",
  "fields": ["telecommunications", "invention"],
  "notable_contributions": "Co-invented a frequency-hopping spread-spectrum system, a foundation for modern wireless communication.",
  "wikipediaUrl": "https://en.wikipedia.org/wiki/Hedy_Lamarr"
}
```

`data/quotes/maryam-mirzakhani/author.json`:
```json
{
  "id": "maryam-mirzakhani",
  "name": "Maryam Mirzakhani",
  "role": "Mathematician · Fields Medalist, 2014",
  "birthdate": "1977-05-12",
  "deathdate": "2017-07-14",
  "fields": ["mathematics"],
  "notable_contributions": "First woman to win the Fields Medal, for work on the dynamics and geometry of Riemann surfaces.",
  "wikipediaUrl": "https://en.wikipedia.org/wiki/Maryam_Mirzakhani"
}
```

`data/quotes/radia-perlman/author.json` (alive — `deathdate` intentionally omitted, exercising the optional field):
```json
{
  "id": "radia-perlman",
  "name": "Radia Perlman",
  "role": "Network engineer · \"Mother of the Internet\"",
  "birthdate": "1951-12-18",
  "fields": ["computer networking"],
  "notable_contributions": "Invented the Spanning Tree Protocol, foundational to modern Ethernet networks.",
  "wikipediaUrl": "https://en.wikipedia.org/wiki/Radia_Perlman"
}
```

- [ ] **Step 2: Create the six dated `20260613_quotes.json` files**

`data/quotes/grace-hopper/20260613_quotes.json`:
```json
[
  {
    "id": "hopper-always-done",
    "text": "The most dangerous phrase in the language is, 'we've always done it this way.'",
    "year": null,
    "source": "Widely documented in her public lectures and interviews",
    "sourceUrl": "https://en.wikiquote.org/wiki/Grace_Hopper",
    "verified": true
  },
  {
    "id": "hopper-ask-forgiveness",
    "text": "It's easier to ask forgiveness than it is to get permission.",
    "year": 1986,
    "source": "Interview; widely cited in profiles of Hopper",
    "sourceUrl": "https://en.wikiquote.org/wiki/Grace_Hopper",
    "verified": true
  }
]
```

`data/quotes/ada-lovelace/20260613_quotes.json`:
```json
[
  {
    "id": "lovelace-more-than-mortal",
    "text": "That brain of mine is something more than merely mortal; as time will show.",
    "year": 1843,
    "source": "Letter to Charles Babbage",
    "sourceUrl": "https://en.wikiquote.org/wiki/Ada_Lovelace",
    "verified": true
  }
]
```

`data/quotes/katherine-johnson/20260613_quotes.json`:
```json
[
  {
    "id": "johnson-like-what-you-do",
    "text": "Like what you do, and then you will do your best.",
    "year": null,
    "source": "NASA interview",
    "sourceUrl": "https://en.wikiquote.org/wiki/Katherine_Johnson",
    "verified": true
  }
]
```

`data/quotes/hedy-lamarr/20260613_quotes.json`:
```json
[
  {
    "id": "lamarr-brains-interesting",
    "text": "The brains of people are more interesting than the looks, I think.",
    "year": null,
    "source": "Attributed in biographies and interviews",
    "sourceUrl": "https://en.wikiquote.org/wiki/Hedy_Lamarr",
    "verified": true
  }
]
```

`data/quotes/maryam-mirzakhani/20260613_quotes.json`:
```json
[
  {
    "id": "mirzakhani-beauty-patient",
    "text": "The beauty of mathematics only shows itself to more patient followers.",
    "year": 2008,
    "source": "Interview, Clay Mathematics Institute",
    "sourceUrl": "https://en.wikiquote.org/wiki/Maryam_Mirzakhani",
    "verified": true
  }
]
```

`data/quotes/radia-perlman/20260613_quotes.json`:
```json
[
  {
    "id": "perlman-many-female-engineers",
    "text": "The world should have so many female engineers that it wouldn't be at all noteworthy.",
    "year": null,
    "source": "Interview",
    "sourceUrl": "https://en.wikiquote.org/wiki/Radia_Perlman",
    "verified": true
  }
]
```

- [ ] **Step 3: Run the build to emit the bundle + symlinks**

Run: `uv run python scripts/build_quotes.py`
Expected: `Wrote 6 authors / 7 quotes to .../web/lib/quotes.generated.json`, and a `quotes.json` symlink now exists in each folder pointing at `20260613_quotes.json`.

- [ ] **Step 4: Append real-data guard tests**

Append to `tests/build_quotes_test.py`:

```python
# --- real-data guards (require data/quotes/ + the committed bundle) ---


def test_committed_bundle_is_in_sync():
    from scripts.build_quotes import assemble_bundle, QUOTES_DIR, BUNDLE_PATH
    fresh = assemble_bundle(QUOTES_DIR)
    committed = json.loads(BUNDLE_PATH.read_text(encoding="utf-8"))
    assert fresh == committed, "Run `uv run python scripts/build_quotes.py` and commit."


def test_real_data_verified_quotes_have_sources():
    from scripts.build_quotes import assemble_bundle, QUOTES_DIR
    bundle = assemble_bundle(QUOTES_DIR)
    assert bundle["authors"], "expected at least one seeded author"
    for entry in bundle["authors"]:
        for q in entry["quotes"]:
            if q["verified"]:
                assert q.get("sourceUrl"), f'{q["id"]}: verified without sourceUrl'
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `uv run pytest -c tests/pytest.ini tests/build_quotes_test.py -v`
Expected: PASS (6 tests total).

- [ ] **Step 6: Commit (include the symlinks)**

```bash
git add data/quotes web/lib/quotes.generated.json tests/build_quotes_test.py
git commit -m "feat: seed verified women-in-STEM quote pool + generated bundle"
```

---

## Task 4: Wire selector into email previews

**Files:**
- Modify: `scripts/render_email_previews.py`
- Test: `tests/render_email_previews_test.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/render_email_previews_test.py` (the file already imports `pytest` at the top; `rsvp-confirmation` already carries the quote tokens, so these are green once `main()` is wired — the availability-reminder/thanks presence tests live in Tasks 5–6 so each task commits green):

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest -c tests/pytest.ini tests/render_email_previews_test.py -v`
Expected: FAIL — `test_preview_main_renders_three_emails_with_no_unresolved_quote` errors with `KeyError: 'availability_reminder'` (the current `main()` only emits two keys) / `ModuleNotFoundError` for the new import path until the wiring below lands.

- [ ] **Step 3: Add the import + preview date key**

In `scripts/render_email_previews.py`, after the line `from pathlib import Path`, add:

```python
from scripts.quotes import load_bundle, quote_tokens, select_quote
```

> This makes the script a package-relative import. Tests import it via `tests/conftest.py` (repo root on `sys.path`), so they resolve it fine. For ad-hoc CLI runs use module mode — `uv run python -m scripts.render_email_previews` — so `scripts.quotes` resolves. Update the module docstring's run hint accordingly if it names a path-style invocation.

After the `TEMPLATES = ...` line, add:

```python
# Fixed so previews are byte-reproducible regardless of the calendar date.
PREVIEW_DATE_KEY = 20617
```

- [ ] **Step 4: Remove the hardcoded quote tokens from `RSVP_TOKENS`**

Delete these three lines from the `RSVP_TOKENS` dict:

```python
    "quote.text": "The beauty of mathematics only shows itself to more patient followers.",
    "quote.by": "Maryam Mirzakhani",
    "quote.role": "Fields Medalist, 2014",
```

- [ ] **Step 5: Add `REMINDER_TOKENS` and rewrite `main()`**

After the `AVAIL_TOKENS = { ... }` dict, add:

```python
REMINDER_TOKENS = {
    "recipient.firstName": "Maya",
    "paper.title": "Hybrid LSTM–Transformer Architecture with Multi-Scale Feature Fusion for High-Accuracy Gold Futures Price Forecasting",
    "paper.authorsShort": "Zhao, Guo & Wang",
    "paper.citation": "in <em>Mathematics</em> (2025)",
    "paper.citationText": "in Mathematics (2025)",
    "paper.url": "https://doi.org/10.3390/math13101551",
    "paper.location": "Brooklyn, TBD",
    "paper.duration": "~90 min",
    "paper.companionDropDay": "Wed",
    "paper.metaLine": "Brooklyn, TBD · ~90 min · Paper Pal drops Wed",
    "stats.submittedCount": "5",
    "stats.submittedCountWord": "Five",
    "stats.totalMembers": "12",
    "deadline.soft": "Sunday evening",
    "links.availability": "https://wids-nyc-reading-group-assistant.vercel.app/availability",
    "links.companionPreview": "https://wids-nyc-reading-group-assistant.vercel.app/papers/2",
    "links.portalBase": "https://wids-nyc-reading-group-assistant.vercel.app",
    "operator.displayName": "Michelle Rojas",
}
```

Replace the entire `main()` function body with:

```python
def main() -> int:
    q = quote_tokens(select_quote(load_bundle(), PREVIEW_DATE_KEY))
    rsvp = render_pair("rsvp-confirmation", {**RSVP_TOKENS, **q})
    thanks = render_pair("availability-thanks", {**AVAIL_TOKENS, **q})
    reminder = render_pair("availability-reminder", {**REMINDER_TOKENS, **q})
    json.dump(
        {
            "rsvp_confirmation": {"html": rsvp["html"], "text": rsvp["txt"]},
            "availability_thanks": {"html": thanks["html"], "text": thanks["txt"]},
            "availability_reminder": {"html": reminder["html"], "text": reminder["txt"]},
        },
        sys.stdout,
    )
    return 0
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `uv run pytest -c tests/pytest.ini tests/render_email_previews_test.py -v`
Expected: PASS — `test_rsvp_confirmation_carries_quote_tokens` (html + txt) and `test_preview_main_renders_three_emails_with_no_unresolved_quote` both green (rsvp already has the block; reminder/thanks have no quote token yet, so nothing is left unresolved). All pre-existing `render` tests still pass.

- [ ] **Step 7: Lint + type-check**

Run: `uv run ruff check scripts/render_email_previews.py tests/render_email_previews_test.py && uv run ty check`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add scripts/render_email_previews.py tests/render_email_previews_test.py
git commit -m "feat: resolve email quote tokens from the rotating pool"
```

---

## Task 5: Quote block in `availability-reminder` templates

**Files:**
- Modify: `assets/emails/template/availability-reminder.html`
- Modify: `assets/emails/template/availability-reminder.txt`

- [ ] **Step 1: Add `.quote-text` to the Outlook serif style**

In `availability-reminder.html`, replace:

```css
    .serif, .paper-title, .count, .signoff-name { font-family: Georgia, "Times New Roman", serif !important; }
```

with:

```css
    .serif, .paper-title, .count, .signoff-name, .quote-text { font-family: Georgia, "Times New Roman", serif !important; }
```

- [ ] **Step 2: Insert the quote block before the footer**

In `availability-reminder.html`, replace:

```html
          <!-- ── Footer ── -->
```

with:

```html
          <!-- ── Closing quote (rotating women-in-STEM) ── -->
          <tr>
            <td class="pad-x" align="center" style="padding:26px 32px 0 32px;">
              <div style="margin:0 auto;width:36px;height:1px;background-color:#c8226d;line-height:0;font-size:0;">&nbsp;</div>
              <p class="quote-text serif" style="margin:14px auto 0;max-width:460px;font-family:Charter,'Iowan Old Style',Georgia,serif;font-style:italic;font-size:16.5px;line-height:1.5;letter-spacing:-0.005em;color:#1a1814;">
                &ldquo;{{ quote.text }}&rdquo;
              </p>
              <p style="margin:8px 0 0 0;font-family:'Geist',system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:12px;color:#6d6757;line-height:1.5;">
                &mdash; <span style="font-weight:600;color:#1a1814;">{{ quote.by }}</span>, <span style="font-weight:400;color:#8e8674;">{{ quote.role }}</span>
              </p>
            </td>
          </tr>

          <!-- ── Footer ── -->
```

- [ ] **Step 3: Insert the quote block in the plain-text version**

In `availability-reminder.txt`, replace:

```
{{ links.companionPreview }}

---
WiDS NYC AI Reading Group
```

with:

```
{{ links.companionPreview }}


"{{ quote.text }}"
— {{ quote.by }}, {{ quote.role }}

---
WiDS NYC AI Reading Group
```

- [ ] **Step 4: Add the presence test for this template**

Append to `tests/render_email_previews_test.py`:

```python
@pytest.mark.parametrize("ext", ["html", "txt"])
def test_availability_reminder_carries_quote_tokens(ext):
    text = (_TEMPLATES / f"availability-reminder.{ext}").read_text(encoding="utf-8")
    assert "{{ quote.text }}" in text
    assert "{{ quote.by }}" in text
    assert "{{ quote.role }}" in text
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `uv run pytest -c tests/pytest.ini tests/render_email_previews_test.py -k "availability_reminder or main" -v`
Expected: PASS (both html + txt, and `main()` still emits a fully-resolved reminder body).

- [ ] **Step 6: Commit**

```bash
git add assets/emails/template/availability-reminder.html assets/emails/template/availability-reminder.txt tests/render_email_previews_test.py
git commit -m "feat: add rotating quote block to availability-reminder email"
```

---

## Task 6: Quote block in `availability-thanks` templates

**Files:**
- Modify: `assets/emails/template/availability-thanks.html`
- Modify: `assets/emails/template/availability-thanks.txt`

- [ ] **Step 1: Document the optional tokens + add `.quote-text` to the Outlook serif style**

In `availability-thanks.html`, replace:

```
      links.companionPreview (fallback to literal "Preview link coming soon"
        — see Step 5b note in availability-chase.md)
  -->
```

with:

```
      links.companionPreview (fallback to literal "Preview link coming soon"
        — see Step 5b note in availability-chase.md),
      quote.text / quote.by / quote.role (fallback to seed Grace Hopper quote)
  -->
```

Then replace:

```css
    .serif, .paper-title, .signoff-name { font-family: Georgia, "Times New Roman", serif !important; }
```

with:

```css
    .serif, .paper-title, .signoff-name, .quote-text { font-family: Georgia, "Times New Roman", serif !important; }
```

- [ ] **Step 2: Insert the quote block before the footer**

In `availability-thanks.html`, replace:

```html
          <!-- ── Footer ── -->
```

with:

```html
          <!-- ── Closing quote (rotating women-in-STEM) ── -->
          <tr>
            <td class="pad-x" align="center" style="padding:26px 32px 0 32px;">
              <div style="margin:0 auto;width:36px;height:1px;background-color:#c8226d;line-height:0;font-size:0;">&nbsp;</div>
              <p class="quote-text serif" style="margin:14px auto 0;max-width:460px;font-family:Charter,'Iowan Old Style',Georgia,serif;font-style:italic;font-size:16.5px;line-height:1.5;letter-spacing:-0.005em;color:#1a1814;">
                &ldquo;{{ quote.text }}&rdquo;
              </p>
              <p style="margin:8px 0 0 0;font-family:'Geist',system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:12px;color:#6d6757;line-height:1.5;">
                &mdash; <span style="font-weight:600;color:#1a1814;">{{ quote.by }}</span>, <span style="font-weight:400;color:#8e8674;">{{ quote.role }}</span>
              </p>
            </td>
          </tr>

          <!-- ── Footer ── -->
```

- [ ] **Step 3: Insert the quote block in the plain-text version**

In `availability-thanks.txt`, replace:

```
{{ links.companionPreview }}

---
WiDS NYC AI Reading Group
```

with:

```
{{ links.companionPreview }}


"{{ quote.text }}"
— {{ quote.by }}, {{ quote.role }}

---
WiDS NYC AI Reading Group
```

- [ ] **Step 4: Add the presence test for this template**

Append to `tests/render_email_previews_test.py`:

```python
@pytest.mark.parametrize("ext", ["html", "txt"])
def test_availability_thanks_carries_quote_tokens(ext):
    text = (_TEMPLATES / f"availability-thanks.{ext}").read_text(encoding="utf-8")
    assert "{{ quote.text }}" in text
    assert "{{ quote.by }}" in text
    assert "{{ quote.role }}" in text
```

- [ ] **Step 5: Verify the full preview test suite passes**

Run: `uv run pytest -c tests/pytest.ini tests/render_email_previews_test.py -v`
Expected: PASS — presence tests for all three templates (rsvp, reminder, thanks) plus `test_preview_main_renders_three_emails_with_no_unresolved_quote` and all pre-existing `render` tests.

- [ ] **Step 6: Commit**

```bash
git add assets/emails/template/availability-thanks.html assets/emails/template/availability-thanks.txt tests/render_email_previews_test.py
git commit -m "feat: add rotating quote block to availability-thanks email"
```

---

## Task 7: TypeScript selector (`web/lib/quotes.ts`)

**Files:**
- Create: `web/lib/quotes.ts`
- Test: `web/lib/__tests__/quotes.test.ts`

(`web/lib/quotes.generated.json` already exists from Task 3.)

- [ ] **Step 1: Write the failing test**

Create `web/lib/__tests__/quotes.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { fnv1a, selectQuote, getQuoteOfDay, type QuoteBundle } from "../quotes";

const bundle: QuoteBundle = {
  version: 1,
  authors: ["q1", "q2", "q3", "q4", "q5"].map((id) => ({
    author: { id: `a-${id}`, name: `Name ${id}`, role: "Role" },
    quotes: [{ id, text: `T ${id}`, verified: true, sourceUrl: "https://x" }],
  })),
};

describe("fnv1a", () => {
  it("matches canonical 32-bit vectors (agrees with scripts/quotes.py)", () => {
    expect(fnv1a("")).toBe(0x811c9dc5);
    expect(fnv1a("a")).toBe(0xe40c292c);
    expect(fnv1a("foobar")).toBe(0xbf9cf968);
  });
});

describe("selectQuote", () => {
  it("is deterministic for a given date key", () => {
    expect(selectQuote(42, "", bundle).quote.id).toBe(selectQuote(42, "", bundle).quote.id);
  });

  it("scatters deterministically across the pool", () => {
    const chosen = new Set<string>();
    for (let k = 0; k < 200; k++) chosen.add(selectQuote(k, "", bundle).quote.id);
    expect(chosen.size).toBeGreaterThanOrEqual(2);
  });

  it("only returns verified quotes", () => {
    const mixed: QuoteBundle = {
      version: 1,
      authors: [
        { author: { id: "a1", name: "A1", role: "R" }, quotes: [{ id: "u", text: "x", verified: false }] },
        { author: { id: "a2", name: "A2", role: "R" }, quotes: [{ id: "v", text: "y", verified: true, sourceUrl: "https://x" }] },
      ],
    };
    for (let k = 0; k < 20; k++) expect(selectQuote(k, "", mixed).quote.id).toBe("v");
  });

  it("falls back when no verified quotes exist", () => {
    expect(selectQuote(3, "", { version: 1, authors: [] }).author.id).toBe("grace-hopper");
  });
});

describe("getQuoteOfDay", () => {
  it("returns a real quote from the committed bundle", () => {
    const sel = getQuoteOfDay(new Date("2026-06-13T12:00:00Z"));
    expect(sel.quote.text.length).toBeGreaterThan(0);
    expect(sel.author.name.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm run test -- quotes`
Expected: FAIL — cannot resolve `../quotes`.

- [ ] **Step 3: Write minimal implementation**

Create `web/lib/quotes.ts`:

```ts
// Rotating women-in-STEM quote selection (shared spec, TypeScript side).
// Mirrors scripts/quotes.py — keep in sync. The fnv1a vectors pin the algorithm.
import bundleData from "./quotes.generated.json";

export interface QuoteAuthor {
  id: string;
  name: string;
  role: string;
  birthdate?: string;
  deathdate?: string;
  fields?: string[];
  notable_contributions?: string;
  wikipediaUrl?: string;
}

export interface Quote {
  id: string;
  text: string;
  verified: boolean;
  year?: number | null;
  source?: string;
  sourceUrl?: string;
}

export interface QuoteBundle {
  version: number;
  authors: { author: QuoteAuthor; quotes: Quote[] }[];
}

export interface Selection {
  author: QuoteAuthor;
  quote: Quote;
}

const BUNDLE = bundleData as QuoteBundle;

const FALLBACK: Selection = {
  author: {
    id: "grace-hopper",
    name: "Grace Hopper",
    role: "Computer scientist · US Navy rear admiral",
  },
  quote: {
    id: "hopper-always-done",
    text: "The most dangerous phrase in the language is, 'we've always done it this way.'",
    verified: true,
  },
};

export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function eligiblePairs(bundle: QuoteBundle = BUNDLE): Selection[] {
  const pairs: Selection[] = [];
  for (const entry of bundle.authors) {
    for (const quote of entry.quotes) {
      if (quote.verified) pairs.push({ author: entry.author, quote });
    }
  }
  pairs.sort((a, b) => (a.quote.id < b.quote.id ? -1 : a.quote.id > b.quote.id ? 1 : 0));
  return pairs;
}

export function selectQuote(dateKey: number, salt = "", bundle: QuoteBundle = BUNDLE): Selection {
  const pairs = eligiblePairs(bundle);
  if (pairs.length === 0) return FALLBACK;
  return pairs[fnv1a(`${dateKey}${salt}`) % pairs.length];
}

export function dayKey(now: Date = new Date()): number {
  return Math.floor(now.getTime() / 86_400_000);
}

export function getQuoteOfDay(now: Date = new Date()): Selection {
  return selectQuote(dayKey(now));
}
```

> `resolveJsonModule` is enabled in `web/tsconfig.json`, so `import bundleData from "./quotes.generated.json"` works. If `tsc` reports the `as QuoteBundle` cast "may be a mistake" (the inferred JSON literal type being too narrow), change that one line to `const BUNDLE = bundleData as unknown as QuoteBundle;`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npm run test -- quotes`
Expected: PASS.

- [ ] **Step 5: Type-check + lint**

Run: `cd web && npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add web/lib/quotes.ts web/lib/__tests__/quotes.test.ts
git commit -m "feat: women-in-STEM quote selector (typescript)"
```

---

## Task 8: Dashboard `QuoteCard`

**Files:**
- Create: `web/components/QuoteCard.tsx`
- Test: `web/components/__tests__/QuoteCard.test.tsx`
- Modify: `web/app/dashboard/page.tsx`

- [ ] **Step 1: Write the failing test**

Create `web/components/__tests__/QuoteCard.test.tsx`:

```tsx
/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { QuoteCard } from "../QuoteCard";

afterEach(cleanup);

describe("QuoteCard", () => {
  it("renders a labelled quote-of-the-day region", () => {
    render(<QuoteCard />);
    expect(screen.getByRole("region", { name: /quote of the day/i })).toBeInTheDocument();
  });

  it("shows a non-empty quote wrapped in curly quotes and an author name", () => {
    const { container } = render(<QuoteCard />);
    const text = container.textContent ?? "";
    expect(text).toContain("“"); // left double quote
    expect(text).toContain("”"); // right double quote
    expect(text.length).toBeGreaterThan(20);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm run test -- QuoteCard`
Expected: FAIL — cannot resolve `../QuoteCard`.

- [ ] **Step 3: Write minimal implementation**

Create `web/components/QuoteCard.tsx`:

```tsx
import { getQuoteOfDay } from "@/lib/quotes";

/**
 * Quote of the day — a rotating quote from a legacy woman in STEM.
 * Server component: the selection is deterministic per calendar day and reads
 * the committed bundle (web/lib/quotes.generated.json) via @/lib/quotes.
 */
export function QuoteCard() {
  const { author, quote } = getQuoteOfDay();
  return (
    <section
      className="card"
      aria-label="Quote of the day"
      style={{ display: "flex", flexDirection: "column", gap: 6 }}
    >
      <div
        style={{
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "0.12em",
          color: "var(--color-paper-600)",
        }}
      >
        Quote of the day
      </div>
      <p
        style={{
          margin: 0,
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: 18,
          lineHeight: 1.5,
          color: "var(--color-paper-900)",
        }}
      >
        {"“"}
        {quote.text}
        {"”"}
      </p>
      <p style={{ margin: 0, fontSize: 13, color: "var(--color-paper-700)" }}>
        — <b>{author.name}</b>, {author.role}
      </p>
      {author.notable_contributions && (
        <p style={{ margin: 0, fontSize: 12, color: "var(--color-paper-600)" }}>
          {author.notable_contributions}
        </p>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npm run test -- QuoteCard`
Expected: PASS.

- [ ] **Step 5: Mount it on the dashboard (below the next-meeting card)**

In `web/app/dashboard/page.tsx`, after the line:

```tsx
import { NextMeetingCard, type AvailabilityStatus } from "@/components/NextMeetingCard";
```

add:

```tsx
import { QuoteCard } from "@/components/QuoteCard";
```

Then replace:

```tsx
        <NextMeetingCard
          meeting={meeting}
          myRsvp={rsvp}
          availabilityStatus={availabilityStatus}
          prepMeetingId={prepMeeting?.id ?? null}
        />

        {meeting?.companion_url && (
```

with:

```tsx
        <NextMeetingCard
          meeting={meeting}
          myRsvp={rsvp}
          availabilityStatus={availabilityStatus}
          prepMeetingId={prepMeeting?.id ?? null}
        />

        <QuoteCard />

        {meeting?.companion_url && (
```

- [ ] **Step 6: Type-check, lint, and run the full web suite**

Run: `cd web && npm run typecheck && npm run lint && npm run test`
Expected: no errors; all tests pass.

- [ ] **Step 7: Commit**

```bash
git add web/components/QuoteCard.tsx web/components/__tests__/QuoteCard.test.tsx web/app/dashboard/page.tsx
git commit -m "feat: add rotating quote-of-the-day card to dashboard"
```

---

## Task 9: Scheduled-task + docs wiring

**Files:**
- Modify: `scheduled_tasks/availability-chase.md`
- Modify: `scheduled_tasks/pre-meeting-reminder.md`
- Modify: `docs/email-quotes.md`

- [ ] **Step 1: availability-chase Step 5b — add the quote-resolution config bullet**

In `scheduled_tasks/availability-chase.md`, replace:

```
- `stats.submittedCountWord` — `stats.submittedCount` spelled out in English title-case (`One`, `Two`, …, `Nine`, then fallback to the digit string for ≥10). Used in the bold `<strong>… of us</strong>` line.
```

with:

```
- `stats.submittedCountWord` — `stats.submittedCount` spelled out in English title-case (`One`, `Two`, …, `Nine`, then fallback to the digit string for ≥10). Used in the bold `<strong>… of us</strong>` line.
- `quote.text` / `quote.by` / `quote.role` — a rotating women-in-STEM quote resolved via `scripts/quotes.py`: set `date_key` = whole days since 1970-01-01 UTC for the send date, then `quote_tokens(select_quote(load_bundle(), date_key))`. Optional with a built-in fallback (seed Grace Hopper quote), so an empty/missing pool never blocks a send. Used by BOTH buckets (reminder 5c, thank-you 5e).
```

- [ ] **Step 2: availability-chase Step 5c — add quote rows to the reminder merge-field table**

Replace:

```
   | `{{ operator.displayName }}` | static / config | |

   Tokens removed in v2 (do NOT use): `paper.arxivId`, `paper.arxivUrl`,
```

with:

```
   | `{{ operator.displayName }}` | static / config | |
   | `{{ quote.text }}` | rotating pool via `scripts/quotes.py` (Step 5b) | optional — fallback Grace Hopper |
   | `{{ quote.by }}` | author name from the same selection | optional |
   | `{{ quote.role }}` | author role from the same selection | optional |

   Tokens removed in v2 (do NOT use): `paper.arxivId`, `paper.arxivUrl`,
```

- [ ] **Step 3: availability-chase Step 5e — repoint the quote row at the pool**

Replace:

```
   | `{{ quote.text }}` / `{{ quote.by }}` / `{{ quote.role }}` | rotated pool (women-in-STEM) | both | optional — fall back to Mirzakhani |
```

with:

```
   | `{{ quote.text }}` / `{{ quote.by }}` / `{{ quote.role }}` | rotating pool via `scripts/quotes.py` (Step 5b) | both | optional — fallback Grace Hopper |
```

- [ ] **Step 4: pre-meeting-reminder Step 4a — repoint the rotated quote tokens**

In `scheduled_tasks/pre-meeting-reminder.md`, replace:

```
Rotated tokens (`haiku.line1/2/3`, `quote.text`, `quote.by`, `quote.role`)
follow the rotation pool in this template's README. If rotation isn't
wired yet, ship `haiku[0]` and the Mirzakhani quote — both are documented
as the defaults in the design handoff.
```

with:

```
Rotated tokens: `haiku.line1/2/3` still follow the haiku pool in this
template's README. `quote.text` / `quote.by` / `quote.role` are resolved from
the women-in-STEM pool via `scripts/quotes.py` — set `date_key` = whole days
since 1970-01-01 UTC for the send date, then
`quote_tokens(select_quote(load_bundle(), date_key))`. Optional with a built-in
fallback (seed Grace Hopper quote).
```

- [ ] **Step 5: pre-meeting-reminder Step 4b — note + inline quote lines**

Replace:

```
## Step 4b — Send plain reminder (tentative + no_response bucket, and all admin meetings)

For admin meeting:
```

with:

```
## Step 4b — Send plain reminder (tentative + no_response bucket, and all admin meetings)

Resolve a rotating quote the same way as Step 4a (`scripts/quotes.py`, `date_key`
= whole days since 1970-01-01 UTC for the send date) and append it as the two
plain-text lines shown at the end of each body. If the pool is empty the
built-in fallback is used, so the lines always render.

For admin meeting:
```

Then, in the admin-meeting body, replace this single line (it stays inside the existing fenced block — do **not** touch the surrounding ``` fences):

old:
`If you can't make it, decline the calendar invite so we know.`

new (three lines):
```
If you can't make it, decline the calendar invite so we know.

— "<quote.text>" — <quote.by>, <quote.role>
```

Then, in the reading-group body, replace this single line (likewise leave the fences untouched):

old:
`If you haven't received the discussion guide yet, ask <leader_name>.`

new (three lines):
```
If you haven't received the discussion guide yet, ask <leader_name>.

— "<quote.text>" — <quote.by>, <quote.role>
```

> The `<quote.text>` / `<quote.by>` / `<quote.role>` angle-bracket form matches this file's existing placeholder convention (`<name>`, `<scheduled_at>`); the agent substitutes them at send time from the Step-4a selection.

- [ ] **Step 6: docs/email-quotes.md — point at the machine-readable pool**

In `docs/email-quotes.md`, replace:

```
Suggested cadence: once a month, or whenever the current quote feels
stale to the operator.
```

with:

```
Suggested cadence: once a month, or whenever the current quote feels
stale to the operator.

## Machine-readable pool (availability + reminder emails)

The availability-reminder, availability-thanks, rsvp-confirmation, and
pre-meeting reminder emails draw their quote from a structured, verified pool
under `data/quotes/<author-slug>/` (one folder per person: `author.json` plus
dated `YYYYMMDD_quotes.json` snapshots, with a `quotes.json` symlink for
humans). `scripts/build_quotes.py` validates sourcing and emits the committed
bundle `web/lib/quotes.generated.json`; `scripts/quotes.py` (emails) and
`web/lib/quotes.ts` (dashboard) select from it. Only quotes marked
`verified: true` with a `sourceUrl` are eligible — the build fails CI otherwise.

The rest of this document is the **magic-link** email's manual rotation, which
is Supabase-static and intentionally separate from the pool above.
```

- [ ] **Step 7: Commit**

```bash
git add scheduled_tasks/availability-chase.md scheduled_tasks/pre-meeting-reminder.md docs/email-quotes.md
git commit -m "docs: wire scheduled tasks + email-quotes doc to the quote pool"
```

---

## Task 10: CI wiring + full-suite verification

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Add the two new Python test files to CI**

In `.github/workflows/ci.yml`, replace:

```yaml
          uv run pytest -c tests/pytest.ini -v \
            tests/find_paper_suggest_test.py \
            tests/zotero_push_test.py \
            tests/build_arxiv_taxonomy_test.py \
            tests/render_email_previews_test.py
```

with:

```yaml
          uv run pytest -c tests/pytest.ini -v \
            tests/find_paper_suggest_test.py \
            tests/zotero_push_test.py \
            tests/build_arxiv_taxonomy_test.py \
            tests/render_email_previews_test.py \
            tests/quotes_select_test.py \
            tests/build_quotes_test.py
```

- [ ] **Step 2: Run the full Python gate exactly as CI does**

Run:
```bash
uv run ruff check scripts tests
uv run ty check
uv run pytest -c tests/pytest.ini -v \
  tests/find_paper_suggest_test.py \
  tests/zotero_push_test.py \
  tests/build_arxiv_taxonomy_test.py \
  tests/render_email_previews_test.py \
  tests/quotes_select_test.py \
  tests/build_quotes_test.py
```
Expected: ruff clean, ty clean, all tests PASS.

- [ ] **Step 3: Run the full web gate exactly as CI does**

Run: `cd web && npm run lint && npm run typecheck && npm run test`
Expected: clean lint, clean types, all tests pass (including `quotes` and `QuoteCard`).

- [ ] **Step 4: Confirm the bundle is in sync (no uncommitted regeneration)**

Run: `uv run python scripts/build_quotes.py && git status --porcelain web/lib/quotes.generated.json data/quotes`
Expected: build prints the author/quote counts; `git status` shows **no** changes (bundle + symlinks already committed and in sync).

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: run the quote selector and build test suites"
```

---

## Spec coverage check

- **Per-author folders + dated snapshots + symlink** → Tasks 2–3.
- **Build validates sourcing, emits drift-guarded bundle, refreshes symlink** → Tasks 2, 3, 10 (Step 4).
- **Date-seeded FNV-1a selector, no back-to-back, fallback, verified-only** → Tasks 1 (Python), 7 (TS).
- **Quote block in availability-reminder + availability-thanks; rsvp-confirmation standardized onto the pool** → Tasks 5, 6, 4 (render).
- **Inline plaintext quote line in pre-meeting Step 4b; Step 4a/Step 5 repointed** → Task 9.
- **Dashboard QuoteCard (quote-of-the-day)** → Task 8.
- **Tests: Python selection/build/drift/sourcing; TS selector + component; email-token presence** → Tasks 1, 2, 3, 4, 7, 8.
- **CI guards (new Python files; bundle drift)** → Task 10.
- **docs/email-quotes.md points at the pool** → Task 9.
