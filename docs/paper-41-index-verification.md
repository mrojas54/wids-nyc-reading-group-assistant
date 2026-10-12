# October paper: live Supabase indexing verification

Completed October 12, 2026 (America/New_York) in Supabase project
`dmyulakudbdegwkqgelx`, following explicit operator authorization to apply
migration 035 and index the October Drive paper.

## Applied and indexed

- Applied the unchanged `migrations/035_paper_passage_search.sql` using
  `supabase db query --linked --project-ref dmyulakudbdegwkqgelx --file ...`.
  This executes the transaction without adding a migration-history row. Check
  the actual objects before attempting any future replay.
- Downloaded [paper.pdf](https://drive.google.com/file/d/1ow5nbrsflTHuxqXKlWFlQ_FrCynMPiIX/view)
  from Drive after account access was resolved. PDF metadata confirms **The Misery
  of Mechanistic Interpretability: A Formal Perspective**, 26 pages, 714,722 bytes.
- Filled `papers.pdf_drive_url` for paper 41, conditional on the value still being
  NULL. The returned row and subsequent independent read confirm the exact link.
- Indexed **119 passages covering pages 1–26**, with local GTE-small embeddings,
  384 dimensions, and the pinned model `gte-small-93b36ff-mean-normalized-v1`.
- Database indexing timestamp: `2026-10-12T04:17:42.644966Z` (12:17 AM EDT).

PDF SHA-256:
`9bc6de9ef9791d1edeec85f1b45a43df1d6cf851c1310a2d4f3c0cb21a7226ce`

Indexed source version (1,000-character chunks):
`4c8ac0dba78dafdda3238847e67e1b812e4c474a19ac16272e327c50fc5a38b6`

## Verification evidence

Independent REST readback compared **every stored passage** against the local
manifest: IDs, page numbers, exact text, and start/end offsets all matched.
Database readback confirmed 119 vectors of 384 dimensions across all 26 pages.

Both new tables have RLS enabled and authenticated SELECT policies. All three
new functions are SECURITY INVOKER. Grant checks confirmed anonymous reads,
member inserts, and member ingestion-RPC execution are denied; the service role
can execute ingestion. A rolled-back live role test confirmed the actual linked
meeting leader sees all 119 passages and an unlinked authenticated identity sees
zero. No member records were created or changed for this test.

The security advisor reported no warning against the new passage tables or
functions. Its warnings concern the already-existing public-schema vector
extension, existing SECURITY DEFINER member/gate/availability helpers, and Auth
leaked-password protection. Those settings were not changed.

Three live REST retrieval probes completed and returned canonical excerpts:

| Question | Observed top results | Assessment |
| --- | --- | --- |
| How is the faithfulness gap defined? | Chart fragments on pages 24–26 | Poor definition retrieval; ranking needs work. |
| What does verification-aware training improve? | Relevant page-6 passages; supporting page-21 result | Useful evidence, although chunk boundaries split a caption. |
| Which model families were evaluated? | Related discussion on pages 3, 8, and 1 | Top results do not directly enumerate the model families. |

This confirms storage, embeddings, RPC connectivity, canonical provenance, and
access controls. It does **not** establish answer quality or launch readiness.
Before enabling cited discussion, tune extraction/chunk boundaries and retrieval
ranking on a labeled question set. Formula and chart layout remains lossy in
text extraction; image-only evidence needs a separate path.

Local PDF, manifest, vectors, and retrieval probe output are retained under the
ignored `web/.paperpal-local/` directory. They are not committed to Git. The
existing companion, SPECTER2 recommendation cache, and Turbopuffer setup were not
changed. Member discussion and understanding-check UI remain planned.


## Retrieval tuning after the initial import

The Node Supabase adapter now reranks a wider scoped candidate set with a pinned,
local MiniLM cross-encoder. Definition questions also prioritize an explicit
numbered definition when the model finds it relevant and it shares a substantive
question term. Canonical passages and the existing live source version remain
unchanged; no reindex or database migration was needed. Direct calls to the
Supabase hybrid RPC still return first-stage rankings.

| Question | Before: top three | After: supporting evidence |
| --- | --- | --- |
| How is the faithfulness gap defined? | Chart fragments on pages 24–26 | Formal definition on page 4 at rank 1; bound/gap explanation on page 5 at rank 3. |
| Which model families were evaluated? | Related prose without the complete list | Complete five-model list on page 1 at rank 2; also present in the page-9 conclusion at rank 3. |
| What does verification-aware training improve? | Useful page-6 evidence | Relevant page-6 evidence remains rank 1. |
| What is the definition of faithfulness? | Not measured | Formal definition on page 4 at rank 1. |
| Which language model families does the paper study? | Not measured | Complete list on page 2 at rank 2. |

The evaluation accepts the abstract, contributions, or conclusion list as valid
model-family evidence; requiring only the abstract would incorrectly reject the
complete list on page 2. These labels are evaluation data, never runtime ranking
rules. The runtime has no paper IDs or paper-specific terms.

Offline verification: 384 tests passed, 1 skipped with two workers; ESLint and
TypeScript checks passed. Earlier full-concurrency runs hit five-second timeouts
under host load; no test timeouts were relaxed. The five-case opt-in evaluation
is in `web/scripts/evaluate-passage-retrieval.mts` with a source-pinned fixture.
The final live run passed **5/5** checks.

Local CPU timings in the first five-query run ranged from about 12 to 31 seconds
per query. That is a material interactive-latency limitation; benchmark and
optimize the model-serving path before member rollout. The small evaluation
establishes supporting evidence in the top three for these questions, not broad
answer accuracy or consistently correct rank-one results.


## Interactive retrieval performance follow-up

Profiling identified local cross-encoder reranking as the main cost. A fresh
five-question baseline took 4.94–11.95 seconds end to end, of which
4.79–9.23 seconds was reranking 64 candidates. The earlier 12–31-second timings
above were a separate run and illustrate the sensitivity to host conditions.

The adapter now combines eight hybrid results with up to eight scoped keyword
results before reranking. In these five cases the union contained 11–15 unique
passages. Keyword lookup overlaps embedding; the original question and pinned
models remain unchanged. No migration, reindex, or stored-passage change was
required. Canonical scope and excerpt validation covers both candidate sources,
and both requests use the same caller credentials.

The read-only benchmark ran each question three times against the live Supabase
index using operator credentials. **15/15 evidence checks passed.**

| Measurement | Observed local result |
| --- | --- |
| First request, fresh process with cached model files | 1.710 seconds |
| Warm median, 14 requests | 1.025 seconds |
| Warm p95, 14 requests | 4.593 seconds |
| Warm range | 0.906–4.593 seconds |

The definition remains rank 1 on page 4, with the gap explanation on page 5 at
rank 2. The direct model-family question finds the complete list on page 1 at
rank 2 and page 2 at rank 3; its paraphrase now finds page 2 at rank 1. The
training question keeps page-6 evidence at rank 1, and the definition paraphrase
keeps page 4 at rank 1. All three rounds retained these results.

Offline verification: **390 tests passed, one skipped**, plus ESLint and
TypeScript checks. New tests cover phrase construction, negation fallback,
scoped caller authorization, overlapping candidate deduplication, conflicting
canonical excerpts, and lexical authorization failures.

This supports interactive use of the measured questions locally, with remaining
tail latency in model inference. It does not establish a production SLA or broad
retrieval recall. Negated and long questions use the wider, slower candidate
path; fresh model downloads and concurrent server requests remain unmeasured.
The discussion UI is still planned.
