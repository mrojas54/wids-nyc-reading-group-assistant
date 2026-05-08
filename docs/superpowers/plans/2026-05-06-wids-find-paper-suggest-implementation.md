# `/wids-find-paper suggest` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fourth sub-mode `/wids-find-paper suggest` that surfaces ranked candidate papers from Semantic Scholar based on similarity to past readings, plus a topic auto-tagging step that fires when `/wids-find-paper pick` commits a paper.

**Architecture:** Path Z — Semantic Scholar Recommendations API does candidate sourcing + ranking; MMR (λ=0.6) computed locally for output diversity; SPECTER2 cosine computed locally for display rationale only. New `paper_embeddings` table (pgvector) caches past-paper embeddings. The skill markdown owns all DB I/O via the Supabase MCP. A new Python helper (`scripts/find_paper_suggest.py`) is a pure JSON-in/JSON-out transformer doing the HTTP calls and math.

**Tech Stack:** PostgreSQL + pgvector, Python (httpx, numpy, pydantic, tenacity, respx + pytest for tests), Semantic Scholar Graph + Recommendations APIs, Anthropic Claude (in-skill, no SDK in helper), Supabase MCP, the project's slash-command framework.

**Source spec:** [`docs/superpowers/specs/2026-05-06-wids-find-paper-suggest-design.md`](../specs/2026-05-06-wids-find-paper-suggest-design.md). When in doubt, the spec is authoritative.

**Companion spec (not in this plan):** `docs/superpowers/specs/2026-05-06-wids-backfill-paper-topics-design.md` — one-time backfill of `paper_topics` for the 18 historical readings. Will get its own plan after this work lands.

---

## File structure

### New files

- `migrations/010_paper_embeddings.sql` — pgvector extension + `paper_embeddings` table + grants
- `scripts/find_paper_suggest.py` — Python helper, ~200 LOC: pydantic models, pure helpers, async SS API calls, MMR, orchestration
- `tests/find_paper_suggest_test.py` — pytest unit + HTTP-mocked tests for the helper
- `tests/pick_topic_tagging_test.sql` — psql test for the `pick` extension's INSERT pattern

### Modified files

- `.claude/commands/wids-find-paper.md`
  - Add `suggest` to the `argument-hint` frontmatter (line 3)
  - Add the entire `## Step 5 — Sub-mode: suggest` section (after Step 4)
  - Add new sub-step `### 4d.5 — Auto-tag with topics` to existing Step 4 (`pick` sub-mode)
  - Update Step 4e (audit log) summary string to include the tagging info

### Convention notes

- Test files are named `<module>_test.py` (matches `tests/zotero_push_test.py`), not `test_<module>.py`.
- `tests/conftest.py` already adds repo root to `sys.path`, so `from scripts.find_paper_suggest import ...` works in tests.
- Tests run via `uv run --with pytest --with <deps> pytest tests/<file>_test.py -v` (matches the docstring pattern in `tests/zotero_push_test.py`).
- Migrations use `BEGIN; ... COMMIT;` pattern (matches existing migrations).

---

## Task 1: Migration 010 — `paper_embeddings` table

**Files:**
- Create: `migrations/010_paper_embeddings.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- migrations/010_paper_embeddings.sql
--
-- Adds pgvector extension and a paper_embeddings table to cache embeddings
-- per (paper, model). Currently consumed only by /wids-find-paper suggest
-- (model='specter_v2'). Multi-model future-proofed via the model column.

BEGIN;

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE paper_embeddings (
  paper_id   INT  NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  model      TEXT NOT NULL,
  vector     vector NOT NULL,
  cached_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (paper_id, model)
);

COMMENT ON TABLE paper_embeddings IS
  'Cached embeddings for papers, keyed by (paper, model). Model identifiers '
  'mirror the source API field names — e.g., ''specter_v2'' matches the '
  'Semantic Scholar Graph API field embedding.specter_v2.';

COMMENT ON COLUMN paper_embeddings.vector IS
  'Embedding vector. Dimension is model-dependent: 768 for specter_v2. '
  'Column is intentionally not dimension-constrained so additional models '
  '(e.g., voyage_4 at 1024) can coexist without a schema change. If/when '
  'we add ANN indexes, they go in as partial indexes per-model.';

GRANT SELECT ON paper_embeddings TO authenticated, anon;

COMMIT;
```

- [ ] **Step 2: Apply the migration via the Supabase MCP**

Use the Supabase MCP `apply_migration` tool with `name='010_paper_embeddings'` and the SQL body from Step 1. Migrations are tracked by Supabase; the project ID is in `MEMORY.md` under "Supabase project + GitHub repo."

Expected: success, no errors. If pgvector is not yet enabled, this is the first SQL that activates it; Supabase free/pro tiers ship pgvector available.

- [ ] **Step 3: Verify the migration landed**

Run via the Supabase MCP `execute_sql` tool:

```sql
SELECT extname FROM pg_extension WHERE extname = 'vector';
SELECT column_name, data_type, udt_name
FROM information_schema.columns
WHERE table_name = 'paper_embeddings'
ORDER BY ordinal_position;
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_name = 'paper_embeddings'
ORDER BY grantee, privilege_type;
```

Expected output (rows):
- pg_extension: 1 row (`vector`)
- columns: 4 rows in order — `paper_id` (integer), `model` (text), `vector` (USER-DEFINED, udt_name=`vector`), `cached_at` (timestamp with time zone)
- grants: SELECT for `anon` and `authenticated`

- [ ] **Step 4: Commit**

```bash
git add migrations/010_paper_embeddings.sql
git commit -m "feat(db): add paper_embeddings table with pgvector

Cache table for embeddings keyed by (paper_id, model). Used initially
by /wids-find-paper suggest with model='specter_v2'; designed to support
additional embedders (e.g., voyage_4) without schema change via the
intentionally-untyped vector column.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Helper scaffolding — module skeleton, pydantic models, smoke test

**Files:**
- Create: `scripts/find_paper_suggest.py`
- Create: `tests/find_paper_suggest_test.py`

- [ ] **Step 1: Write the failing import + model round-trip tests**

Create `tests/find_paper_suggest_test.py`:

```python
"""Tests for scripts/find_paper_suggest.py.

Run via:
    uv run --with pytest --with respx --with httpx --with numpy \\
        --with pydantic --with tenacity \\
        pytest tests/find_paper_suggest_test.py -v
"""
from __future__ import annotations

import json

import pytest


def test_module_imports():
    """Smoke test: the script's main entry is importable."""
    from scripts.find_paper_suggest import main
    assert callable(main)


def test_input_model_round_trip():
    from scripts.find_paper_suggest import Input
    payload = {
        "past_papers": [
            {"paper_id": 12, "s2_paper_id": "ARXIV:1706.03762", "title": "Attention"},
        ],
        "cached_embeddings": {"12": [0.1, 0.2, 0.3]},
        "top": 5,
        "limit": 30,
    }
    inp = Input.model_validate(payload)
    assert inp.top == 5
    assert inp.limit == 30
    assert len(inp.past_papers) == 1
    assert inp.past_papers[0].s2_paper_id == "ARXIV:1706.03762"
    assert inp.cached_embeddings["12"] == [0.1, 0.2, 0.3]


def test_input_defaults():
    from scripts.find_paper_suggest import Input
    payload = {"past_papers": [], "cached_embeddings": {}}
    inp = Input.model_validate(payload)
    assert inp.top == 10
    assert inp.limit == 50


def test_output_model_round_trip():
    from scripts.find_paper_suggest import Candidate, EmbeddingToCache, Output
    output = Output(
        candidates=[
            Candidate(
                arxiv_id="2604.12345",
                s2_paper_id="ARXIV:2604.12345",
                title="Test",
                abstract="abs",
                authors=["Alice"],
                year=2026,
                matched_past_paper_id=12,
                matched_past_paper_title="Attention",
                cosine=0.84,
            ),
        ],
        embeddings_to_cache=[
            EmbeddingToCache(paper_id=12, model="specter_v2", vector=[0.1, 0.2]),
        ],
        warnings=["test warning"],
    )
    serialized = output.model_dump_json()
    parsed = json.loads(serialized)
    assert parsed["candidates"][0]["cosine"] == 0.84
    assert parsed["embeddings_to_cache"][0]["model"] == "specter_v2"
    assert parsed["warnings"] == ["test warning"]
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
uv run --with pytest --with respx --with httpx --with numpy --with pydantic --with tenacity \
    pytest tests/find_paper_suggest_test.py -v
```

Expected: FAIL — `ModuleNotFoundError: No module named 'scripts.find_paper_suggest'`

- [ ] **Step 3: Write the minimal scaffolding**

Create `scripts/find_paper_suggest.py`:

```python
"""Helper for /wids-find-paper suggest sub-mode.

Reads JSON from stdin, calls Semantic Scholar APIs, computes MMR-diverse
top-N candidates with display rationale, emits JSON to stdout.

See: docs/superpowers/specs/2026-05-06-wids-find-paper-suggest-design.md
"""
from __future__ import annotations

from pydantic import BaseModel


class PastPaper(BaseModel):
    paper_id: int
    s2_paper_id: str  # e.g., "ARXIV:1706.03762" or "DOI:10.1080/..."
    title: str


class Input(BaseModel):
    past_papers: list[PastPaper]
    cached_embeddings: dict[str, list[float]]  # str(paper_id) -> vector
    top: int = 10
    limit: int = 50


class EmbeddingToCache(BaseModel):
    paper_id: int
    model: str
    vector: list[float]


class Candidate(BaseModel):
    arxiv_id: str | None = None
    s2_paper_id: str
    title: str
    abstract: str = ""
    authors: list[str] = []
    year: int | None = None
    matched_past_paper_id: int | None = None
    matched_past_paper_title: str | None = None
    cosine: float | None = None


class Output(BaseModel):
    candidates: list[Candidate]
    embeddings_to_cache: list[EmbeddingToCache]
    warnings: list[str]


async def main() -> int:
    """Stub. Real implementation lands in Task 9."""
    return 0


if __name__ == "__main__":
    import asyncio
    raise SystemExit(asyncio.run(main()))
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
uv run --with pytest --with respx --with httpx --with numpy --with pydantic --with tenacity \
    pytest tests/find_paper_suggest_test.py -v
```

Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/find_paper_suggest.py tests/find_paper_suggest_test.py
git commit -m "feat(scripts): scaffold find_paper_suggest with pydantic models

Adds the module skeleton, Input/Candidate/EmbeddingToCache/Output models,
and round-trip tests. main() is a stub; real orchestration lands in a
later task.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Pure helpers — URL parsing (`extract_arxiv_id`, `extract_doi_from_url`, `to_s2_paper_id`)

**Files:**
- Modify: `scripts/find_paper_suggest.py` (add helpers near top, after pydantic models)
- Modify: `tests/find_paper_suggest_test.py` (add tests)

- [ ] **Step 1: Write failing tests**

Append to `tests/find_paper_suggest_test.py`:

```python
# ---------------------- URL parsing ----------------------

@pytest.mark.parametrize("url, expected", [
    # Modern arXiv abs
    ("https://arxiv.org/abs/2104.05234", "2104.05234"),
    # PDF URL
    ("https://arxiv.org/pdf/2104.05234", "2104.05234"),
    ("https://arxiv.org/pdf/2104.05234.pdf", "2104.05234"),
    # Version suffix gets stripped
    ("https://arxiv.org/abs/2104.05234v3", "2104.05234"),
    ("https://arxiv.org/pdf/2104.05234v1.pdf", "2104.05234"),
    # 5-digit suffix
    ("https://arxiv.org/abs/2510.07192", "2510.07192"),
    # Older 4-digit suffix
    ("https://arxiv.org/abs/1003.0146", "1003.0146"),
    # Non-arXiv URLs
    ("https://www.nature.com/articles/s41586-024-08025-4", None),
    ("https://example.com/pdf", None),
    ("", None),
])
def test_extract_arxiv_id(url, expected):
    from scripts.find_paper_suggest import extract_arxiv_id
    assert extract_arxiv_id(url) == expected


@pytest.mark.parametrize("url, expected", [
    # Tandfonline embeds the full DOI
    ("https://www.tandfonline.com/doi/epdf/10.1080/26939169.2023.2276446?needAccess=true",
     "10.1080/26939169.2023.2276446"),
    # Doi.org
    ("https://doi.org/10.1038/s41586-024-08025-4", "10.1038/s41586-024-08025-4"),
    # Nature URL with article ID (no DOI prefix in URL)
    ("https://www.nature.com/articles/s41586-024-08025-4", None),
    # Random PDF
    ("https://www.cs.usfca.edu/~mmalensek/publications/shah2018scalable.pdf", None),
    # arXiv URL — DOI extractor returns None (arxiv extractor handles it)
    ("https://arxiv.org/abs/1706.03762", None),
    ("", None),
])
def test_extract_doi_from_url(url, expected):
    from scripts.find_paper_suggest import extract_doi_from_url
    assert extract_doi_from_url(url) == expected


@pytest.mark.parametrize("url, expected", [
    ("https://arxiv.org/abs/1706.03762", "ARXIV:1706.03762"),
    ("https://www.tandfonline.com/doi/epdf/10.1080/26939169.2023.2276446",
     "DOI:10.1080/26939169.2023.2276446"),
    # Unresolvable
    ("https://www.cs.usfca.edu/~mmalensek/publications/shah2018scalable.pdf", None),
    ("https://www.nature.com/articles/s41586-024-08025-4", None),
])
def test_to_s2_paper_id(url, expected):
    from scripts.find_paper_suggest import to_s2_paper_id
    assert to_s2_paper_id(url) == expected
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
uv run --with pytest --with respx --with httpx --with numpy --with pydantic --with tenacity \
    pytest tests/find_paper_suggest_test.py::test_extract_arxiv_id \
           tests/find_paper_suggest_test.py::test_extract_doi_from_url \
           tests/find_paper_suggest_test.py::test_to_s2_paper_id -v
```

Expected: FAIL with `ImportError` for the three helpers.

- [ ] **Step 3: Implement the helpers**

In `scripts/find_paper_suggest.py`, add after the pydantic models and before `async def main`:

```python
import re

_ARXIV_RE = re.compile(
    r"arxiv\.org/(?:abs|pdf)/([0-9]{4}\.[0-9]{4,5})(?:v\d+)?(?:\.pdf)?",
    re.IGNORECASE,
)

# Match a DOI: must start with "10." then 4-9 digits, slash, suffix.
_DOI_RE = re.compile(r"\b(10\.\d{4,9}/[^\s/?#]+)", re.IGNORECASE)


def extract_arxiv_id(url: str) -> str | None:
    """Extract a modern arXiv ID (e.g., '2104.05234') from an arXiv URL.

    Handles /abs/ and /pdf/ paths, version suffixes (v1, v2, ...), and
    .pdf extensions. Returns None for non-arXiv URLs or empty input.
    """
    if not url:
        return None
    m = _ARXIV_RE.search(url)
    return m.group(1) if m else None


def extract_doi_from_url(url: str) -> str | None:
    """Extract a DOI of the form '10.NNNN/<suffix>' from a URL.

    Catches Tandfonline-style URLs that embed the full DOI in the path.
    Returns None for URLs that don't contain a literal DOI string —
    notably Nature URLs of the form nature.com/articles/<article-id>
    (where the '10.1038/' prefix is implicit, not in the URL).
    """
    if not url:
        return None
    m = _DOI_RE.search(url)
    return m.group(1) if m else None


def to_s2_paper_id(url: str) -> str | None:
    """Convert a paper URL to a Semantic Scholar paper identifier.

    Returns 'ARXIV:<id>' if the URL is an arXiv URL, 'DOI:<doi>' if a
    DOI is extractable from the URL, or None if neither.
    """
    arxiv_id = extract_arxiv_id(url)
    if arxiv_id:
        return f"ARXIV:{arxiv_id}"
    doi = extract_doi_from_url(url)
    if doi:
        return f"DOI:{doi}"
    return None
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
uv run --with pytest --with respx --with httpx --with numpy --with pydantic --with tenacity \
    pytest tests/find_paper_suggest_test.py -v
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/find_paper_suggest.py tests/find_paper_suggest_test.py
git commit -m "feat(scripts): URL → S2 paper ID resolution helpers

extract_arxiv_id, extract_doi_from_url, to_s2_paper_id. Handles arXiv
abs/pdf URLs with version suffixes and Tandfonline-style URLs that
embed full DOIs. Nature article-ID URLs are intentionally unresolvable
(DOI prefix implicit, not in URL); see spec section 5.4.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Pure helpers — vector math (`cosine`, `max_cosine_match`)

**Files:**
- Modify: `scripts/find_paper_suggest.py`
- Modify: `tests/find_paper_suggest_test.py`

- [ ] **Step 1: Write failing tests**

Append to `tests/find_paper_suggest_test.py`:

```python
# ---------------------- Vector math ----------------------

import math

import numpy as np


def test_cosine_identical():
    from scripts.find_paper_suggest import cosine
    a = np.array([1.0, 2.0, 3.0])
    assert math.isclose(cosine(a, a), 1.0, abs_tol=1e-9)


def test_cosine_orthogonal():
    from scripts.find_paper_suggest import cosine
    a = np.array([1.0, 0.0])
    b = np.array([0.0, 1.0])
    assert math.isclose(cosine(a, b), 0.0, abs_tol=1e-9)


def test_cosine_opposite():
    from scripts.find_paper_suggest import cosine
    a = np.array([1.0, 0.0])
    b = np.array([-1.0, 0.0])
    assert math.isclose(cosine(a, b), -1.0, abs_tol=1e-9)


def test_cosine_zero_vector_is_zero():
    """Zero-norm guard: avoid NaN, return 0.0."""
    from scripts.find_paper_suggest import cosine
    a = np.array([0.0, 0.0, 0.0])
    b = np.array([1.0, 2.0, 3.0])
    assert cosine(a, b) == 0.0
    assert cosine(b, a) == 0.0


def test_max_cosine_match_returns_best():
    from scripts.find_paper_suggest import max_cosine_match
    cand = np.array([1.0, 0.0])
    past = {
        10: np.array([1.0, 0.0]),       # cosine 1.0
        20: np.array([0.5, 0.5]),       # cosine ~0.707
        30: np.array([0.0, 1.0]),       # cosine 0.0
    }
    pid, score = max_cosine_match(cand, past)
    assert pid == 10
    assert math.isclose(score, 1.0, abs_tol=1e-9)


def test_max_cosine_match_empty_corpus():
    from scripts.find_paper_suggest import max_cosine_match
    pid, score = max_cosine_match(np.array([1.0, 0.0]), {})
    assert pid is None
    assert score == 0.0


def test_max_cosine_match_single():
    from scripts.find_paper_suggest import max_cosine_match
    cand = np.array([1.0, 0.0])
    pid, score = max_cosine_match(cand, {42: np.array([0.0, 1.0])})
    assert pid == 42
    assert math.isclose(score, 0.0, abs_tol=1e-9)
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
uv run --with pytest --with respx --with httpx --with numpy --with pydantic --with tenacity \
    pytest tests/find_paper_suggest_test.py -v
```

Expected: 7 new tests FAIL (ImportError on `cosine`, `max_cosine_match`).

- [ ] **Step 3: Implement the math helpers**

In `scripts/find_paper_suggest.py`, add after the URL helpers and before `async def main`:

```python
import numpy as np


def cosine(a: np.ndarray, b: np.ndarray) -> float:
    """Cosine similarity between two vectors.

    Returns 0.0 if either vector has zero norm (defensive guard against NaN).
    """
    norm_a = float(np.linalg.norm(a))
    norm_b = float(np.linalg.norm(b))
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return float(np.dot(a, b) / (norm_a * norm_b))


def max_cosine_match(
    cand_vec: np.ndarray,
    past_vecs: dict[int, np.ndarray],
) -> tuple[int | None, float]:
    """Find the past paper most similar to `cand_vec` and return its
    (paper_id, cosine_score). Returns (None, 0.0) when past_vecs is empty.
    """
    if not past_vecs:
        return (None, 0.0)
    best_id: int | None = None
    best_score = -float("inf")
    for pid, pvec in past_vecs.items():
        score = cosine(cand_vec, pvec)
        if score > best_score:
            best_id = pid
            best_score = score
    return (best_id, best_score)
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
uv run --with pytest --with respx --with httpx --with numpy --with pydantic --with tenacity \
    pytest tests/find_paper_suggest_test.py -v
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/find_paper_suggest.py tests/find_paper_suggest_test.py
git commit -m "feat(scripts): cosine and max_cosine_match helpers

Pure-numpy implementations with zero-norm guards. max_cosine_match
returns (paper_id, score) of the closest past paper, used for the
suggest output rationale display.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Pure helper — MMR diversity selection (`mmr_select`)

**Files:**
- Modify: `scripts/find_paper_suggest.py`
- Modify: `tests/find_paper_suggest_test.py`

- [ ] **Step 1: Write failing tests**

Append to `tests/find_paper_suggest_test.py`:

```python
# ---------------------- MMR ----------------------

def test_mmr_pure_relevance_lambda_one():
    """λ=1 collapses MMR to pure relevance ranking."""
    from scripts.find_paper_suggest import mmr_select
    embs = np.array([[1, 0], [1, 0.01], [0, 1]], dtype=float)  # 0 ≈ 1, both ⊥ to 2
    rel = np.array([0.9, 0.8, 0.7])
    selected = mmr_select(embs, rel, top_n=3, lam=1.0)
    assert selected == [0, 1, 2]  # purely by relevance


def test_mmr_pure_diversity_lambda_zero():
    """λ=0 collapses MMR to pure diversity (after the first pick)."""
    from scripts.find_paper_suggest import mmr_select
    embs = np.array([[1, 0], [1, 0.01], [0, 1]], dtype=float)
    rel = np.array([0.9, 0.8, 0.7])
    selected = mmr_select(embs, rel, top_n=3, lam=0.0)
    # First pick: highest relevance (idx 0).
    # Second pick: most dissimilar to idx 0 — that's idx 2 (orthogonal).
    # Third pick: only idx 1 left.
    assert selected[0] == 0
    assert selected[1] == 2
    assert selected[2] == 1


def test_mmr_top_n_capped_to_pool_size():
    from scripts.find_paper_suggest import mmr_select
    embs = np.array([[1, 0], [0, 1]], dtype=float)
    rel = np.array([0.5, 0.5])
    selected = mmr_select(embs, rel, top_n=10, lam=0.6)
    assert len(selected) == 2


def test_mmr_empty_pool():
    from scripts.find_paper_suggest import mmr_select
    embs = np.zeros((0, 5))
    rel = np.zeros(0)
    assert mmr_select(embs, rel, top_n=3, lam=0.6) == []


def test_mmr_default_lambda_balances():
    """Sanity: with λ=0.6, near-duplicate of the top item gets demoted."""
    from scripts.find_paper_suggest import mmr_select
    # Three candidates: [0] strong, [1] near-dup of [0], [2] orthogonal but lower relevance
    embs = np.array([[1, 0], [0.99, 0.01], [0, 1]], dtype=float)
    rel = np.array([0.9, 0.85, 0.6])
    selected = mmr_select(embs, rel, top_n=2, lam=0.6)
    # First: 0 (highest relevance). Second: 2, not 1 — diversity beats marginal relevance.
    assert selected[0] == 0
    assert selected[1] == 2
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
uv run --with pytest --with respx --with httpx --with numpy --with pydantic --with tenacity \
    pytest tests/find_paper_suggest_test.py -v -k mmr
```

Expected: 5 FAIL (`ImportError` on `mmr_select`).

- [ ] **Step 3: Implement `mmr_select`**

In `scripts/find_paper_suggest.py`, add after the cosine helpers and before `async def main`:

```python
def mmr_select(
    embeddings: np.ndarray,
    relevance: np.ndarray,
    top_n: int,
    lam: float = 0.6,
) -> list[int]:
    """Greedy Maximal Marginal Relevance selection.

    Args:
        embeddings: shape (N, D) candidate embeddings.
        relevance: shape (N,) relevance scores; higher is better.
        top_n: number of items to select.
        lam: tradeoff weight in [0, 1]. lam=1 is pure relevance; lam=0 is
            pure diversity-from-already-selected (after the first pick).

    Returns:
        list of indices into `embeddings`, in selection order. Length is
        min(top_n, N).
    """
    n = embeddings.shape[0]
    if n == 0:
        return []
    top_n = min(top_n, n)

    # Pre-normalize for fast cosine via dot product.
    norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
    norms[norms == 0.0] = 1.0
    normalized = embeddings / norms

    selected: list[int] = []
    remaining: set[int] = set(range(n))

    while len(selected) < top_n and remaining:
        best_idx: int | None = None
        best_score = -float("inf")
        for i in remaining:
            if selected:
                sims = normalized[selected] @ normalized[i]
                redundancy = float(sims.max())
            else:
                redundancy = 0.0
            score = lam * float(relevance[i]) - (1.0 - lam) * redundancy
            if score > best_score:
                best_idx = i
                best_score = score
        assert best_idx is not None
        selected.append(best_idx)
        remaining.discard(best_idx)

    return selected
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
uv run --with pytest --with respx --with httpx --with numpy --with pydantic --with tenacity \
    pytest tests/find_paper_suggest_test.py -v
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/find_paper_suggest.py tests/find_paper_suggest_test.py
git commit -m "feat(scripts): MMR diversity selection

Greedy Maximal Marginal Relevance over (embeddings, relevance) producing
top_n indices. Default lam=0.6 balances relevance against
already-selected redundancy. Used to diversify the top-10 output of
suggest given a diverse reading history.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: SS API call — `fetch_specter_embedding` (with retry)

**Files:**
- Modify: `scripts/find_paper_suggest.py`
- Modify: `tests/find_paper_suggest_test.py`

- [ ] **Step 1: Write failing tests**

Append to `tests/find_paper_suggest_test.py`:

```python
# ---------------------- SS embedding fetch ----------------------

import respx
import httpx


@pytest.mark.asyncio
@respx.mock
async def test_fetch_specter_embedding_200():
    from scripts.find_paper_suggest import fetch_specter_embedding
    respx.get(
        "https://api.semanticscholar.org/graph/v1/paper/ARXIV:1706.03762"
        "?fields=embedding.specter_v2"
    ).mock(return_value=httpx.Response(
        200,
        json={
            "paperId": "abc123",
            "embedding": {"model": "specter_v2", "vector": [0.1, 0.2, 0.3]},
        },
    ))
    async with httpx.AsyncClient() as client:
        vec = await fetch_specter_embedding(client, "ARXIV:1706.03762")
    assert vec == [0.1, 0.2, 0.3]


@pytest.mark.asyncio
@respx.mock
async def test_fetch_specter_embedding_404_returns_none():
    """Paper not in S2 corpus — return None, do not retry."""
    from scripts.find_paper_suggest import fetch_specter_embedding
    respx.get(
        "https://api.semanticscholar.org/graph/v1/paper/ARXIV:9999.99999"
        "?fields=embedding.specter_v2"
    ).mock(return_value=httpx.Response(404, json={"error": "Paper not found"}))
    async with httpx.AsyncClient() as client:
        vec = await fetch_specter_embedding(client, "ARXIV:9999.99999")
    assert vec is None


@pytest.mark.asyncio
@respx.mock
async def test_fetch_specter_embedding_no_embedding_field():
    """200 OK but the paper has no embedding indexed yet — return None."""
    from scripts.find_paper_suggest import fetch_specter_embedding
    respx.get(
        "https://api.semanticscholar.org/graph/v1/paper/ARXIV:1234.56789"
        "?fields=embedding.specter_v2"
    ).mock(return_value=httpx.Response(200, json={"paperId": "xyz", "embedding": None}))
    async with httpx.AsyncClient() as client:
        vec = await fetch_specter_embedding(client, "ARXIV:1234.56789")
    assert vec is None


@pytest.mark.asyncio
@respx.mock
async def test_fetch_specter_embedding_429_retries_then_succeeds():
    """One 429, then 200 — tenacity retry path exercises."""
    from scripts.find_paper_suggest import fetch_specter_embedding
    route = respx.get(
        "https://api.semanticscholar.org/graph/v1/paper/ARXIV:1706.03762"
        "?fields=embedding.specter_v2"
    )
    route.side_effect = [
        httpx.Response(429, json={"error": "rate limited"}),
        httpx.Response(200, json={"embedding": {"vector": [0.5, 0.5]}}),
    ]
    async with httpx.AsyncClient() as client:
        vec = await fetch_specter_embedding(client, "ARXIV:1706.03762")
    assert vec == [0.5, 0.5]
    assert route.call_count == 2
```

Note: pytest-asyncio is required. Add to the `--with` list in the test invocation. Also configure asyncio mode via a marker — see Step 2.

- [ ] **Step 2: Add asyncio mode config**

Append to `tests/conftest.py`:

```python


# pytest-asyncio: tests can use @pytest.mark.asyncio without per-file config.
import pytest

pytest_plugins = ["pytest_asyncio"]
```

Or — preferred since it doesn't pollute imports — create `tests/pytest.ini`:

```ini
[pytest]
asyncio_mode = auto
```

Use the `pytest.ini` approach. With `asyncio_mode = auto`, all `async def test_*` functions are automatically treated as asyncio tests, and the `@pytest.mark.asyncio` markers in the tests above are still valid (they're no-ops in auto mode but are explicit documentation).

- [ ] **Step 3: Run tests to verify they fail**

```bash
uv run --with pytest --with pytest-asyncio --with respx --with httpx --with numpy \
    --with pydantic --with tenacity \
    pytest tests/find_paper_suggest_test.py -v -k specter
```

Expected: 4 FAIL (`ImportError` on `fetch_specter_embedding`).

- [ ] **Step 4: Implement the embedding fetch with retry**

In `scripts/find_paper_suggest.py`, add after the math helpers and before `async def main`:

```python
import httpx
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_random_exponential,
)

S2_GRAPH_BASE = "https://api.semanticscholar.org/graph/v1"
S2_RECS_BASE = "https://api.semanticscholar.org/recommendations/v1"

# Status codes to retry. 429 (rate limit) and 5xx (server). 4xx other than 429
# are not retryable; 200 and 404 are returned to caller for handling.
_RETRYABLE_STATUS = frozenset({429, 500, 502, 503, 504})


@retry(
    stop=stop_after_attempt(3),
    wait=wait_random_exponential(multiplier=1, max=10),
    retry=retry_if_exception_type((httpx.HTTPStatusError, httpx.TransportError)),
    reraise=True,
)
async def _request_with_retry(
    client: httpx.AsyncClient,
    method: str,
    url: str,
    **kwargs,
) -> httpx.Response:
    """Issue an HTTP request with exponential-backoff retry on retryable
    statuses (429, 5xx) and transport errors. Non-retryable statuses
    (including 200 and 404) are returned to the caller without raising.
    """
    resp = await client.request(method, url, **kwargs)
    if resp.status_code in _RETRYABLE_STATUS:
        # Raise so tenacity retries.
        resp.raise_for_status()
    return resp


async def fetch_specter_embedding(
    client: httpx.AsyncClient,
    s2_paper_id: str,
) -> list[float] | None:
    """Fetch the SPECTER2 embedding for a paper from the S2 Graph API.

    Returns None if the paper is not in the S2 corpus (404), the response
    has no embedding field, or the embedding vector is empty.
    """
    url = f"{S2_GRAPH_BASE}/paper/{s2_paper_id}?fields=embedding.specter_v2"
    try:
        resp = await _request_with_retry(client, "GET", url)
    except httpx.HTTPStatusError:
        return None
    if resp.status_code == 404:
        return None
    if resp.status_code != 200:
        return None
    data = resp.json()
    embedding = data.get("embedding")
    if not embedding:
        return None
    vector = embedding.get("vector")
    if not vector:
        return None
    return list(vector)
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
uv run --with pytest --with pytest-asyncio --with respx --with httpx --with numpy \
    --with pydantic --with tenacity \
    pytest tests/find_paper_suggest_test.py -v
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/find_paper_suggest.py tests/find_paper_suggest_test.py tests/pytest.ini
git commit -m "feat(scripts): fetch_specter_embedding with tenacity retry

Async S2 Graph API call returning the SPECTER2 embedding vector for a
paper. Tenacity retries on 429/5xx with random_exponential backoff +
jitter, max 3 attempts. Returns None on 404, missing embedding field,
or final retry exhaustion.

Adds pytest.ini with asyncio_mode=auto for the async test suite.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: SS API call — `fetch_recommendations`

**Files:**
- Modify: `scripts/find_paper_suggest.py`
- Modify: `tests/find_paper_suggest_test.py`

- [ ] **Step 1: Write failing tests**

Append to `tests/find_paper_suggest_test.py`:

```python
# ---------------------- SS recommendations ----------------------

@pytest.mark.asyncio
@respx.mock
async def test_fetch_recommendations_200():
    from scripts.find_paper_suggest import fetch_recommendations
    expected_url = (
        "https://api.semanticscholar.org/recommendations/v1/papers"
        "?fields=title,abstract,authors,year,externalIds,embedding.specter_v2"
        "&limit=50"
    )
    route = respx.post(expected_url).mock(return_value=httpx.Response(
        200,
        json={
            "recommendedPapers": [
                {
                    "paperId": "abc",
                    "title": "Rec 1",
                    "abstract": "abs1",
                    "year": 2026,
                    "externalIds": {"ArXiv": "2604.12345"},
                    "authors": [{"name": "Alice"}],
                    "embedding": {"vector": [0.1] * 768},
                },
            ],
        },
    ))
    async with httpx.AsyncClient() as client:
        recs = await fetch_recommendations(
            client, ["ARXIV:1706.03762", "ARXIV:2211.14730"], limit=50,
        )
    assert len(recs) == 1
    assert recs[0]["title"] == "Rec 1"
    assert route.call_count == 1
    # Verify request body contained the positive ids.
    sent = route.calls[0].request
    assert b'"positivePaperIds":["ARXIV:1706.03762","ARXIV:2211.14730"]' in sent.content


@pytest.mark.asyncio
@respx.mock
async def test_fetch_recommendations_empty_response():
    from scripts.find_paper_suggest import fetch_recommendations
    respx.post(
        "https://api.semanticscholar.org/recommendations/v1/papers"
        "?fields=title,abstract,authors,year,externalIds,embedding.specter_v2"
        "&limit=50"
    ).mock(return_value=httpx.Response(200, json={"recommendedPapers": []}))
    async with httpx.AsyncClient() as client:
        recs = await fetch_recommendations(client, ["ARXIV:1706.03762"], limit=50)
    assert recs == []


@pytest.mark.asyncio
async def test_fetch_recommendations_no_positives_short_circuits():
    """No HTTP call is made when positive list is empty."""
    from scripts.find_paper_suggest import fetch_recommendations
    async with httpx.AsyncClient() as client:
        recs = await fetch_recommendations(client, [], limit=50)
    assert recs == []


@pytest.mark.asyncio
@respx.mock
async def test_fetch_recommendations_5xx_retries_exhaust():
    from scripts.find_paper_suggest import fetch_recommendations
    route = respx.post(
        "https://api.semanticscholar.org/recommendations/v1/papers"
        "?fields=title,abstract,authors,year,externalIds,embedding.specter_v2"
        "&limit=50"
    ).mock(return_value=httpx.Response(503, json={"error": "unavailable"}))
    async with httpx.AsyncClient() as client:
        with pytest.raises(httpx.HTTPStatusError):
            await fetch_recommendations(client, ["ARXIV:1706.03762"], limit=50)
    assert route.call_count == 3  # 3 attempts total
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
uv run --with pytest --with pytest-asyncio --with respx --with httpx --with numpy \
    --with pydantic --with tenacity \
    pytest tests/find_paper_suggest_test.py -v -k recommendations
```

Expected: 4 FAIL (ImportError).

- [ ] **Step 3: Implement `fetch_recommendations`**

In `scripts/find_paper_suggest.py`, add after `fetch_specter_embedding`:

```python
async def fetch_recommendations(
    client: httpx.AsyncClient,
    positive_ids: list[str],
    limit: int,
) -> list[dict]:
    """POST to the S2 Recommendations API and return the recommendedPapers list.

    Returns [] if positive_ids is empty (short-circuits, no HTTP call).
    Raises httpx.HTTPStatusError if all retries exhaust on 5xx/429.
    """
    if not positive_ids:
        return []
    url = (
        f"{S2_RECS_BASE}/papers"
        f"?fields=title,abstract,authors,year,externalIds,embedding.specter_v2"
        f"&limit={limit}"
    )
    body = {"positivePaperIds": list(positive_ids), "negativePaperIds": []}
    resp = await _request_with_retry(client, "POST", url, json=body)
    resp.raise_for_status()
    data = resp.json()
    return list(data.get("recommendedPapers", []))
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
uv run --with pytest --with pytest-asyncio --with respx --with httpx --with numpy \
    --with pydantic --with tenacity \
    pytest tests/find_paper_suggest_test.py -v
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/find_paper_suggest.py tests/find_paper_suggest_test.py
git commit -m "feat(scripts): fetch_recommendations from S2 API

POST /recommendations/v1/papers with positivePaperIds. Reuses the
shared retry helper. Short-circuits with empty list when there are no
positive papers (avoids a guaranteed-empty HTTP call).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: SS API orchestration — `backfill_missing_embeddings`

**Files:**
- Modify: `scripts/find_paper_suggest.py`
- Modify: `tests/find_paper_suggest_test.py`

- [ ] **Step 1: Write failing tests**

Append to `tests/find_paper_suggest_test.py`:

```python
# ---------------------- Embedding backfill ----------------------

@pytest.mark.asyncio
@respx.mock
async def test_backfill_no_missing():
    """If everything is cached, no HTTP calls are made."""
    from scripts.find_paper_suggest import (
        PastPaper, backfill_missing_embeddings,
    )
    past = [
        PastPaper(paper_id=1, s2_paper_id="ARXIV:1706.03762", title="t1"),
        PastPaper(paper_id=2, s2_paper_id="ARXIV:2211.14730", title="t2"),
    ]
    cached = {1: [0.1, 0.2], 2: [0.3, 0.4]}
    async with httpx.AsyncClient() as client:
        full, warnings = await backfill_missing_embeddings(client, past, cached)
    assert full == cached
    assert warnings == []


@pytest.mark.asyncio
@respx.mock
async def test_backfill_fetches_only_missing():
    from scripts.find_paper_suggest import (
        PastPaper, backfill_missing_embeddings,
    )
    respx.get(
        "https://api.semanticscholar.org/graph/v1/paper/ARXIV:2211.14730"
        "?fields=embedding.specter_v2"
    ).mock(return_value=httpx.Response(
        200, json={"embedding": {"vector": [0.7, 0.8]}}
    ))
    past = [
        PastPaper(paper_id=1, s2_paper_id="ARXIV:1706.03762", title="t1"),
        PastPaper(paper_id=2, s2_paper_id="ARXIV:2211.14730", title="t2"),
    ]
    cached = {1: [0.1, 0.2]}
    async with httpx.AsyncClient() as client:
        full, warnings = await backfill_missing_embeddings(client, past, cached)
    assert full[1] == [0.1, 0.2]
    assert full[2] == [0.7, 0.8]
    assert warnings == []


@pytest.mark.asyncio
@respx.mock
async def test_backfill_warns_on_missing():
    """When S2 has no embedding, we warn and exclude that past paper from `full`."""
    from scripts.find_paper_suggest import (
        PastPaper, backfill_missing_embeddings,
    )
    respx.get(
        "https://api.semanticscholar.org/graph/v1/paper/DOI:10.1080/foo"
        "?fields=embedding.specter_v2"
    ).mock(return_value=httpx.Response(404))
    past = [PastPaper(paper_id=99, s2_paper_id="DOI:10.1080/foo", title="missing")]
    async with httpx.AsyncClient() as client:
        full, warnings = await backfill_missing_embeddings(client, past, {})
    assert 99 not in full
    assert len(warnings) == 1
    assert "99" in warnings[0]
    assert "DOI:10.1080/foo" in warnings[0]
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
uv run --with pytest --with pytest-asyncio --with respx --with httpx --with numpy \
    --with pydantic --with tenacity \
    pytest tests/find_paper_suggest_test.py -v -k backfill
```

Expected: 3 FAIL (ImportError).

- [ ] **Step 3: Implement `backfill_missing_embeddings`**

In `scripts/find_paper_suggest.py`, add after `fetch_recommendations`:

```python
import asyncio


async def backfill_missing_embeddings(
    client: httpx.AsyncClient,
    past_papers: list[PastPaper],
    cached: dict[int, list[float]],
) -> tuple[dict[int, list[float]], list[str]]:
    """Fetch SPECTER2 embeddings for past papers not present in `cached`.

    Returns (full_embeddings, warnings) where:
      - full_embeddings is `cached` plus any newly-fetched embeddings,
        keyed by paper_id.
      - warnings is a list of human-readable strings describing past
        papers that returned no embedding (excluded from full).
    """
    missing = [p for p in past_papers if p.paper_id not in cached]
    warnings: list[str] = []
    if not missing:
        return (dict(cached), warnings)

    async def _fetch(paper: PastPaper) -> tuple[PastPaper, list[float] | None]:
        emb = await fetch_specter_embedding(client, paper.s2_paper_id)
        return (paper, emb)

    results = await asyncio.gather(*(_fetch(p) for p in missing))
    full = dict(cached)
    for paper, emb in results:
        if emb is None:
            warnings.append(
                f"Past paper id={paper.paper_id} ({paper.s2_paper_id}) "
                f"returned no embedding; excluded from rationale."
            )
            continue
        full[paper.paper_id] = emb
    return (full, warnings)
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
uv run --with pytest --with pytest-asyncio --with respx --with httpx --with numpy \
    --with pydantic --with tenacity \
    pytest tests/find_paper_suggest_test.py -v
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/find_paper_suggest.py tests/find_paper_suggest_test.py
git commit -m "feat(scripts): backfill_missing_embeddings (parallel S2 fetches)

For past papers not in the local cache, fetch SPECTER2 embeddings via
asyncio.gather. Papers with no embedding produce warnings and are
excluded from the full dict (rationale display gracefully degrades).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Orchestration — `main()` and end-to-end golden test

**Files:**
- Modify: `scripts/find_paper_suggest.py`
- Modify: `tests/find_paper_suggest_test.py`

- [ ] **Step 1: Write failing end-to-end test**

Append to `tests/find_paper_suggest_test.py`:

```python
# ---------------------- End-to-end golden test ----------------------

@pytest.mark.asyncio
@respx.mock
async def test_main_e2e_happy_path(monkeypatch, capsys):
    """Feed Input JSON via stdin, mock SS endpoints, assert Output JSON."""
    from scripts.find_paper_suggest import main

    # Past paper 12 already cached; past paper 17 needs backfill.
    respx.get(
        "https://api.semanticscholar.org/graph/v1/paper/ARXIV:2211.14730"
        "?fields=embedding.specter_v2"
    ).mock(return_value=httpx.Response(
        200, json={"embedding": {"vector": [1.0, 0.0]}}
    ))

    # Recommendations: two candidates with embeddings.
    respx.post(
        "https://api.semanticscholar.org/recommendations/v1/papers"
        "?fields=title,abstract,authors,year,externalIds,embedding.specter_v2"
        "&limit=50"
    ).mock(return_value=httpx.Response(200, json={
        "recommendedPapers": [
            {
                "paperId": "rec-a",
                "title": "Candidate A",
                "abstract": "Abstract A",
                "year": 2026,
                "authors": [{"name": "Alice"}],
                "externalIds": {"ArXiv": "2604.12345"},
                "embedding": {"vector": [0.99, 0.01]},
            },
            {
                "paperId": "rec-b",
                "title": "Candidate B",
                "abstract": "Abstract B",
                "year": 2026,
                "authors": [{"name": "Bob"}],
                "externalIds": {"ArXiv": "2604.67890"},
                "embedding": {"vector": [0.0, 1.0]},
            },
        ],
    }))

    input_payload = {
        "past_papers": [
            {"paper_id": 12, "s2_paper_id": "ARXIV:1706.03762", "title": "Attention"},
            {"paper_id": 17, "s2_paper_id": "ARXIV:2211.14730", "title": "PatchTST"},
        ],
        "cached_embeddings": {"12": [1.0, 0.0]},  # close to candidate A
        "top": 2,
        "limit": 50,
    }
    monkeypatch.setattr("sys.stdin", _StdinStub(json.dumps(input_payload)))

    rc = await main()
    assert rc == 0

    captured = capsys.readouterr()
    output = json.loads(captured.out)

    # Both candidates returned (top=2)
    assert len(output["candidates"]) == 2
    titles = {c["title"] for c in output["candidates"]}
    assert titles == {"Candidate A", "Candidate B"}

    # Candidate A is most similar to past paper 12 (Attention) — cosine ~1.0
    cand_a = next(c for c in output["candidates"] if c["title"] == "Candidate A")
    assert cand_a["matched_past_paper_id"] == 12
    assert cand_a["matched_past_paper_title"] == "Attention"
    assert cand_a["cosine"] > 0.9
    assert cand_a["arxiv_id"] == "2604.12345"

    # Newly-fetched embedding (paper 17) appears in embeddings_to_cache
    cached_pids = {e["paper_id"] for e in output["embeddings_to_cache"]}
    assert 17 in cached_pids
    assert 12 not in cached_pids  # already cached, not re-emitted

    # No warnings on the happy path
    assert output["warnings"] == []


class _StdinStub:
    """Minimal stdin replacement for monkeypatching."""

    def __init__(self, content: str) -> None:
        self._content = content

    def read(self) -> str:
        return self._content


@pytest.mark.asyncio
async def test_main_invalid_input_returns_1(monkeypatch, capsys):
    from scripts.find_paper_suggest import main
    monkeypatch.setattr("sys.stdin", _StdinStub("not valid json"))
    rc = await main()
    assert rc == 1
    captured = capsys.readouterr()
    assert "Input validation error" in captured.err
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
uv run --with pytest --with pytest-asyncio --with respx --with httpx --with numpy \
    --with pydantic --with tenacity \
    pytest tests/find_paper_suggest_test.py -v -k main
```

Expected: 2 FAIL (current `main()` is a stub returning 0 with empty output).

- [ ] **Step 3: Implement `main()`**

In `scripts/find_paper_suggest.py`, REPLACE the stub `main` with the real implementation. Also add the `import sys`, `import json` at the top with the other imports (only if not already present):

```python
import json
import sys


async def main() -> int:
    """Entry point. Reads Input JSON from stdin, emits Output JSON to stdout.

    Exit codes:
        0 — success (may include warnings, may include zero candidates)
        1 — hard failure (input validation, network unreachable after retries)
    """
    raw = sys.stdin.read()
    try:
        inp = Input.model_validate_json(raw)
    except Exception as exc:
        print(f"Input validation error: {exc}", file=sys.stderr)
        return 1

    cached_int: dict[int, list[float]] = {
        int(k): v for k, v in inp.cached_embeddings.items()
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        # Backfill any missing past-paper embeddings.
        full_past_embs, warnings = await backfill_missing_embeddings(
            client, inp.past_papers, cached_int,
        )

        embeddings_to_cache: list[EmbeddingToCache] = [
            EmbeddingToCache(paper_id=pid, model="specter_v2", vector=vec)
            for pid, vec in full_past_embs.items()
            if pid not in cached_int
        ]

        positive_ids = [p.s2_paper_id for p in inp.past_papers]
        try:
            recs = await fetch_recommendations(client, positive_ids, inp.limit)
        except httpx.HTTPStatusError as exc:
            print(
                f"Semantic Scholar Recommendations API failed: {exc}",
                file=sys.stderr,
            )
            return 1

        if not recs:
            warnings.append(
                "Semantic Scholar Recommendations returned 0 papers."
            )
            output = Output(
                candidates=[],
                embeddings_to_cache=embeddings_to_cache,
                warnings=warnings,
            )
            print(output.model_dump_json())
            return 0

        # Filter to recs with usable SPECTER2 embeddings.
        recs_with_emb = []
        for r in recs:
            emb = (r.get("embedding") or {}).get("vector")
            if emb:
                recs_with_emb.append(r)

        if len(recs_with_emb) < len(recs):
            warnings.append(
                f"{len(recs) - len(recs_with_emb)} of {len(recs)} "
                f"recommendations had no SPECTER2 embedding and were dropped."
            )

        if not recs_with_emb:
            warnings.append("No recommendations had usable embeddings.")
            output = Output(
                candidates=[],
                embeddings_to_cache=embeddings_to_cache,
                warnings=warnings,
            )
            print(output.model_dump_json())
            return 0

        # Build numpy structures for MMR + max-cosine.
        past_vecs_np: dict[int, np.ndarray] = {
            pid: np.array(v, dtype=float) for pid, v in full_past_embs.items()
        }
        cand_embs = np.array(
            [r["embedding"]["vector"] for r in recs_with_emb], dtype=float,
        )
        n = len(recs_with_emb)
        # Trust S2's ordering: relevance = 1 - rank / N.
        relevance = np.array([1.0 - i / n for i in range(n)])

        selected = mmr_select(cand_embs, relevance, top_n=inp.top, lam=0.6)

        # Build typed output candidates.
        candidates: list[Candidate] = []
        title_by_id = {p.paper_id: p.title for p in inp.past_papers}
        for idx in selected:
            r = recs_with_emb[idx]
            cand_vec = cand_embs[idx]
            best_id, best_score = max_cosine_match(cand_vec, past_vecs_np)
            external_ids = r.get("externalIds") or {}
            authors_raw = r.get("authors") or []
            candidates.append(Candidate(
                arxiv_id=external_ids.get("ArXiv"),
                s2_paper_id=r.get("paperId", ""),
                title=r.get("title", ""),
                abstract=r.get("abstract") or "",
                authors=[a.get("name", "") for a in authors_raw],
                year=r.get("year"),
                matched_past_paper_id=best_id,
                matched_past_paper_title=title_by_id.get(best_id) if best_id else None,
                cosine=best_score if best_id is not None else None,
            ))

        output = Output(
            candidates=candidates,
            embeddings_to_cache=embeddings_to_cache,
            warnings=warnings,
        )
        print(output.model_dump_json())
        return 0
```

- [ ] **Step 4: Run all tests to verify they pass**

```bash
uv run --with pytest --with pytest-asyncio --with respx --with httpx --with numpy \
    --with pydantic --with tenacity \
    pytest tests/find_paper_suggest_test.py -v
```

Expected: all tests PASS (~20 tests total).

- [ ] **Step 5: Commit**

```bash
git add scripts/find_paper_suggest.py tests/find_paper_suggest_test.py
git commit -m "feat(scripts): implement main() orchestration for find_paper_suggest

End-to-end flow: parse Input from stdin, backfill missing past-paper
embeddings via S2, fetch recommendations, filter to those with
SPECTER2 embeddings, compute MMR-selected top-N with max-cosine
rationale, emit Output as JSON to stdout. Exit 1 on input validation
failure or unrecoverable S2 error.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Skill markdown — add `suggest` sub-mode

**Files:**
- Modify: `.claude/commands/wids-find-paper.md`

- [ ] **Step 1: Update the frontmatter argument hint**

Edit `.claude/commands/wids-find-paper.md` line 3 from:

```
argument-hint: search "<query>" | compare <url1> <url2> ... | pick <suggestion_id>
```

to:

```
argument-hint: search "<query>" | compare <url1> <url2> ... | pick <suggestion_id> | suggest [--top N] [--limit M]
```

- [ ] **Step 2: Add the `## Step 5 — Sub-mode: suggest` section**

In `.claude/commands/wids-find-paper.md`, after the existing `## Step 4 — Sub-mode: pick` section and before `## Failure handling`, insert:

````markdown
## Step 5 — Sub-mode: suggest

Invocation: `/wids-find-paper suggest [--top N] [--limit M]`

Defaults: `--top 10`, `--limit 50`. Validation: `top` in `[1, 50]`, `limit` in `[10, 200]`, `top ≤ limit`. On invalid args, halt with usage hint and don't make HTTP calls.

### 5a — Load past read papers

```sql
SELECT p.id AS paper_id, p.title, p.url
FROM meetings m JOIN papers p ON p.id = m.paper_id
WHERE m.type='reading_group' AND m.status='done' AND p.url IS NOT NULL;
```

If zero rows: halt with `"No past readings yet — suggest needs at least one completed reading_group. Use /wids-find-paper search \"<query>\" for the first cycle."`

### 5b — Resolve URLs to S2 paper IDs

For each row, derive an S2 paper ID:

1. arXiv URL → `ARXIV:<id>` (regex: `arxiv\.org/(?:abs|pdf)/([0-9]{4}\.[0-9]{4,5})(?:v\d+)?(?:\.pdf)?`, strip version suffix).
2. DOI extractable → `DOI:<doi>` (regex: `\b(10\.\d{4,9}/[^\s/?#]+)`).
3. Otherwise → mark unresolvable; record paper_id, title, host for the user-facing note.

If zero papers resolve: halt with `"No past readings have arXiv or DOI URLs. /wids-find-paper suggest needs at least one resolvable past paper. Use search instead."`

### 5c — Load cached embeddings

```sql
SELECT paper_id, vector
FROM paper_embeddings
WHERE paper_id = ANY($resolved_paper_ids) AND model = 'specter_v2';
```

The vector type returns as a string like `'[0.012,-0.034,...]'`; parse into a Python float list per paper_id.

### 5d — Build helper input and invoke

Construct the JSON payload:

```json
{
  "past_papers": [
    {"paper_id": <int>, "s2_paper_id": "<ARXIV:... or DOI:...>", "title": "<title>"}
  ],
  "cached_embeddings": {"<paper_id_str>": [<floats>], ...},
  "top": <N>,
  "limit": <M>
}
```

Pipe into the helper:

```bash
uv run --with httpx --with numpy --with pydantic --with tenacity \
    scripts/find_paper_suggest.py
```

Expected: exit 0 with JSON on stdout (`Output` schema). Exit 1 indicates a hard failure; render the stderr message to the leader and write a `command_log` failure entry (5h).

### 5e — UPSERT new embeddings

For each entry in `embeddings_to_cache`:

```sql
INSERT INTO paper_embeddings (paper_id, model, vector)
VALUES ($paper_id, $model, $vector)
ON CONFLICT (paper_id, model)
DO UPDATE SET vector = EXCLUDED.vector, cached_at = now();
```

The `vector` value must be passed as a pgvector literal — string format `'[v1,v2,...]'`.

### 5f — Replace prior agent suggestions for this reading_group

```sql
DELETE FROM paper_suggestions
WHERE meeting_id = $rg_id AND source = 'agent';
```

### 5g — For each candidate, find-or-create paper + insert suggestion

For each candidate in the helper output:

1. Find or create the paper row by URL (mirror Step 2c pattern). The candidate's URL is `https://arxiv.org/abs/<arxiv_id>` if `arxiv_id` is set, else use the S2 paper URL `https://www.semanticscholar.org/paper/<s2_paper_id>`.

2. Generate the background-needed assessment by reading the abstract — same pattern as Step 2d.

3. Build the `notes` field. If `matched_past_paper_id` is non-null:

```
Most similar to: "<matched_past_paper_title>" (paper #<matched_past_paper_id>) — cosine <cosine:.2f>
Background: <assessment>
```

If `matched_past_paper_id` is null (no rationale available):

```
Background: <assessment>
```

4. Insert:

```sql
INSERT INTO paper_suggestions (meeting_id, paper_id, suggested_by, source, notes)
VALUES ($rg_id, $paper_id, NULL, 'agent', $notes)
ON CONFLICT (meeting_id, paper_id) DO NOTHING
RETURNING id;
```

Capture the returned suggestion id for display.

### 5h — Render output to leader

```
Found <N> candidates (similar to <K> of <M> past readings; SPECTER2 cosine; MMR λ=0.6):
```

If there were unresolvable past papers (Step 5b's third bucket), prefix with the partial-degradation note:

```
Note: <count> past readings excluded (no arXiv ID or extractable DOI):
  - "<title>" (<host>)
  - ...

Suggestions below are based on the remaining <K> of <M> past readings.
```

For each candidate (in helper-returned order):

```
[#<sugg_id>] <title> (arXiv:<arxiv_id>, <year>)
      Most similar to: "<matched_past_paper_title>" (read <date>) — cosine <cosine:.2f>
      Background: <assessment>
```

If matched_past_paper_id is null, omit the "Most similar to" line.

End with:

```
Pick one with: /wids-find-paper pick <id>
Or refine with: /wids-find-paper suggest --top 15 --limit 80
```

Surface any warnings from the helper output before the candidate list.

### 5i — Audit log

```sql
INSERT INTO command_log (source, name, status, summary)
VALUES ('slash_command', '/wids-find-paper', 'success',
        'suggest: <N> candidates inserted for reading_group <rg_id> '
        '(based on <K>/<M> past readings, SS Recommendations API, '
        'MMR λ=0.6, replaced <prior_count> prior agent rows)');
```

On failure (helper exit 1 or any DB write error):

```sql
INSERT INTO command_log (source, name, status, error)
VALUES ('slash_command', '/wids-find-paper', 'failure', '<message>');
```
````

- [ ] **Step 3: Verify the file is well-formed**

```bash
head -5 .claude/commands/wids-find-paper.md
grep -c "^## Step" .claude/commands/wids-find-paper.md
grep -c "^### 5[a-i]" .claude/commands/wids-find-paper.md
```

Expected:
- First 5 lines show the updated frontmatter with `suggest` in the argument-hint
- 5 `## Step` headings (Step 1, 2, 3, 4, 5)
- 9 `### 5x` sub-step headings (5a through 5i)

- [ ] **Step 4: Commit**

```bash
git add .claude/commands/wids-find-paper.md
git commit -m "feat(skill): add /wids-find-paper suggest sub-mode

Adds Step 5 covering load → resolve → backfill → recommend → MMR →
upsert embeddings → replace prior agent suggestions → render → log.
Helper invocation goes through scripts/find_paper_suggest.py.

Frontmatter argument-hint updated to advertise the new sub-mode.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Skill markdown — extend `pick` with topic auto-tagging (Step 4d.5)

**Files:**
- Modify: `.claude/commands/wids-find-paper.md`

- [ ] **Step 1: Insert Step 4d.5 between existing Step 4d and 4e**

Find the existing `### 4d — Update papers and meetings` section in `.claude/commands/wids-find-paper.md`. After its code block ends (just before `### 4e — Audit log`), insert:

````markdown
### 4d.5 — Auto-tag with topics

Read the existing topic list:

```sql
SELECT id, name FROM topics ORDER BY weight DESC;
```

If zero rows: skip this step entirely (no Claude call, no INSERT). Print one line: `"Note: topics table is empty; skipping topic tagging."` This indicates wids-bootstrap was never run or topics were deleted; not a fail state.

Otherwise, read the paper's title and abstract (from the `papers` row) and run this prompt against Claude:

> Given this paper's title and abstract, pick 0–3 topics from the list below that the paper is *primarily* about (not just mentions). Return the topic NAMES exactly as they appear in the list, as a JSON array of strings. Use existing names only — do not invent new topics. If no topic clearly fits, return `[]`. Prefer fewer, more confident matches over many weak ones.
>
> Title: `<title>`
>
> Abstract: `<abstract>`
>
> Topics: `<topic_name_1>, <topic_name_2>, ...`

Parse Claude's response:

1. Try to parse as JSON. If parsing fails (malformed JSON, prose response, etc.), treat as `[]` and log a warning.
2. Validate each name against the topics list using **case-insensitive match**. Discard any name not in the list (hallucination guard).
3. Map validated names back to their canonical IDs.

Insert the validated rows:

```sql
INSERT INTO paper_topics (paper_id, topic_id)
SELECT $paper_id, t.id
FROM topics t
WHERE LOWER(t.name) = ANY($lowered_validated_names)
ON CONFLICT (paper_id, topic_id) DO NOTHING;
```

Where `$lowered_validated_names` is a TEXT[] of validated names converted to lowercase.

Capture the canonical names that were actually inserted (for the user-facing message and audit log).

If validated set is empty (Claude returned `[]`, all names were hallucinations, or response was malformed), log a one-line warning and continue. No tagging is acceptable — the rest of `pick` (Step 4e) proceeds normally.
````

- [ ] **Step 2: Update the existing `### 4e — Audit log` section**

In the same file, find the existing `### 4e — Audit log` section. Replace the existing INSERT statement with:

```sql
INSERT INTO command_log (source, name, status, summary)
VALUES ('slash_command', '/wids-find-paper', 'success',
        'Picked paper "<title>" for reading_group <rg_id>; '
        'tagged with topics: <names_joined>');
```

Where `<names_joined>` is a comma-separated list of the canonical topic names that were inserted in 4d.5, or the literal string `no topics` if the validated set was empty.

- [ ] **Step 3: Add a new `### 4f — Render to leader` sub-step**

The existing `pick` sub-mode in `.claude/commands/wids-find-paper.md` ends at Step 4e (audit log) without an explicit rendering step — the slash-command framework relies on Claude composing the success message after the SQL operations complete. Make the rendering explicit so the new tagging info is surfaced consistently.

After the existing `### 4e — Audit log` section, append a new sub-step:

````markdown
### 4f — Render to leader

When topics were tagged in Step 4d.5 (validated set is non-empty), print:

```
Picked paper "<title>" for reading_group <rg_id>.
Tagged with topics: <names_joined>
PDF downloaded to: <drive_url>
```

When no topics were tagged (validated set is empty for any reason — empty topics table, all hallucinations, malformed Claude response), print:

```
Picked paper "<title>" for reading_group <rg_id>.
Tagged with no topics (none of the existing topics fit clearly).
PDF downloaded to: <drive_url>
```
````

- [ ] **Step 4: Verify the file structure**

```bash
grep -nE "^### 4[a-z](\.[0-9])? —" .claude/commands/wids-find-paper.md
grep -c "Tagged with" .claude/commands/wids-find-paper.md
```

Expected:
- Six sub-steps printed in order: 4a, 4b, 4c, 4d, 4d.5, 4e, 4f
- At least 2 occurrences of "Tagged with" in the file (the topics-found path in 4f, and the no-topics path also in 4f)

- [ ] **Step 5: Commit**

```bash
git add .claude/commands/wids-find-paper.md
git commit -m "feat(skill): auto-tag paper_topics on /wids-find-paper pick

When pick commits a paper to meetings.paper_id, also Claude-assign 0-3
topics from the existing topics list and INSERT paper_topics rows.
Name-validation defends against hallucinations (Claude can't return a
valid-looking int that doesn't exist; only a string we recognize or
discard). Empty topics table or empty Claude response degrades
silently — no tagging is acceptable.

This starts populating paper_topics, which has been dormant in
production since project inception.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Pick-extension SQL test

**Files:**
- Create: `tests/pick_topic_tagging_test.sql`

- [ ] **Step 1: Write the SQL test file**

Create `tests/pick_topic_tagging_test.sql`:

```sql
-- tests/pick_topic_tagging_test.sql
--
-- Tests the SQL pattern used by /wids-find-paper pick step 4d.5 (topic
-- auto-tagging at commit time). Specifically: the case-insensitive name
-- match, hallucination drop, ON CONFLICT idempotence, and behavior with
-- an empty topics list.
--
-- Run via:
--   psql "$SUPABASE_DB_URL" -f tests/pick_topic_tagging_test.sql
--
-- All assertions use DO blocks that RAISE EXCEPTION on failure. The
-- entire test runs in a single transaction that ROLLBACKs at the end,
-- leaving no fixture data behind.

BEGIN;

-- ---- Setup fixtures ----

INSERT INTO papers (id, title, url, abstract)
VALUES (90001, 'Test Paper for Tagging', 'http://test/tagging', 'Test abstract.');

INSERT INTO topics (id, name) VALUES
  (90010, 'Time Series Forecasting'),
  (90011, 'Causal Inference'),
  (90012, 'LLM Evaluation');

-- ---- Test 1: case-insensitive match inserts the right topic ----

INSERT INTO paper_topics (paper_id, topic_id)
SELECT 90001, t.id
FROM topics t
WHERE LOWER(t.name) = ANY(ARRAY['time series forecasting']::text[])
ON CONFLICT (paper_id, topic_id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM paper_topics WHERE paper_id = 90001 AND topic_id = 90010
  ) THEN
    RAISE EXCEPTION 'FAIL test 1: case-insensitive match did not insert';
  END IF;
  IF (SELECT COUNT(*) FROM paper_topics WHERE paper_id = 90001) <> 1 THEN
    RAISE EXCEPTION 'FAIL test 1: expected exactly 1 row, got %',
      (SELECT COUNT(*) FROM paper_topics WHERE paper_id = 90001);
  END IF;
END $$;

-- ---- Test 2: hallucinated name inserts zero rows ----

INSERT INTO paper_topics (paper_id, topic_id)
SELECT 90001, t.id
FROM topics t
WHERE LOWER(t.name) = ANY(ARRAY['quantum computing']::text[])
ON CONFLICT (paper_id, topic_id) DO NOTHING;

DO $$
BEGIN
  IF (SELECT COUNT(*) FROM paper_topics WHERE paper_id = 90001) <> 1 THEN
    RAISE EXCEPTION 'FAIL test 2: hallucination should not insert; have % rows',
      (SELECT COUNT(*) FROM paper_topics WHERE paper_id = 90001);
  END IF;
END $$;

-- ---- Test 3: ON CONFLICT keeps the table clean on re-suggest ----

INSERT INTO paper_topics (paper_id, topic_id)
SELECT 90001, t.id
FROM topics t
WHERE LOWER(t.name) = ANY(ARRAY['time series forecasting']::text[])
ON CONFLICT (paper_id, topic_id) DO NOTHING;

DO $$
BEGIN
  IF (SELECT COUNT(*) FROM paper_topics WHERE paper_id = 90001 AND topic_id = 90010) <> 1 THEN
    RAISE EXCEPTION 'FAIL test 3: ON CONFLICT should keep exactly 1 row';
  END IF;
END $$;

-- ---- Test 4: multi-topic insert (2 of 3 valid) ----

-- Reset for this test
DELETE FROM paper_topics WHERE paper_id = 90001;

INSERT INTO paper_topics (paper_id, topic_id)
SELECT 90001, t.id
FROM topics t
WHERE LOWER(t.name) = ANY(
  ARRAY['causal inference', 'llm evaluation', 'made-up topic']::text[]
)
ON CONFLICT (paper_id, topic_id) DO NOTHING;

DO $$
BEGIN
  IF (SELECT COUNT(*) FROM paper_topics WHERE paper_id = 90001) <> 2 THEN
    RAISE EXCEPTION 'FAIL test 4: expected 2 valid rows, got %',
      (SELECT COUNT(*) FROM paper_topics WHERE paper_id = 90001);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM paper_topics WHERE paper_id = 90001 AND topic_id = 90011
  ) THEN
    RAISE EXCEPTION 'FAIL test 4: missing causal inference topic';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM paper_topics WHERE paper_id = 90001 AND topic_id = 90012
  ) THEN
    RAISE EXCEPTION 'FAIL test 4: missing llm evaluation topic';
  END IF;
END $$;

-- ---- Test 5: empty validated names array inserts zero rows ----

DELETE FROM paper_topics WHERE paper_id = 90001;

INSERT INTO paper_topics (paper_id, topic_id)
SELECT 90001, t.id
FROM topics t
WHERE LOWER(t.name) = ANY(ARRAY[]::text[])
ON CONFLICT (paper_id, topic_id) DO NOTHING;

DO $$
BEGIN
  IF (SELECT COUNT(*) FROM paper_topics WHERE paper_id = 90001) <> 0 THEN
    RAISE EXCEPTION 'FAIL test 5: empty array should insert no rows';
  END IF;
END $$;

-- ---- Cleanup: rollback all fixtures ----

ROLLBACK;

-- If we reach here without raising, all tests passed.
\echo 'pick_topic_tagging_test.sql: all tests passed'
```

- [ ] **Step 2: Run the SQL test**

```bash
psql "$SUPABASE_DB_URL" -f tests/pick_topic_tagging_test.sql
```

Expected output ends with: `pick_topic_tagging_test.sql: all tests passed`. The connection string is the project's existing Supabase URL — same one used by `tests/rls.sql`.

If `$SUPABASE_DB_URL` isn't set in the shell, source it from the project's standard env path (consult MEMORY.md or `.env`).

- [ ] **Step 3: Commit**

```bash
git add tests/pick_topic_tagging_test.sql
git commit -m "test(skill): SQL fixture tests for pick auto-tagging INSERT pattern

Five tests covering case-insensitive name match, hallucination drop,
ON CONFLICT idempotence, multi-topic mixed-valid-and-invalid, and
empty-array no-op. Mirrors the SQL the pick step 4d.5 generates.
ROLLBACK keeps fixtures from leaking into the database.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: End-to-end smoke test (manual, against live S2 API)

**Files:**
- None (manual operator step). Documenting the procedure here for reproducibility.

- [ ] **Step 1: Verify Supabase has historical reading data**

Via Supabase MCP `execute_sql`:

```sql
SELECT m.id AS meeting_id, m.scheduled_at::date, p.title, p.url
FROM meetings m JOIN papers p ON p.id = m.paper_id
WHERE m.type='reading_group' AND m.status='done'
ORDER BY m.scheduled_at;
```

Expected: ≥ 1 row, ideally the historical 18 from `wids-zotero-historical-readings.csv`. If not, the smoke test runs against whatever exists; flag count.

- [ ] **Step 2: Ensure there's an active reading_group needing a leader**

```sql
SELECT id, leader_id FROM meetings
WHERE type='reading_group' AND status='prep' AND leader_id IS NOT NULL
ORDER BY created_at DESC LIMIT 1;
```

If no row: pick one via `/wids-pick-leader` first (or use `/wids-meeting-start admin` and `/wids-pick-leader` to set up a fresh cycle).

- [ ] **Step 3: Run the suggest sub-mode**

```
/wids-find-paper suggest
```

Expected: ~5-15s wall time. Output starts with `Found N candidates (similar to K of M past readings; ...)`. Eyeball:

- Are the K and M values plausible (~14 of 18 if all historicals are loaded)?
- Are there warnings about unresolvable past papers? Should be 4 (Google, Nature, MLR, USFCA).
- Are the candidate titles plausibly related to the group's reading history?
- Does each candidate have a "Most similar to" line matching a real past paper, with a cosine in [0.5, 0.95] roughly?
- Is the diversity reasonable — not all 10 candidates pointing at the same past paper?

- [ ] **Step 4: Pick one and verify the tagging**

```
/wids-find-paper pick <id>
```

Expected: success message includes `Tagged with topics: <names>` line (or `Tagged with no topics`). Verify via SQL:

```sql
SELECT pt.paper_id, t.name
FROM paper_topics pt JOIN topics t ON t.id = pt.topic_id
WHERE pt.paper_id = <picked_paper_id>;
```

Expected: 0–3 rows with topic names that match Claude's chosen topics from the success message. The `command_log` should reflect the tagging:

```sql
SELECT summary FROM command_log
WHERE name='/wids-find-paper'
ORDER BY ran_at DESC LIMIT 1;
```

- [ ] **Step 5: Verify embedding cache populated**

```sql
SELECT paper_id, model, vector_dims(vector) AS dim, cached_at
FROM paper_embeddings
WHERE model = 'specter_v2'
ORDER BY cached_at DESC;
```

Expected: rows for each past paper that resolved (≥ 14 rows after first invocation), each with `dim=768`. The `cached_at` of the most-recent ones should be from the smoke run.

- [ ] **Step 6: Re-run suggest and verify cache hit (faster)**

```
/wids-find-paper suggest
```

Expected: noticeably faster (~3-8s vs the first run's 5-15s). Output should also include `Replaced N prior agent suggestions for this reading_group.` since this is a re-run.

- [ ] **Step 7: Document the smoke test result**

Append to the PR description (when this branch is being merged) or to `docs/superpowers/` notes:

- Date of smoke run
- K/M counts observed (resolvable past papers / total)
- Warnings observed (should match the 4 expected unresolvable papers)
- One sentence on perceived candidate quality (operator's qualitative judgment)
- Whether topic tagging produced sensible topics for the picked paper

This isn't a strict gate — it's a sanity check that the production pipeline behaves as the spec describes.

- [ ] **Step 8: Commit any documentation changes**

If you wrote a smoke-test result note:

```bash
git add <docs path>
git commit -m "docs: smoke-test results for /wids-find-paper suggest

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Self-review notes (for the implementer's awareness)

The plan covers each section of the spec:

- **§2.1 (component split):** Tasks 2-9 build the Python helper; Task 10 builds the skill orchestration.
- **§2.2 (end-to-end flow):** Tasks 6-9 build the helper-side steps; Task 10 builds the skill-side steps.
- **§2.3 (invariants):** Task 9 enforces lazy-fetch + cache-via-embeddings_to_cache; Tasks 6-7 enforce per-call S2 contracts.
- **§2.4 (latency):** No specific task — emergent property of the parallel `asyncio.gather` in Task 8 plus the cache hit in Task 10's Step 5c.
- **§2.5 (pick extension):** Task 11 implements the markdown changes; Task 12 tests the SQL pattern.
- **§3 (data model):** Task 1.
- **§4 (module boundaries / Python helper):** Tasks 2-9.
- **§5 (UX/display):** Task 10 covers Step 5h; Task 11 covers the pick output/audit-log lines.
- **§6 (failure modes):** All Python-side failures covered in Tasks 6-9 tests; pick-side failures covered by Task 12 (SQL) and Task 13 (manual smoke).
- **§7 (test plan):** Tasks 2-9 cover §7.1 (unit + HTTP-mocked); Task 12 covers §7.1a (pick-extension); Task 13 covers §7.4 (manual smoke). One golden file test in Task 9 covers §7.3.
- **§8 (security/privacy):** No specific task — emergent (no PII sent, no secrets touched).
- **§9 (deferred items):** No tasks (intentionally out of scope for V1).

No placeholders. No "TBD"/"TODO"/"implement later" steps. Every step has either runnable code or runnable commands with expected output.
