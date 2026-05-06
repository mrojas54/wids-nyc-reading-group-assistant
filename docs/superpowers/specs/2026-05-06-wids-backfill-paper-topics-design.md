# WiDS NYC AI Reading Group — Backfill `paper_topics` for Historical Readings

**Date:** 2026-05-06
**Status:** Draft (depends on `2026-05-06-wids-find-paper-suggest-design.md` landing first)
**Companion to:** [2026-05-06-wids-find-paper-suggest-design.md](./2026-05-06-wids-find-paper-suggest-design.md)

## 1. Overview

The `paper_topics` join table has been dormant since project inception — defined in `migrations/001_initial_schema.sql`, RLS'd in `003_rls_policies.sql`, read by `scripts/zotero_push.py:485`, but never written by any production code path. The companion spec (`/wids-find-paper suggest`) starts populating it forward-going by hooking into the `pick` sub-mode at commit time.

This spec covers the one-time backfill: for each of the 18 historical readings already committed as `meetings.paper_id` (where `status='done'`), tag with topics from the existing `topics` list. After this runs, the table is fully populated for everything we've ever read.

### Goals

1. Populate `paper_topics` for all historical reading-group papers — `meetings.paper_id WHERE status='done' AND paper_id IS NOT NULL`.
2. Reuse the prompt pattern and validation logic the suggest spec defines for `pick`-time tagging (Section 2.5 there). One source of truth for topic-from-abstract logic.
3. Allow operator review before any DB writes — bulk auto-tagging without human confirmation is a worse failure mode than the current always-empty state.

### Non-goals

- Tagging papers that are *not* in `meetings.paper_id` (e.g., `paper_suggestions` rows that were never picked). Those have no group-endorsed signal; the topic data would be noise.
- Backfilling abstracts for papers where they're missing — a related but separate concern handled inline if needed (Section 3.3).
- Modifying the `topics` table itself — neither adding new topics nor changing weights. The backfill uses the topics list as-is. If new topics are needed, the operator adds them via SQL or `wids-bootstrap` re-run before backfilling.
- Tagging companion papers (extras read alongside the main paper) — current schema doesn't support that distinction; out of scope.

## 2. Dependencies

This spec must NOT run before the suggest spec lands, for two reasons:

1. **Prompt template reuse.** Section 2.5 of the suggest spec defines the topic-picking prompt and name-validation logic. The backfill copies that pattern. If suggest hasn't landed, there's no canonical version to copy.
2. **Code reuse for S2 ID resolution.** The backfill needs to fetch missing abstracts from Semantic Scholar. The suggest spec's Python helper has `extract_arxiv_id` and `extract_doi_from_url` plus `fetch_specter_embedding` (which can be adapted to fetch abstracts). Lifting those into a small shared utility is easier once they exist.

## 3. Approach

### 3.1 Script: `scripts/backfill_paper_topics.py`

One-shot Python script. Run via:

```bash
uv run --with httpx --with pydantic --with anthropic \
  scripts/backfill_paper_topics.py \
  --review   # default: print proposals, ask for confirmation per-paper
  --apply    # alternative: skip review, write all at once (operator override)
```

### 3.2 Flow

```
1. Load topics: SELECT id, name FROM topics ORDER BY weight DESC.
   Halt if zero rows.

2. Load historical read papers:
   SELECT p.id, p.title, p.url, p.abstract
   FROM meetings m JOIN papers p ON p.id = m.paper_id
   WHERE m.type='reading_group' AND m.status='done' AND p.url IS NOT NULL;

3. For each paper:
   a. If p.abstract is NULL, attempt to fetch:
      - Resolve URL to S2 ID (ARXIV:<id> or DOI:<doi>) using the suggest helper's
        URL parsers.
      - GET https://api.semanticscholar.org/graph/v1/paper/<s2_id>?fields=abstract
      - If fetch fails or returns no abstract, mark this paper as "skip — no
        abstract" and continue. Don't tag without an abstract.
   
   b. With paper title + abstract + topics list, call Anthropic API with the
      same prompt template the suggest spec's pick step uses. Get back a list
      of topic names.
   
   c. Validate names against the topics list (case-insensitive). Discard
      hallucinations.

4. --review mode (default):
   For each paper, print:
     [Paper: "<title>"] proposed topics: <names>
     Accept (y), edit (e), skip (s), abort (a)?
   
   Operator can:
   - y: accept proposed topics
   - e: type a comma-separated list of topic names (validated against topics list)
   - s: skip this paper (no rows inserted)
   - a: abort the whole backfill (no rows committed yet)

5. --apply mode (operator override):
   No interactive review. Validated names auto-accepted.

6. After all 18 papers processed (or operator aborts):
   Single transaction:
     INSERT INTO paper_topics (paper_id, topic_id)
     SELECT $paper_id, t.id FROM topics t WHERE t.name = ANY($validated_names)
     ON CONFLICT (paper_id, topic_id) DO NOTHING;
   COMMIT.

7. Print summary:
   Tagged N papers with M total (paper_id, topic_id) rows.
   Skipped P papers (no abstract or operator-skipped).
   Audit log entry: INSERT INTO command_log (...) VALUES (...).
```

### 3.3 Abstract availability for the historical 18

Open question to resolve during implementation: are `papers.abstract` fields populated for the 18 historical readings? The CSV `docs/superpowers/specs/wids-zotero-historical-readings.csv` doesn't have an abstract column, so the original Zotero import almost certainly didn't backfill abstracts. **Expected state: most or all 18 historical papers have `abstract IS NULL`.**

This means step 3a (fetch abstracts via S2 API) runs for ~14 of 18 (the resolvable ones); the 4 with non-arXiv/non-DOI URLs (Google PDF, Nature, MLR proceedings, USFCA PDF) will have `abstract IS NULL` and no way to fetch — they're skipped. Same coverage as the suggest spec's positive-paper resolution.

If we want to recover abstracts for those 4, options are:

- Scrape the PDF directly (out of scope for V1 backfill — fragile)
- Operator manually pastes abstract into a CSV input file (heavyweight but reliable)
- Skip them and accept partial coverage (recommended; same pattern as suggest)

### 3.4 Idempotency

The `ON CONFLICT (paper_id, topic_id) DO NOTHING` clause makes re-running the backfill safe — already-tagged rows are no-ops. If the operator wants to *replace* existing tags (e.g., topics list changed), that's a different operation: `DELETE FROM paper_topics WHERE paper_id IN (...)` first, then re-run. Not built into the script; manual SQL.

## 4. Failure modes

| Failure | Visibility |
|---|---|
| `topics` table empty | Halt before any work: "No topics. Run `/wids-bootstrap` first." |
| All 18 papers have `abstract IS NULL` and no resolvable URL | Halt with message: "No paper has fetchable abstract. Either populate `papers.abstract` manually or wait until S2 indexing covers more sources." |
| S2 API down for abstract fetches | Skip affected papers with warning, continue with the rest. Operator can re-run later for those. |
| Anthropic API down or rate-limited | Halt with clear error. Topic-picking is the bottleneck; partial backfill is acceptable on retry. |
| Operator types invalid topic name in `--review` edit mode | Re-prompt with the validated list and retry; don't silently accept. |

## 5. Testing

This is a one-time operator-driven script — minimal CI testing is appropriate.

- **Pure functions** reused from suggest helper: already covered by suggest's test suite.
- **Backfill-specific logic** (operator review prompt, batch INSERT, idempotent re-run): one pytest integration test with a small in-memory fixture, mocked Anthropic responses.
- **Manual smoke run** during execution: this *is* the test. Operator runs `--review` mode against the 18 real papers, eyeballs each proposal, accepts/edits/skips. The interactive review step is the safety net.

## 6. Out of scope (V2 candidates)

- Re-running the topic-tagging prompt with a stronger / different model and comparing assignments (model A/B for tagging quality).
- Tagging papers in `paper_suggestions` that were never picked — would require a separate "rejection signal" decision.
- A maintenance command that re-runs tagging when the topics list changes.
- Pulling abstracts from PDF text extraction (for the 4 non-S2-resolvable papers).
- A CSV input mode where the operator pre-fills `(paper_id, topics)` rows offline.
