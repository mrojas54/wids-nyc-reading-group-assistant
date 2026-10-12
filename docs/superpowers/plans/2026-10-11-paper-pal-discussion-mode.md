# Paper Pal discussion mode and understanding checks

Status: proposed implementation plan, revised against live reads on October 11,
2026 at approximately 11:02 PM America/New_York. The starting-point reads below are historical; see the live update below.

Local implementation update (October 12): **Supabase is the default retrieval
backend; Turbopuffer is retained for later.** The [Supabase setup guide](../../supabase-passage-search.md)
covers the Node 24 CLI, locally computed GTE-small embeddings, canonical passages,
and hybrid search. Migration 035 and its access policies passed disposable
Postgres tests. Migration 035 was applied to the live project on October 12;
paper 41 now has 119 passages across 26 pages and its Drive link is populated.
[Live verification](../../paper-41-index-verification.md) confirms canonical
readback and RLS. Follow-up local reranking now finds the definition and complete
model list in the top three, including paraphrases. A compact hybrid/keyword
candidate pool passed all 15 checks over three local benchmark rounds, with
1.025-second warm median and 4.593-second p95 retrieval. Production concurrency,
cold model downloads, and broader retrieval quality still need evaluation. Member UI,
complete source provenance, grounded generation, and broader evaluation remain planned. The [Turbopuffer adapter](../../turbopuffer-local.md) remains optional and
hosted connectivity is still unverified.

## Verified starting point

Live Supabase project: `dmyulakudbdegwkqgelx`. Read through authenticated,
service-role PostgREST GET requests; credentials were not printed or saved here.

| Artifact | Observed state |
| --- | --- |
| Paper | `papers.id = 41`, **The Misery of Mechanistic Interpretability: A Formal Perspective** |
| Canonical URL | `https://arxiv.org/abs/2609.15533` |
| Semantic Scholar identifier | `ARXIV:2609.15533` |
| Database Drive link | `papers.pdf_drive_url IS NULL` |
| Drive PDF | [paper.pdf](https://drive.google.com/file/d/1ow5nbrsflTHuxqXKlWFlQ_FrCynMPiIX/view), 714,722 bytes, `application/pdf` |
| Drive folder | `WiDS NYC AI Reading Group/cycles/2026-10-meeting/` |
| PDF identity | Readable PDF text identifies the same title and arXiv `2609.15533v1` |
| Cached embeddings | GET `paper_embeddings` filtered to `paper_id=41`, without a model filter, returned **zero rows** |
| Companion | One `paper_companions` row, Gemini / `gemini-2.5-pro`, generated October 2, 2026 at 7:50 PM ET; regeneration count 1 |
| Existing learning content | **4 multiple-choice questions**, **3 Socratic prompts** |
| Existing citation metadata | 7 terminology entries have `sourcePage`; **zero** entries have a nonempty `sourceQuote` |
| Meeting | `meetings.id=42`, `reading_group`, `scheduled`, October 28, 2026 at 7 PM ET |

This confirms a missing database link and a missing whole-paper embedding cache
entry for this paper. It does not prove the absence of indexes in other services.
The earlier companion predates this Drive upload; title/arXiv agreement does not
prove that its synthesis input was byte-identical to this PDF. Drive's connector
did not return a checksum/version in the metadata response, so compute a hash
from the downloaded bytes during indexing.

## Reuse decisions

- Use the existing Drive PDF. No member re-upload is required.
- Keep the existing companion, quiz, diagrams, and three Socratic prompts.
  Do not regenerate the companion as a prerequisite for discussion mode.
- Reuse the current member authentication, paper page, assessment layout, lens
  selection, provider test patterns, and shared Edge Function authorization.
- Keep the existing SPECTER2 recommendation pipeline. Its ONNX implementation
  embeds title plus abstract, truncates at 512 tokens, and outputs 768-dimensional
  vectors. Its parity checks test agreement with Semantic Scholar embeddings,
  not question-to-passage retrieval quality.
- Use the existing Supabase project for canonical passages and pgvector + keyword
  search now. Keep Turbopuffer behind the backend selector for a later decision.
  Supabase also owns citation provenance, member access, and conversation state.
- Keep passage vectors in a new, versioned index. Do not place them in the
  whole-paper `paper_embeddings` cache or compare incompatible model spaces.

## 1. Reconcile the source and index paper 41

The exact proposed database correction is one `papers` row: set
`pdf_drive_url` to the verified Drive file URL, conditional on `id=41` and the
value still being NULL. Re-read before applying; preserve any subsequently
populated link. Completed October 12: the link was populated conditionally and read back.

Migration 035 adds source/version and passage records with explicit grants and RLS:

- `paper_passage_sources`: paper ID, immutable source version, embedding model,
  passage count, and indexing timestamp. The source version hashes PDF bytes,
  exact extracted pages, and extraction/chunking versions.
- `paper_passages`: immutable passage ID, source version, physical PDF page,
  exact extracted text and offsets, 384-dimensional vectors, and English full-text
  search. An atomic service-role RPC inserts the complete source; authenticated
  search uses caller RLS for attendees, the meeting leader, and operators/admins.
- Still needed: a durable source association containing Drive file ID, canonical
  link, PDF SHA-256, extraction coverage/readiness, and an active-version pointer.
  Preserve the prepared manifest; the minimal indexed source row does not store
  the complete extraction provenance. Conversation sessions must pin a version.

Begin with an explicit indexing operation for this known file. Download via an
authorized backend connection, hash bytes, extract text page by page, and keep
stable passage boundaries. The existing Drive fetch exposed extraction artifacts
around hyphenation and formulas: test normalization and inspect those pages.
Unsupported figure/table-only evidence must be marked as a coverage limitation.

Unchanged bytes and extraction/model versions should reuse the existing index.
The current Supabase RPC imports a complete source atomically, treats its text
and passage boundaries as immutable, and makes identical retries idempotent.
Publish the active version only after extraction, indexing, and coverage review
succeed. Authorize member access before returning excerpts or links. Keep search
credentials server-side; define retention and source deletion before production.

The implemented local model is quantized `Supabase/gte-small`, pinned to revision
`93b36ff09519291b77d6000d2e86bd8565378086`, with mean pooling, normalization,
and 384 dimensions. The CLI chunks at 1,000 characters and rejects input over the
512-token window rather than silently truncating. Evaluate it on questions with
known supporting passages from this PDF; SPECTER2 parity is not retrieval quality
evidence. A different embedding model requires a new versioned schema/index.
If Turbopuffer is activated later, keep canonical passages in Supabase and add
external indexing jobs/readiness before routing member queries to it.

The missing `specter_v2` cache entry is a separate recommendation-cache task.
Existing admin backfill code can be reviewed for a bounded paper-41 operation;
do not invoke a broad backfill automatically. Filling that cache is not required
to answer questions using full-text passages.

Acceptance: the PDF resolves to paper 41; page references reproduce the stored
excerpts; a changed source cannot rewrite old citations; repeat indexing is
idempotent. No companion regeneration.

## 2. Add cited discussion

Add `Discuss this paper` to the existing dashboard and an `analyze-discussion`
handler. The implemented Node/ONNX adapter fits a Node server route; if the
handler runs in a Supabase Edge Function, add a tested runtime-compatible
embedding boundary rather than importing the Node adapter into Deno. Use a
retrieval contract such as
`retrievePassages({paperId, sourceVersionId, question, limit})` with the Supabase
adapter by default and optional Turbopuffer selection. Combine lexical and vector retrieval, then add neighboring
passages within a bounded context budget. Apply paper/source filters on both
retrieval paths. For broad summary questions on a short paper, bounded full-source
context is also possible.

Authorize the member before searching. Resolve returned passage IDs against
Supabase (already returned by the Supabase adapter) and revalidate paper/source membership before building model context
or citations; search results do not establish access rights or provenance.

The server loads authorized source passages and persisted history. The browser
submits session ID, request ID, and a message; it does not supply authoritative
paper text, citations, rubric, or turn counters.

Use Responses API with a configurable model for the initial grounded-answer
and assessment operations. Select the API model against current official model
documentation and the paper-specific evaluation before implementation; do not
assume a Codex model label is an API model identifier. Add a narrow OpenAI adapter without changing the
Gemini/Claude synthesis dispatch. Validate structured responses with shared Zod
schemas. Log model/prompt versions, token usage, and latency.

An answer consists of claim/interpretation blocks with passage IDs and quotes,
plus an explicit insufficient-evidence result. The server checks source ownership,
exact normalized quote matches, and required citation presence, then supplies page
labels and links. Display a complete validated answer initially. A citation drawer
shows the original excerpt and an `Open original in Drive` link; do not assume
Drive links can navigate reliably to a PDF page.

Quote validation proves provenance, not semantic support. Evaluate claim support
separately with human-labeled examples. Ask for clarification or abstain when the
retrieved evidence does not support an answer.

Acceptance: paper-specific answers have supporting excerpts; fabricated citations
and other-paper passages are rejected; follow-ups retain context; unsupported
questions abstain without presenting missing evidence as a negative finding.

## 3. Extend existing understanding checks

Expose all three existing Socratic topics instead of always selecting index zero.
Use the existing four MCQs as a baseline and the three prompts as candidate
learning objectives. Validate each against this PDF before treating it as a rubric.

Add `Test my understanding`: a short session covering explanation, application,
and limitations. Each item has a server-held expected-concepts rubric, acceptable
alternative explanations, misconceptions, evidence IDs, hints, and final explanation.
Keep rubric/answer state out of browser-readable records until reveal.

Feedback reports demonstrated concepts, missing concepts, and a targeted follow-up
with citations when feedback is revealed. Distinguish independent success,
hint-assisted success, and revealed answers. `I've got it` requests an explanation;
it does not certify understanding. Return an unassessable result if source evidence
or rubric quality is inadequate. Preserve existing MCQ practice.

Acceptance: correct paraphrases pass; keyword-only misconceptions do not; hints
are gradual; feedback is grounded; revealing an answer is distinct from passing.

## 4. Sessions, transport, and access

Add member-owned sessions and turns, bound to paper/source version, with unique
request IDs and server-controlled sequencing. Store server-only rubric state in
an unexposed schema or equivalent server-only store, separate from member-readable
turns. Local storage may hold a draft, scoped to member and source version; it must
not be authoritative conversation history.

Preserve the current AI gate for the initial release: operator/admin, meeting
leader, or attending RSVP for a meeting using the paper. Show eligibility before
input. Apply RLS and explicit grants to new exposed tables, including owner-only
session/turn reads. Recheck authorization before privileged writes and retrieval.

Use an explicit Supabase function URL or a tested server proxy. The current JSON
client uses relative `/functions/v1/...` paths, while synthesis uses an absolute
Supabase URL; no matching repository rewrite was found. Verify actual preview
routing before reusing the client unchanged.

Bound request size, history, context, provider timeout, and per-member usage.
Deduplicate retries; preserve drafts on failure. A failed persistence operation
must not be reported as a successfully saved/resumable turn.

## Delivery and verification

1. **Sources PR:** finish durable source provenance, active-version readiness,
   and October-paper retrieval tuning/evaluation. Migration 035 is applied and
   the 119-passage index is live; canonical readback and RLS checks passed.
   Local adapters, atomic ingestion, and migration/RLS tests are implemented.
   Review the single-row link correction separately.
2. **Discussion PR:** model adapter, sessions, retrieval, citation renderer,
   authorization/transport and error tests.
3. **Understanding PR:** topic selection, server-held rubrics, assessment feedback,
   hint/reveal semantics and UI tests.
4. **Pilot:** use this October paper and existing companion. Review cited answers
   and learner feedback; measure retrieval recall, citation support, abstention,
   grading agreement, latency, and cost. Expand the evaluation corpus afterward.

Follow RED → GREEN → VERIFY → DOCS with separate commits. Review fixture wording
before execution. Run web lint/typecheck/full Vitest in `web/`; Edge Function
check/lint plus handler behavior tests in `supabase/functions/`; test database
allow/deny paths against an isolated database. Run repository-required Python
checks from root if Python is changed, resolving the documented mypy requirement
versus current CI's `ty` configuration before implementation.

Important cases: fabricated quotes, mixed source versions, equations with poor
extraction, inaccessible files, cross-member access, changed paper/source, duplicate
requests, incomplete model outputs, network failure, keyboard/mobile citation
navigation, and source updates during a conversation. Keep deployment and live
mutations separate from this plan; follow the repository's explicit-confirmation
rules for protected operations.

## Source references

- `web/app/papers/[id]/page.tsx`
- `web/components/paperpal/assessment/AssessmentPanel.tsx`
- `web/components/paperpal/assessment/SocraticMode.tsx`
- `supabase/functions/analyze-socratic/index.ts`
- `supabase/functions/_shared/gate.ts`
- `web/lib/paperpal/providers/types.ts` and `prompts.ts`
- `web/lib/suggest/specter2-wasm.ts` and `embedding-cache.ts`
- `web/app/api/admin/backfill-embeddings/route.ts`
- `migrations/010_paper_embeddings.sql`, `013_paper_companions.sql`,
  `016_paper_pal_provider_metadata.sql`, `033_paper_embeddings_grants.sql`
- [Existing ONNX plan](2026-05-09-vercel-suggest-wasm-specter2-implementation.md)

This updates the discussion-mode proposal from this conversation. The older
`2026-05-16-paper-pal-discussion-board-handoff.md` describes a member discussion
board and remains a separate feature. Initial inspection used `alert-fix-1` at
`0484f0c`. The local Turbopuffer implementation subsequently started on
`codex/turbopuffer-local` from refreshed `origin/main` at `aef9fe6`, preserving
the existing untracked files. Refresh main again before the remaining feature work.
