# WiDS NYC AI Reading Group — `/wids-find-paper suggest` Design

**Date:** 2026-05-06
**Status:** Approved (pending final review)
**Related:** Extends `.claude/commands/wids-find-paper.md` (`search` / `compare` / `pick` sub-modes)

## 1. Overview

Today the leader runs `/wids-find-paper search "<query>"` to find candidate papers on arXiv. That requires the leader to already know roughly what to search for. This spec adds a fourth sub-mode, `suggest`, that produces ranked candidates *without a query* — by asking Semantic Scholar's Recommendations API for papers similar to what the group has already read.

### Goals

1. Surface ranked candidate papers based on the group's actual reading history, not the leader's query phrasing.
2. Cover all eras — classics and recent submissions both. The group reads papers from 2010 through 2026; restricting to "last 30 days of arXiv" misses most of what the group actually picks.
3. Maintain output diversity. With 18 past readings spanning ~6 distinct topic clusters, ranked output must avoid concentrating on whichever past cluster has the most papers.
4. Integrate cleanly with the existing `pick` flow — `suggest` writes to `paper_suggestions` so the leader picks via the existing `/wids-find-paper pick <id>`.

### Non-goals (V1)

- `negativePaperIds` (passing rejected papers as SS negatives) — no rejection signal in schema yet.
- Auto-fire from `/wids-pick-leader` — leader invokes `suggest` explicitly.
- Self-hosted SPECTER2 fallback — Path Z's design makes it largely redundant; add later if real coverage gaps appear.
- Topic-aware re-ranking — SS Recommendations already infers topics from past papers; an explicit boost layer might fight the algorithm.
- Auto-tagging candidates with `paper_topics` — defer; topic assignment from abstracts alone is fuzzy.
- Caching candidate embeddings on first sight — at ~5% conversion, mostly wasted writes.
- HNSW index on `paper_embeddings.vector` — brute-force cosine over <100 rows is microseconds.
- Multi-model A/B (e.g., adding Voyage in parallel) — schema supports it but no UI.
- `--days N` window filter on candidates — pivoted away from date filtering since the group reads classics.

## 2. Architecture

### 2.1 Two-component split

- **Skill markdown** (`.claude/commands/wids-find-paper.md`, extended): orchestrates the flow, runs all SQL via the Supabase MCP, presents output to the leader, inserts `paper_suggestions`. Owns all database I/O.
- **Python helper** (`scripts/find_paper_suggest.py`, new): pure data transformer — takes JSON in via stdin, emits JSON out via stdout, makes HTTP calls to Semantic Scholar. No psycopg2, no DATABASE_URL, no DB writes. Run via `uv run --with httpx --with numpy --with pydantic --with tenacity scripts/find_paper_suggest.py`.

Rationale: keeps the helper testable in isolation, avoids two auth paths to Supabase, matches the existing `scripts/zotero_push.py` pattern.

### 2.2 End-to-end flow (one invocation)

```
1. Skill: find active reading_group with leader (existing SQL pattern).
   Halt if none.

2. Skill: SELECT past read papers:
   SELECT p.id, p.title, p.url
   FROM meetings m JOIN papers p ON p.id = m.paper_id
   WHERE m.type='reading_group' AND m.status='done' AND p.url IS NOT NULL;

3. Skill: SELECT cached past embeddings:
   SELECT paper_id, vector FROM paper_embeddings
   WHERE paper_id = ANY($read_paper_ids) AND model = 'specter_v2';

4. Skill → Python: pass read_papers + cached_embeddings via stdin JSON.

5. Python: For each past paper missing an embedding:
   GET https://api.semanticscholar.org/graph/v1/paper/ARXIV:<id>?fields=embedding.specter_v2
   (or DOI:<doi> for DOI-resolved papers)
   Emit results in `embeddings_to_cache` for skill to UPSERT.

6. Python: POST https://api.semanticscholar.org/recommendations/v1/papers
   body = {"positivePaperIds": [...], "negativePaperIds": []}
   query = "?fields=title,abstract,authors,year,externalIds,embedding.specter_v2&limit=50"
   → up to 50 candidates with embeddings.

7. Python: For each candidate, max cosine to all past_paper_embeddings →
   (best_match_paper_id, cosine_score). For display rationale only.

8. Python: MMR over the 50 candidates using their SPECTER2 embeddings:
   - relevance = 1 - rank/50 (trust SS's ordering)
   - λ = 0.6
   - greedy: pick the candidate maximizing λ*relevance - (1-λ)*max_sim_to_already_picked
   - stop at N=10
   → ordered top-10.

9. Python: emit JSON to stdout with `candidates`, `embeddings_to_cache`, `warnings`.

10. Skill:
    a) UPSERT past-paper embeddings returned in step 9 into paper_embeddings.
    b) DELETE prior agent suggestions:
       DELETE FROM paper_suggestions WHERE meeting_id=<rg> AND source='agent';
    c) For each top-10 candidate:
       - Find or create papers row by URL (existing pattern from search sub-mode).
       - Generate background-needed assessment (Claude reads abstract — same pattern as search 2d).
       - INSERT paper_suggestions (meeting_id, paper_id, source='agent',
         notes='<rationale>\n<background>').
    d) Render the leader-facing output.
    e) command_log entry, same pattern as existing sub-modes.
```

### 2.3 Key invariants

- Past-paper embeddings are computed lazily on first use, cached forever in `paper_embeddings`. Steady-state runs need only step 6 + downstream — one SS API call.
- MMR runs in the Python helper. No need for pgvector ANN indexes at this scale; the math is in numpy. pgvector's role is purely **storage + retrieval** of past embeddings.
- SS Recommendations API is the only place we trust a black-box ranker. Everything downstream (MMR, display, persistence) is our code.

### 2.4 Latency

- **First run after migration:** ~5-15s. One SS Recommendations call (~1s) + parallel embedding backfill for ~14 past papers (~3-5s with `asyncio.gather`) + Python math + SQL writes.
- **Subsequent runs:** ~3-8s. Past-paper embeddings cached; only SS Recommendations call + math + writes.

Acceptable for an interactive operator-invoked command.

## 3. Data model

### 3.1 Migration: `migrations/010_paper_embeddings.sql`

```sql
BEGIN;

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE paper_embeddings (
  paper_id   INT  NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  model      TEXT NOT NULL,
  vector     vector NOT NULL,        -- intentionally untyped dimension; see comment
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

### 3.2 Design notes

- **Untyped `vector` column** — `vector` without a dimension. Tradeoff: lose static dimension checking, gain multi-model coexistence. Acceptable because the only writer is one Python helper that hardcodes the SS API contract per model.
- **Model identifier convention** — the `model` column stores literal API field names: `'specter_v2'` (not `'specter2'` or `'SPECTER2'`). Future entries: `'voyage_4'`, etc.
- **No ANN index for V1.** With ≤100 paper rows ever, brute-force is microseconds. When we cross ~10K rows, per-model partial HNSW: `CREATE INDEX ON paper_embeddings USING hnsw (vector vector_cosine_ops) WHERE model = 'specter_v2';` (HNSW requires fixed dimension; partial-by-model satisfies that.)
- **No new tables on `papers`.** All caching lives on the new `paper_embeddings` table. Past papers are referenced by `paper_id`. Candidate embeddings are *not* persisted (transient within one Python invocation).
- **RLS / grants.** SELECT granted to `authenticated` and `anon` mirroring the existing `papers` grants. Writes happen via service role from the slash-command flow.

## 4. Module boundaries and Python helper interface

### 4.1 Invocation (from skill markdown)

```bash
echo "$INPUT_JSON" | uv run --with httpx --with numpy --with pydantic --with tenacity \
  scripts/find_paper_suggest.py
```

### 4.2 Input contract (stdin, validated via pydantic)

The skill resolves each past paper's URL into a Semantic Scholar paper identifier (`ARXIV:<id>` or `DOI:<doi>`) before constructing the input. The helper passes the identifier through to SS without re-parsing — keeps URL/format logic in one place (the skill).

```json
{
  "past_papers": [
    {"paper_id": 12, "s2_paper_id": "ARXIV:1706.03762", "title": "Attention Is All You Need"},
    {"paper_id": 17, "s2_paper_id": "ARXIV:2211.14730", "title": "PatchTST"}
  ],
  "cached_embeddings": {
    "12": [0.012, -0.034, "..."],
    "17": ["..."]
  },
  "top": 10,
  "limit": 50
}
```

Notes on the schema:

- `s2_paper_id` is always a fully-qualified S2 identifier with prefix (`ARXIV:`, `DOI:`, etc.). Past papers that the skill couldn't resolve are excluded entirely from `past_papers` — the helper never sees them.
- `cached_embeddings` keys are stringified `paper_id`s (JSON object keys must be strings). Values are 768-dim float arrays. A past paper present in `past_papers` but missing from `cached_embeddings` triggers the lazy-fetch path in step 5 of the architecture.
- `top` defaults to 10 if omitted, `limit` defaults to 50 (defaults validated by pydantic; skill normally passes both).

### 4.3 Output contract (stdout, JSON)

```json
{
  "candidates": [
    {
      "arxiv_id": "2604.12345",
      "s2_paper_id": "ARXIV:2604.12345",
      "title": "...",
      "abstract": "...",
      "authors": ["..."],
      "year": 2026,
      "matched_past_paper_id": 17,
      "matched_past_paper_title": "PatchTST",
      "cosine": 0.842
    }
  ],
  "embeddings_to_cache": [
    {"paper_id": 12, "model": "specter_v2", "vector": [...]}
  ],
  "warnings": [
    "Past paper id=42 (DOI:10.1000/foo) returned no embedding; excluded from rationale."
  ]
}
```

### 4.4 Exit codes

- `0` — success (may include warnings, may include zero candidates with explanation in `warnings`)
- `1` — hard failure (bad input JSON, network unreachable after retries, schema mismatch). Error message on stderr.

A paper not being in the S2 corpus is *not* a hard failure — it's a warning, and we proceed without it.

### 4.5 Internal structure (~150-200 LOC target)

```
1. Pydantic models (~30 LOC)
   PastPaper, Input, Candidate, EmbeddingToCache, Output

2. Pure helpers (~40 LOC)
   extract_arxiv_id(url) -> str | None
   extract_doi_from_url(url) -> str | None
   cosine(a, b) -> float
   max_cosine_match(cand_vec, past_vecs) -> (paper_id, score)
   mmr_select(candidates, embeddings, top_n, lam=0.6) -> list[int]

3. SS API calls (~50 LOC, async with httpx + tenacity)
   fetch_specter_embedding(client, s2_paper_id) -> list[float] | None
   fetch_recommendations(client, positive_ids, limit) -> list[dict]
   backfill_missing_embeddings(client, past_papers, cached) -> tuple[dict, list[str]]

4. Orchestration (~40 LOC)
   main() — async, asyncio.run from __main__
```

### 4.6 Dependencies

- **httpx** — async HTTP. Stdlib `urllib` + threading is the alternative; httpx + asyncio is ~3 lines vs ~30 for our parallelism.
- **numpy** — cosine and MMR math. ~5 LOC each.
- **pydantic** — input/output validation. Turns "skill sent malformed JSON" from a confusing AttributeError deep in main() into a clean error at parse time.
- **tenacity** — retry with `wait_random_exponential` + `stop_after_attempt(3)` + `retry_if_exception_type((httpx.HTTPStatusError, httpx.TransportError))`. Decorator on the two SS-calling functions.

All four are used only inside this one script via `uv`. Not project-wide deps.

### 4.7 Retry behavior

```python
@retry(
    stop=stop_after_attempt(3),
    wait=wait_random_exponential(multiplier=1, max=10),
    retry=retry_if_exception_type((httpx.HTTPStatusError, httpx.TransportError)),
    reraise=True,
)
async def fetch_specter_embedding(client, s2_paper_id): ...
```

- 3 attempts total (1 initial + 2 retries), exponential backoff with jitter, max 10s wait.
- Reraises the underlying httpx exception on final failure (caller catches `HTTPStatusError` cleanly).
- Does not retry on 404 (paper not in S2 corpus is a real "not found," not transient).

### 4.8 Work-split table

| Concern | Skill | Python |
|---|---|---|
| Find active reading_group | ✓ | |
| SELECT past read papers | ✓ | |
| Resolve URL → S2 ID (arXiv/DOI) | ✓ | |
| SELECT cached embeddings | ✓ | |
| Construct stdin JSON | ✓ | |
| HTTP to S2 (recommendations + embeddings) | | ✓ |
| Cosine + MMR math | | ✓ |
| UPSERT paper_embeddings cache | ✓ | |
| Find-or-create papers row per candidate | ✓ | |
| Generate background-needed assessment | ✓ | |
| INSERT paper_suggestions | ✓ | |
| Render leader-facing output | ✓ | |
| command_log entry | ✓ | |

## 5. UX and display

### 5.1 Invocation forms

```
/wids-find-paper suggest
/wids-find-paper suggest --top 5
/wids-find-paper suggest --top 5 --limit 30
```

**Defaults:** `--top 10`, `--limit 50`.
**Validation:** `top` in `[1, 50]`, `limit` in `[10, 200]`, `top ≤ limit`. On invalid args, halt with a usage hint and don't make any HTTP calls.

### 5.2 `notes` field format in `paper_suggestions`

Two lines, plain text. Mirrors the existing `search` sub-mode shape:

```
Most similar to: "PatchTST" (paper #17, read 2025-01-23) — cosine 0.84
Background: comfort with attention and time-series basics. Accessibility: medium.
```

If a candidate has no resolvable past-paper match (rationale failed), only the background line is stored and the rationale line is omitted.

### 5.3 Leader-facing output (success path)

```
Found 10 candidates (similar to 14 of 18 past readings; SPECTER2 cosine; MMR λ=0.6):

[#42] Some New Paper Title (arXiv:2604.12345, 2026)
      Most similar to: "PatchTST" (read 2025-01-23) — cosine 0.84
      Background: comfort with attention and time-series basics. Accessibility: medium.

[#43] Another Paper (arXiv:2604.09876, 2026)
      Most similar to: "Causal Conceptions of Fairness" (read 2025-10-01) — cosine 0.78
      Background: causal DAGs, basic structural causal models. Accessibility: medium-hard.

...

Pick one with: /wids-find-paper pick <id>
Or refine with: /wids-find-paper suggest --top 15 --limit 80
```

Header line surfaces three things every time: how many past readings contributed, what model was used, how diversity was applied.

### 5.4 Past-paper ID resolution (partial degradation)

The historical readings CSV (as of 2026-05-06) has 18 past readings: 13 with arXiv URLs, 1 with a DOI directly extractable from the URL (Tandfonline), 4 with neither (Google research, Nature, MLR proceedings, USFCA-hosted PDF). Expected coverage: 14 of 18.

Resolution strategy, in order:

1. **arXiv URL** → `ARXIV:<id>` (regex captures `/abs/<id>` and `/pdf/<id>.pdf`, strips version suffix).
2. **DOI extractable from URL** → `DOI:<doi>` (regex `/(\d{2}\.\d{4,}\/[^/?#]+)/i`; matches Tandfonline-style URLs that embed the full DOI). Note: Nature URLs of the form `nature.com/articles/<article-id>` do *not* match this regex — the DOI prefix `10.1038/` is implicit, not present in the URL — and are intentionally not handled by URL-only extraction. Adding a DOI lookup via Crossref or NCBI is a V2 enhancement.
3. **Anything else** → skip with warning.

Unresolvable past papers are surfaced before the candidate list:

```
Note: 4 past readings excluded (no arXiv ID or extractable DOI):
  - "Deep Neural Networks for YouTube Recommendations" (research.google.com PDF)
  - "Scalable Watermarking for Identifying LLM Outputs" (nature.com — DOI prefix implicit)
  - "Causal structure-based root cause analysis of outliers" (proceedings.mlr.press)
  - "Scalable Network Analytics..." (cs.usfca.edu PDF)

Suggestions below are based on the remaining 14 of 18 past readings.
```

### 5.5 Edge cases

| Case | Display |
|---|---|
| No active reading_group with leader | `No reading_group with a leader yet. Run /wids-pick-leader first.` (existing pattern) |
| No past readings at all (first cycle) | `No past readings yet — suggest needs at least one completed reading_group. Use /wids-find-paper search "<query>" for the first cycle.` |
| All past readings have unresolvable URLs | `No past readings have arXiv or DOI URLs. /wids-find-paper suggest needs at least one resolvable past paper. Use search instead.` |
| SS Recommendations returns empty | `Semantic Scholar found no similar papers. The positive set may be too obscure or recent. Try /wids-find-paper search "<query>" instead.` |
| SS API unavailable after retries | `Semantic Scholar API is unavailable (3 retries failed). Try again in a few minutes, or use /wids-find-paper search "<query>" for now.` |
| MMR pool drops below `--top` | Show what we have + warning: `Returning N candidates instead of M; some recommendations had no SPECTER2 embedding available.` |
| Re-run on same reading_group | Silent replace of prior `source='agent'` rows. Header shows: `Replaced 10 prior agent suggestions for this reading_group.` |

### 5.6 Re-run semantics

```sql
DELETE FROM paper_suggestions
WHERE meeting_id = $1 AND source = 'agent';
-- then INSERT fresh rows
```

Member- and leader-suggested rows (`source='member'`, `source='leader'`) are untouched. Re-run produces *new* SERIAL IDs, never reused.

### 5.7 `command_log` entry

```sql
-- success
INSERT INTO command_log (source, name, status, summary)
VALUES ('slash_command', '/wids-find-paper', 'success',
        'suggest: 10 candidates inserted for reading_group <rg_id> '
        '(based on 14/18 past readings, SS Recommendations API, '
        'MMR λ=0.6, replaced 10 prior agent rows)');

-- failure
INSERT INTO command_log (source, name, status, error)
VALUES ('slash_command', '/wids-find-paper', 'failure',
        'Semantic Scholar API timeout after 3 retries');
```

## 6. Failure modes

| Failure | When | Visibility |
|---|---|---|
| pgvector extension unavailable | Migration 010 runs | Migration fails loudly during `supabase db push`. Supabase free tier supports pgvector; should not fire on a properly-configured project. |
| Past-paper ID resolution fails for all 18 | Skill, before HTTP | Skill halts with error message — never reaches Python. |
| SS API down / rate-limited beyond retries | Python, after tenacity exhausts | Helper exits 1, stderr message; skill renders unavailability message + writes failure to `command_log`. |
| SS Recommendations returns 0 papers | Python, recoverable | Helper exits 0 with empty `candidates` array; skill renders friendly "no similar papers found" message. |
| Pydantic input validation fails | Python entry | Helper exits 1 with structured error on stderr — points to which JSON field failed. Indicates skill orchestration bug, not user-facing. |
| Zero-norm embedding (cosine NaN) | Python math | Defensive: detect `||v|| == 0`, skip with warning. Should never happen with real SPECTER2 output but cheap to guard. |
| Skill DB write fails after Python succeeds | Skill, post-Python | Python ran successfully (HTTP burned), DB writes failed. Skill writes failure to `command_log` and surfaces error. Leader can re-run; SS API gets called again (acceptable for an interactive command). |

## 7. Test plan

### 7.1 Unit tests (pytest, ~10 tests in `tests/test_find_paper_suggest.py`)

- `extract_arxiv_id`: `/abs/2104.05234`, `/pdf/2104.05234.pdf`, `/abs/2104.05234v3`, malformed inputs.
- `extract_doi_from_url`: Nature, Tandfonline, MLR (success); arbitrary PDFs (returns None).
- `cosine`: orthogonal, identical, zero-norm guard.
- `max_cosine_match`: ties, single-past-paper, empty corpus.
- `mmr_select`: λ=1 (pure relevance), λ=0 (pure diversity), `top_n > pool_size`.

### 7.2 HTTP layer (`respx` mocking, ~5 tests)

- SS embedding 200 + valid SPECTER2 response.
- SS embedding 404 (paper not in corpus) → returns None, adds warning.
- SS recommendations 200 with `recommendedPapers` array.
- 429 → tenacity retry → 200 (verify retry path).
- 5xx exhausting retries → exits 1.

### 7.3 Integration

One golden-file test: feed a small `Input` JSON with mocked SS responses, assert `Output` schema and content shape.

### 7.4 Manual smoke

One real run during implementation against the live S2 API with the actual past-readings CSV. Eyeball: candidates plausible? Rationale matches? MMR set actually diverse?

## 8. Security and privacy

- All data sent to Semantic Scholar is public (arXiv IDs, DOIs of published papers). No member PII, no group-internal data.
- SS API requires no key for our rate budget (~5000 requests / 5 min); nothing to leak via env vars.
- Supabase writes use existing MCP service-role auth.

## 9. Decisions deferred to V2 (with rationale)

| Item | Rationale for deferral |
|---|---|
| `negativePaperIds` (rejected papers as SS negatives) | Requires a "rejected" flag on `paper_suggestions` we don't have. Easy V2 addition. |
| Auto-fire from `/wids-pick-leader` | Leader doing it explicitly is more controllable in V1. Promote later if leaders consistently want it pre-fetched. |
| Self-hosted SPECTER2 fallback | Path Z's design uses SS Recommendations as the ranker; SPECTER2 embeddings are needed only for past-paper rationale display. Coverage gap is rare. Add if real-world gaps appear. |
| Topic-aware re-ranking | SS Recommendations already infers topics from past papers; explicit boost layer might fight the algorithm. Worth measuring before building. |
| Auto-tagging candidates with `paper_topics` | Topic assignment from abstracts alone is fuzzy. Could later ask Claude to suggest topics during the background-needed step. |
| Caching candidate embeddings on first sight | At ~5% conversion (top-10 of 50, then 1 actually picked), 95% wasted writes. Only worth it if cycles overlap (they shouldn't with monthly cadence). |
| HNSW index | Brute-force cosine over <100 rows is microseconds. Add when corpus exceeds ~500. |
| Multi-model A/B (Voyage in parallel) | Schema supports it (`paper_embeddings.model` column); no UI. Manual SQL exploration only. |
| `--days N` window filter | Pivoted away from date filtering since the group reads classics. If a leader wants only recent results, a `--year-min N` flag is easy to add later. |
