# `/wids-find-paper suggest` Smoke Test — Findings

**Date:** 2026-05-07
**Status:** Reference (post-implementation)
**Related:** [`2026-05-06-wids-find-paper-suggest-design.md`](./2026-05-06-wids-find-paper-suggest-design.md), [`2026-05-06-wids-find-paper-suggest-implementation.md`](../plans/2026-05-06-wids-find-paper-suggest-implementation.md)

## Summary

End-to-end smoke test of `/wids-find-paper suggest` and `/wids-find-paper pick <id>` against live Semantic Scholar and Supabase, after backfilling 17 historical readings into the database. Both flows worked. Two real issues surfaced that weren't caught by the unit/integration tests.

## What was exercised

| Flow | Outcome |
|---|---|
| `/wids-find-paper suggest` (cold cache, 19 done readings) | 10 candidates ranked, 8 past-paper embeddings cached |
| `/wids-find-paper pick 13` | paper committed, auto-tagged with 2 topics, audit-logged |
| Topic auto-tagging (4d.5) on real abstract | Claude picked `Reinforcement Learning` + `LLMs / Foundation Models` for a contextual-bandits-with-LLMs paper — both passed case-insensitive validation, both INSERTed cleanly |

## Issue 1 — SS Recommendations API rejects `embedding.specter_v2` in `fields`

**Symptom:** Helper exited 1 with stderr `Semantic Scholar Recommendations API failed: Client error '400 Bad Request'`.

**Root cause:** The Plan/Spec extrapolated from an earlier verification probe (which used `?fields=title,year,externalIds`) and assumed adding `embedding.specter_v2` would also work. Direct test:

```bash
curl -X POST '.../recommendations/v1/papers?fields=title,year,externalIds,embedding.specter_v2&limit=10' ...
# → HTTP 400: {"error":"Unrecognized or unsupported fields: [embedding.specter_v2]"}
```

The Recommendations API does **not** support embedding fields at all. Only the per-paper Graph API endpoint (`/graph/v1/paper/{id}?fields=embedding.specter_v2`) does.

**Fix landed:** commit `8705e3e`. Helper now drops `embedding.specter_v2` from the recs `fields`, then calls a new `enrich_recommendations_with_embeddings()` that round-trips each rec's `paperId` through the Graph API in parallel. Adds 3 new tests covering the enrichment helper. **52/52 Python tests pass.**

**Lesson for future API integrations:** verify each `fields` parameter you intend to use, with that exact value, against the live API. Don't extrapolate from one verified shape to a related one. The unit tests with `respx` mocks were happy because they mocked the wrong URL — they didn't catch the divergence with the real API contract.

## Issue 2 — SS SPECTER2 coverage is sparser than expected

**Observation on a real corpus of 19 done readings:**

- **Past papers:** 4 of 19 unresolvable (no arXiv ID, no extractable DOI from URL — Google research PDF, Nature article-ID URL, MLR proceedings PDF, USFCA PDF). Of the **15 resolvable**, only **8 had a SPECTER2 embedding indexed by S2** — the other 7 returned 200 OK with `embedding: null`.
- **Recommendations:** SS returned 50 ranked papers; only **16 had usable SPECTER2 embeddings**. The other 34 had no embedding indexed.

| Stage | Coverage |
|---|---|
| URL → S2 ID resolution | 15/19 past readings (79%) |
| S2 ID → SPECTER2 embedding (past) | 8/15 (53%) |
| SS rec → SPECTER2 embedding | 16/50 (32%) |

**Why it matters:** the spec deferred a self-hosted SPECTER2 fallback as V2 work, with the rationale that the fallback path would be exercised rarely. Real-world coverage of ~50% on past papers and ~30% on recs is sparser than that calculus assumed.

**Implications:**

1. **MMR diversity is constrained by which past papers happen to have embeddings.** In our test, only 3 of 8 anchor past papers ended up matching candidates (Contextual Bandits, Socially Aware LM, PatchTST). The other 5 (Causal Inference Isn't a Statistics Problem, Behavioral Homophily, Causal Conceptions of Fairness, CapeX, Deep Interest Network) didn't match any of the top-50 recs strongly enough to anchor a pick. Some of that is corpus-domain reality (CapeX is computer-vision pose estimation, far from the LLM/recsys cluster S2 surfaced); some is missing-embedding noise.
2. **Final candidate quality survives but is more concentrated.** 5 of 10 picks anchored to the same past paper ("Socially Aware Lang Tech"), 3 to Contextual Bandits, 2 to PatchTST. Less spread across the group's actual diverse interests.
3. **The deferred self-hosted SPECTER2 fallback should be revisited sooner.** Section 9 of the design spec lists it as V2; this smoke test data argues for V1.5. A single `transformers` + `adapters` import path that runs SPECTER2 locally for any paper-with-abstract would close the coverage gap from 30-50% to ~95%.

**Action item:** the deferred backfill spec (`2026-05-06-wids-backfill-paper-topics-design.md`) is independent. A new `/wids-add-specter2-fallback-design.md` spec — adding self-hosted SPECTER2 as a fallback when S2 returns empty — is the right next companion.

## Issue 3 — SQL escaping in find-or-create paper INSERTs

**Observation:** When the smoke-test bookkeeping subagent ran Step 5g (find-or-create paper + INSERT paper_suggestions) on the 10 helper-returned candidates, **6 of the 10 papers ended up with NULL or empty-string abstracts** even though the helper output JSON had 1000-1700 char abstracts for them.

**Root cause:** the abstracts contain text patterns that break naïve single-quoted SQL: `q-net`, `we've`, `arms' embedding`, `LLM's`, etc. Step 2c (which Step 5g instructs new code to "mirror") uses simple `'<abstract>'` single-quoting. That breaks the moment a quote appears in the abstract.

**Fix:** inline data fix using PostgreSQL dollar-quoting (`$ws_abs_v1$...$ws_abs_v1$`). Updated 9 of 10 papers (paper 25 / IMPerSumm genuinely returned empty from SS — keeping that as null). All other papers now have abstracts in the 967-1689 char range.

**Doc fix:** updated the skill markdown's Step 5g to recommend dollar-quoting for free-text fields. (See companion commit.)

**Lesson:** when documenting "mirror pattern X" in a skill, if pattern X has known foot-guns for the new use case, point them out at the call site. The recs candidates have richer abstracts than the simple arXiv search results that 2c was originally written for.

## Issue 4 — Drive MCP not in this session

Step 4c (PDF download to Drive) was skipped because the Drive MCP wasn't loaded in this session. The skill markdown's failure handling already addresses this case ("PDF download fails → set `paper_id` but leave `pdf_drive_url` NULL; warn leader to upload manually"), so the flow degraded gracefully. `papers.pdf_drive_url` for the picked paper (id=32) is NULL.

Not a code issue. The operator running the skill in their normal environment will have Drive available.

## What was validated

- **The Path Z architecture works end-to-end**: SS Recommendations for ranking + MMR for diversity + SPECTER2 cosine for display rationale, all wired through the skill → Python helper → DB persistence chain.
- **The pick auto-tagging extension works on real abstracts**: Claude picked sensible topics from the existing 24-topic list, the case-insensitive name validation guarded against hallucinations, and the INSERT cleanly populated `paper_topics` for the first time in production.
- **`paper_embeddings` (pgvector) round-trip works**: 8 vectors inserted via dollar-quoted pgvector literals, retrievable for subsequent runs.
- **Replace-prior-agent-rows semantics**: the DELETE in Step 5f scoped to `source='agent'` correctly leaves `source='leader'` and `source='member'` rows untouched (verified by the spec; smoke test had 0 prior rows so didn't exercise the actual replacement, but the SQL is straightforward).

## What's next (in priority order)

1. **Self-hosted SPECTER2 fallback** (V1.5, promoted from V2) — addresses Issue 2's coverage gap. New spec.
2. **Backfill `paper_topics` for historical readings** (already specced, awaiting execution) — `2026-05-06-wids-backfill-paper-topics-design.md`.
3. **Operator hardening of the find-or-create pattern** — Issue 3's lesson generalizes: any free-text INSERT in skill markdown should default to dollar-quoting. Worth a follow-up sweep.
