# Vercel-Deployed Suggest with WASM SPECTER2 Fallback

**Status:** Draft — pending review
**Date:** 2026-05-09
**Owner:** Michelle (operator)
**Supersedes for deployed path:** [2026-05-06-wids-find-paper-suggest-design.md](2026-05-06-wids-find-paper-suggest-design.md) (which remains authoritative for the operator-laptop CLI path)

## Summary

Move the existing operator-only Python `find_paper_suggest.py` to a leader-facing Vercel route, with an in-process WebAssembly SPECTER2 fallback that activates whenever the Semantic Scholar Graph API doesn't return an embedding for a paper. Single Vercel deployment, no separate inference service, no third-party embedding API. Reuses the existing `paper_embeddings` Supabase table without schema changes.

## Goals

- Leaders can pick a paper without operator help, via a web UI gated to their role.
- The recommender keeps working when Semantic Scholar is missing an embedding (new arXiv preprints), returns 404 (not in S2 corpus), or is transiently unavailable (5xx, timeout, 429).
- Auth misconfigurations and malformed requests surface as errors rather than being silently masked by the fallback.
- Hard 30 s end-to-end client timeout; cold start ≤ 15 s; warm path ≤ 8 s.
- One-time-cost fallback per paper: WASM-generated vectors are cached in Supabase under the same `model = 'specter_v2'` id as S2-generated ones, because the local model produces vectors in the same space (cos ≥ 0.997 against S2).

## Non-goals

- Member-facing live similarity (latency budget too tight for cold starts).
- ANN indexes on `paper_embeddings` — corpus is low-thousands, brute force in memory is fine.
- Multi-model embedding support beyond SPECTER2 (schema is multi-model-ready, route is not).
- Replacing the existing `/wids-find-paper` Claude Code skill — it stays as the operator-laptop fast path.
- Streaming responses, background queues, scheduled cron pre-warming.

## Locked decisions

| Axis | Decision | Why |
|---|---|---|
| Use case | (D) Leader-facing tool, auth-gated, multi-user | Pick policy 5 |
| Vercel runtime | (δ) Node serverless function with transformers.js WASM in-process | Single deployment, no external inference service |
| Model variant | `specter2_base` + `specter2` proximity adapter, fused into a single ONNX, INT8-quantized | Same embedding space as S2's `embedding.specter_v2` field |
| Schema | Reuse existing `paper_embeddings` table, single `model = 'specter_v2'` value | Adapter-fused output stays in S2's space within ~0.997 cosine |
| Fallback policy | (3) Aggressive with carve-out: fall back on null/missing embedding, 404, 5xx/408/429/timeout; surface 401/403/400 | Resilient to S2 outages; auth/config errors stay visible |
| Batch ceiling | `candidate_paper_ids.length ≤ 10`; past picks unbounded (cache hit rate keeps WASM batches small in practice). WASM forward pass chunks to ≤10 per call if more are needed. | Corpus is low-thousands; candidates per session are small; past picks normally pre-cached |
| Timeout | 30 s client-side abort, 60 s Vercel `maxDuration` | Hobby plan ceiling; 30 s leaves cleanup headroom |
| Vercel plan | Hobby | Operator's current plan |
| URL | `/admin/suggest` | Matches existing admin-tool mental model |
| ONNX export tool | `scripts/export_specter2_onnx.py` | Python-only ecosystem; one-time tool |
| `/wids-find-paper` skill | Keep as Python CLI post-launch | Two-tool option is honest about offline cases |

## Architecture

### Hosting topology

```
┌──────────────────────────────────────────────────────────────┐
│  Vercel project (existing web/)                              │
│                                                              │
│  app/admin/suggest/page.tsx       ← Next.js page (RSC)       │
│  app/admin/suggest/SuggestForm.tsx← Client component (UX)    │
│         │                                                    │
│         │ POST /api/suggest                                  │
│         ▼                                                    │
│  app/api/suggest/route.ts         ← Node runtime, NOT edge   │
│   ├─ lib/suggest/s2-client.ts        Semantic Scholar HTTP   │
│   ├─ lib/suggest/specter2-wasm.ts    transformers.js loader  │
│   ├─ lib/suggest/mmr.ts              ranking math            │
│   ├─ lib/suggest/embedding-cache.ts  Supabase read/write     │
│   └─ lib/suggest/orchestrator.ts     hybrid policy           │
└──────────────────────────────────────────────────────────────┘
                       │                  ▲
                       │                  │ model weights (cold start only)
                       ▼                  │
              Semantic Scholar       Vercel Blob
                Graph API           └─ specter2_int8.onnx (~110 MB)
```

### Module boundaries

Each module is independently testable, has a single responsibility, and exposes a narrow public surface.

| Module | Responsibility | Public surface |
|---|---|---|
| `s2-client` | Fetch paper metadata + embeddings from Semantic Scholar Graph API. Classify responses into discriminated union. Retry transient errors once. | `getPaperWithEmbedding(id) → S2Result` where `S2Result = {kind:'hit', vector, title, abstract} \| {kind:'fallback_needed', reason, title, abstract} \| {kind:'error', status, message}` |
| `specter2-wasm` | Lazy-load ONNX model from Vercel Blob with SHA-256 integrity check. Module-scope cache. Batch inference. | `embedBatch(texts: string[]) → Float32Array[][]`; `getModel()` returns cached promise |
| `mmr` | Maximum Marginal Relevance ranking. Pure function, no I/O. Direct port of [find_paper_suggest.py:151](../../../scripts/find_paper_suggest.py:151). | `mmr(queryVec, candidateVecs, lambda, k) → indices[]` |
| `embedding-cache` | Read past-paper vectors from Supabase; bulk write fallback-generated ones with `INSERT ... ON CONFLICT DO NOTHING`. | `getCached(paperIds: number[]) → Map<number, vector>`; `cacheMany(rows: {paperId, vector}[]) → void` |
| `orchestrator` | The hybrid state machine — try cache, then S2, then WASM fallback per the policy table. | `suggest(req: SuggestRequest) → SuggestResponse` |

### Two-spaces problem and the single-space resolution

SPECTER2 is `specter2_base` + a swappable adapter, not one model. S2's `embedding.specter_v2` is generated from `specter2_base` + the `specter2` (proximity) adapter. The off-the-shelf `Xenova/specter2_base` ONNX export on HF Hub ships the base only — its vectors are in a different space than S2's, and cross-space cosine sims are noisy.

**Resolution:** A one-time setup script (`scripts/export_specter2_onnx.py`) loads `specter2_base` + the proximity adapter from HF Hub, fuses them into a single ONNX graph, INT8-quantizes, and outputs `specter2_int8.onnx`. A parity-verification step compares its output against S2's API for ~20 fixture papers, asserting cosine ≥ 0.997. The output is pushed to Vercel Blob and pinned by SHA-256 in code.

After this setup, S2-generated and locally-generated vectors live in the *same* space and are stored under the same `model = 'specter_v2'` id in `paper_embeddings`. No schema migration. No `_local` model id. No atomic-switch logic in the orchestrator.

### Schema (unchanged)

```sql
-- Already exists at migrations/010_paper_embeddings.sql; included here for reference.
CREATE TABLE paper_embeddings (
  paper_id   INT  NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  model      TEXT NOT NULL,
  vector     vector NOT NULL,
  cached_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (paper_id, model)
);
```

All writes from this design use `model = 'specter_v2'`, regardless of whether S2 or the local WASM produced the vector.

## Request lifecycle

```
LEADER → POST /api/suggest
  body: { candidate_paper_ids: number[], past_pick_ids: number[], lambda: number, k: number }

1. Auth
   - getServerSession() → user.id required
   - SELECT role FROM members WHERE id = $1 → must be 'leader' or 'admin'
   - Reject 401/403 otherwise

2. Validation
   - zod parse body
   - Enforce `candidate_paper_ids.length ≤ 10`
   - `past_pick_ids` is unbounded (the orchestrator handles large arrays via cache lookup; WASM only sees uncached papers, and the WASM forward pass chunks to ≤10 per call)
   - Reject 400 with issue list otherwise

3. Cache lookup
   - SELECT paper_id, vector FROM paper_embeddings
       WHERE paper_id = ANY($1) AND model = 'specter_v2'
   - Returns hits (Map) and misses (number[])

4. S2 fetch for misses (parallel, with single retry on 5xx/408/429/timeout)
   - For each miss: GET /graph/v1/paper/{id}?fields=embedding.specter_v2,title,abstract
   - Classify each:
       200 + vector            → s2_hit (write to cache)
       200, embedding null     → fallback_needed
       404                     → fallback_needed
       5xx/408/429/timeout     → retry once, then fallback_needed (reason: 's2_transient')
       401/403                 → throw S2AuthError → 502
       400                     → throw S2RequestError → 502
   - Bulk write all s2_hits to paper_embeddings

5. WASM fallback batch (only if any fallback_needed)
   a. Lazy-load model (singleton promise; first call: 5–15 s, cached for Lambda lifetime)
      - Fetch ONNX from Vercel Blob (3 retries, exponential backoff)
      - Verify SHA-256 against pinned constant; throw ModelLoadError on mismatch
      - Initialize ort.InferenceSession
   b. For each fallback paper: tokenize `${title} [SEP] ${abstract}` (transformers.js tokenizer)
   c. Single batched forward pass → N × 768 vectors
   d. Bulk write to paper_embeddings (model='specter_v2')

6. Run MMR
   - queryVec = mean of past-pick vectors
   - mmr(queryVec, candidateVecs, lambda, k) → ordered indices

7. Build response
   {
     ranked: [{ paper_id, title, mmr_score }, ...],
     diagnostics: {
       cache_hits, s2_fetched, fallback_used,
       cold_start: bool, total_ms
     }
   }
```

The whole pipeline is wrapped in `Promise.race(work, timeout(30_000))` server-side; `maxDuration: 60` provides cleanup headroom past the client-visible abort.

### Idempotency

Every step is safe to retry: cache reads are reads, S2 fetches are GETs, WASM inference is deterministic, Supabase writes use `INSERT ... ON CONFLICT (paper_id, model) DO NOTHING`. A retry on a partially-written batch does not double-insert.

## UX

### Form (server-rendered shell, client-rendered submit state)

```
┌─ Suggest a paper ───────────────────────────────────────────────┐
│  Candidate papers (S2 IDs / arXiv URLs, one per line, max 10):  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ arXiv:2501.12345                                           │ │
│  └────────────────────────────────────────────────────────────┘ │
│  Past picks to compare against:                                 │
│    ⦿ All papers from prior cycles (default)                     │
│    ○ Last 6 months only                                         │
│    ○ Custom selection                                           │
│  λ (relevance vs diversity):  ▢▢▢▣▢  0.6                        │
│              [ Submit ]                                         │
└─────────────────────────────────────────────────────────────────┘
```

### Progress messaging during request

| Elapsed | Message |
|---|---|
| 0–1.5 s | "Querying Semantic Scholar…" |
| 1.5–8 s | (no change) |
| 8–18 s | "Embedding paper(s) locally (first run can be slow)…" |
| 18–30 s | "Still working — cold start can take up to 30 s…" |
| > 30 s | Client aborts; show "Timed out after 30 s. Try again." |

Implemented with stacked `setTimeout`s and an `AbortController`, all cleared on success or error. See Section 3 of the brainstorming transcript for the full client snippet.

### Error states (status → user-visible message)

| Status | Message shown |
|---|---|
| 400 | "Request invalid: <issue list>" |
| 401/403 | "You're not authorized to use this tool." |
| 502 (`s2_auth`) | "Semantic Scholar API key issue — contact the operator." |
| 502 (`s2_unreachable_fallback_failed`) | "Semantic Scholar is unavailable and the local fallback also failed. Try again later." |
| 502 (`wasm_model_load_failed`) | "Couldn't load the local embedding model. Try again." |
| 504 | "Timed out after 30 s. Try again." |
| 500 | "Something went wrong." |

## Error handling and integrity

### Retry policy summary

| Failure | Retry? | Then what? |
|---|---|---|
| S2 5xx / 408 / 429 / network timeout | Once, 500 ms backoff | Route to WASM fallback |
| Vercel Blob fetch on cold start | Up to 3 times, 1 s / 2 s / 4 s backoff | Throw `ModelLoadError` → 502 |
| ONNX SHA-256 mismatch | No | Throw `ModelLoadError` → 502 |
| Supabase write | No (idempotent on conflict; retry would be safe but unnecessary) | Bubble error → 500 |
| WASM inference exception | No | Bubble error → 500 |

### SHA-256 integrity pin

```ts
// The literal value is filled in during Phase 1 step 6 (after the operator
// runs the export script and computes the SHA of the resulting ONNX file).
// It is intentionally absent from this spec because the spec does not pin
// a specific binary — it pins the *invariant* that the running code's hash
// must equal a constant that was computed from the file actually pushed to Blob.
const EXPECTED_MODEL_SHA256 = '<filled in during Phase 1, committed alongside the export>'
const buf = await fetchFromBlob(MODEL_URL)
if (await sha256(buf) !== EXPECTED_MODEL_SHA256) {
  throw new ModelLoadError(`integrity mismatch`)
}
```

When the operator re-quantizes and pushes a new model to Blob, the SHA constant is updated in the same commit. Mismatch fails loud rather than silently shifting the embedding space.

## Observability

One structured log line per request, JSON-shaped, surfaced via Vercel's built-in log viewer:

```ts
log({
  event: 'suggest_request',
  request_id, user_id,
  candidate_count, past_pick_count,
  cache_hits, s2_fetched, s2_errors, fallback_used,
  cold_start, total_ms,
  outcome, error_code?
})
```

Filter `event:suggest_request fallback_used:>0` for fallback usage; `cold_start:true` for cold-start frequency; `outcome:error` for failures. No metrics service, no alerting, no distributed tracing — YAGNI for a tool used ~weekly by ≤5 leaders.

## Testing strategy

| Layer | Tool | What | When |
|---|---|---|---|
| Unit | vitest | `mmr`, `s2-client` classification, `embedding-cache` CRUD, `orchestrator` paths (all-cache / all-S2 / mixed-with-fallback / S2-down / timeout) | Every push |
| Integration | vitest + local Postgres | Full orchestrator with mocked S2 + mocked WASM, real DB writes; mirrors the dollar-quoting fixture pattern from the existing Python tests | Every push |
| Parity | vitest, real S2 | 20 fixture papers: assert `cos(s2_vec, wasm_vec) ≥ 0.997` | On demand + nightly CI |
| Smoke | manual | Three scenarios on a real Vercel preview: all-S2, one-fallback, S2-down (key broken for 1 min) | Before each release |
| Static | tsc, eslint, RLS test | Type safety, lint, members table not anon-readable | Every push |

## Migration plan (phased, never breaks existing flows)

**Phase 1 — Foundation (no user-visible change):**
1. Run `scripts/export_specter2_onnx.py` locally (`uv run --with optimum[onnxruntime] --with adapter-transformers python …`).
2. Verify parity (≥ 0.997 cos for 20 fixture papers).
3. `vercel blob put specter2_int8.onnx`; record the returned blob URL and the local file's SHA-256.
4. Set Vercel env vars: `S2_API_KEY` (newly provisioned for deployed use), `SUPABASE_SERVICE_ROLE_KEY`, `SPECTER2_MODEL_BLOB_URL`.
5. Land parity test in CI (on-demand only).
6. Commit the SHA-256 constant into `lib/suggest/specter2-wasm.ts` (the integrity pin) in the same PR that lands the WASM loader code (Phase 2). This is the single source of truth — env var holds *where* the model lives, code holds *what* the model must hash to.

**Phase 2 — Port the logic (route mounted, not linked):**
- TS port of `mmr` with unit tests against ported Python fixtures.
- TS port of `s2-client`, `specter2-wasm`, `embedding-cache`, `orchestrator`.
- `requireLeaderRole` auth helper.
- `app/api/suggest/route.ts` (curl-testable, invisible to leaders).

**Phase 3 — UI behind a feature gate (page mounted, not linked):**
- `app/admin/suggest/page.tsx` server component with role check.
- `SuggestForm.tsx` client component with three-stage progress messaging.
- Page reachable by URL knowledge + role; no nav link yet.

**Phase 4 — Smoke + cutover:**
- Three-scenario smoke test on Vercel preview deployment.
- If green, add "Find a paper" link to the leader's dashboard.
- Use deployed route for the next real leader pick; keep Python CLI as backup.
- After a successful cycle, **keep** `scripts/find_paper_suggest.py`, `tests/find_paper_suggest_test.py`, and the `/wids-find-paper` skill — they stay as the operator-only offline fast path (locked decision 5a). No deletion in Phase 4.

**Rollback:** Phases 1–3 are pure-additive. Phase 4's only change to existing surfaces is the dashboard link, which is one revert commit away.

## Out of scope

- ANN indexes on `paper_embeddings`.
- Recency / citation / author-overlap re-ranking layers.
- Exposing alternate embedding models (Voyage, OpenAI) through the route.
- Background pre-warming via Vercel cron.
- Replacing the `/wids-find-paper` Claude Code skill.

## Operator setup checklist (one-time)

- [ ] Provision a fresh Semantic Scholar API key for the deployed path (the existing key, if any, may be tied to your laptop's IP; the deployed function will hit S2 from Vercel's IP range).
- [ ] Install Python tooling for the export script (one-shot via `uv run --with`).
- [ ] Run export + parity verification.
- [ ] `vercel blob put` the ONNX file; record the SHA-256.
- [ ] Set 4 env vars in Vercel project dashboard.
- [ ] Update the SHA-256 pin constant in `lib/suggest/specter2-wasm.ts` and commit alongside the code.

## Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Adapter-fused ONNX produces vectors > 0.003 cosine off from S2 | Low | Cross-space drift, ranking artifacts | Parity test fails loud; investigate before pushing |
| Cold start > 30 s on Hobby Lambda | Medium | Hard timeout fires, leader has to retry | Document expected first-request latency; second request is warm and fast |
| Vercel Blob bandwidth spike if Lambda churns | Low | Each cold start fetches 110 MB | Hobby concurrency is low; <$1/mo even at pessimistic rates |
| HF Hub republishes adapter weights | Low | SHA pin still valid (we host our own ONNX in Blob); only matters at next export | Parity test catches regressions on next run |
| S2 API key shared between laptop + Vercel triggers rate limits | Medium | 429s during real sessions | Provision separate keys (Phase 1 step 4) |
| Leader hits the URL before Phase 4 cutover, expects it to work | Low | Confusion | Page hidden until link is added; URL is unguessable absent dashboard nav |
