# SPECTER2 / Suggest fallback

**Status:** Merged to main. Active in prod.
**Umbrella:** `suggest` (admin → "Find a paper" leader flow)
**Why it exists:** Semantic Scholar API is rate-limited / sometimes down. The
suggest endpoint needs to embed candidate papers to rank them by similarity to
the WiDS topic. The fallback embeds papers **locally** via SPECTER2 ONNX so the
leader dashboard never hard-fails on S2 outages.

## Pipeline (3 tiers)
Listed in *preference* order (canonical → derived → local):
1. **Semantic Scholar API** — preferred, has canonical embeddings
2. **pgvector cache** (`paper_embeddings` table) — warm hits, parsed via text
   form ([commit 163e04a](https://github.com/mrojas54/wids-nyc-reading-group-assistant/commit/163e04a))
3. **WASM/ONNX local inference** — cold fallback, runs in the Vercel Function

**Runtime execution order** in `web/lib/suggest/orchestrator.ts` is different
for latency reasons: check pgvector cache first, hit S2 only on cache misses,
fall back to WASM when S2 fails. So a previously-embedded paper short-circuits
at tier 2 even though S2 is the "preferred" source.

## Model
- **Base:** `allenai/specter2_base` + `allenai/specter2` proximity adapter
- **Quantization:** INT8 via `onnxruntime.quantize_dynamic`
- **Artifact:** `specter2_int8.onnx`, hosted in **Vercel Blob (private)**
- **SHA-256 pin:** `1db3c70b...e8f6b` — enforced in
  [web/lib/suggest/specter2-wasm.ts](../../web/lib/suggest/specter2-wasm.ts).
  Model file and code ship in the same commit (supply-chain lock).
- **Export script:** [scripts/export_specter2_onnx.py](../../scripts/export_specter2_onnx.py)
- **Export workflow:** `.github/workflows/export-specter2.yml` (Intel Mac pin
  for the local path; `ubuntu-latest` for CI)

## Parity contract
- **Fixtures:** 11 S2-canonical papers in `tests/fixtures/`
- **Thresholds:** median cos ≥ **0.99**, min cos ≥ **0.93**
  ([commit 17589da](https://github.com/mrojas54/wids-nyc-reading-group-assistant/commit/17589da))
- **Achieved at last export:** median 0.9927, min 0.9476 (2026-05-10)
- **Test:** [web/lib/suggest/__tests__/parity.test.ts](../../web/lib/suggest/__tests__/parity.test.ts)

## Runtime hardening
- **Cold start:** parallel warmup + 429 fast-fallback
  ([commit 526d0a6](https://github.com/mrojas54/wids-nyc-reading-group-assistant/commit/526d0a6))
- **Admin timeout:** 60s, WASM cold start parallelized
  ([commit 16470c5](https://github.com/mrojas54/wids-nyc-reading-group-assistant/commit/16470c5))
- **Cancellation:** `AbortSignal` preempts WASM between chunks
  ([commit 6116441](https://github.com/mrojas54/wids-nyc-reading-group-assistant/commit/6116441))
- **Bundle:** `transformers.js` + `onnxruntime` externalized from webpack
  ([commit 8544a3d](https://github.com/mrojas54/wids-nyc-reading-group-assistant/commit/8544a3d))
- **Blob auth:** `@vercel/blob` SDK with `access: "private"`
  ([commit 7c823dc](https://github.com/mrojas54/wids-nyc-reading-group-assistant/commit/7c823dc))

## 2026-05-16 — fixture-harvester pivot
**Finding ([commit 66142fd](https://github.com/mrojas54/wids-nyc-reading-group-assistant/commit/66142fd)):**
local FP32 SPECTER2 produces vectors bit-identical to S2's served vectors when
given the same `(title, abstract)` input — cosine 1.000000 across all 10 parity
fixtures, well past the pivot thresholds (median ≥ 0.999, min ≥ 0.998).
Verified by [scripts/verify_specter2_local_vs_s2.py](../../scripts/verify_specter2_local_vs_s2.py).

**Consequences ([PR #40](https://github.com/mrojas54/wids-nyc-reading-group-assistant/pull/40)):**
- New CLI [scripts/embed_specter2_fp32.py](../../scripts/embed_specter2_fp32.py)
  — single-shot `--title/--abstract` and batched `--stdin-json` modes; reuses
  the verifier's exact recipe (specter2_base + proximity adapter,
  `padding="max_length"`/512, CLS pooling) so output is interchangeable with
  fixture-stored vectors.
- Fixture harvesting no longer depends on `SEMANTIC_SCHOLAR_API_KEY`. Abstract
  sources become pluggable (arXiv / OpenAlex / Crossref / pasted CSV).
- **Parity-test semantics shift** — the planned re-baseline compares INT8
  against a freshly-computed FP32 *local reference*, not against
  `fix["vector"]` (S2-served). This isolates quantization noise from the
  previously-conflated S2-pipeline-drift confounder. Production thresholds
  (median ≥ 0.99, min ≥ 0.93) carry over; we can tighten them once the
  reference is no longer shared with a confounder.
- **Measured T_emb:** median 1099 ms steady-state per paper on CPU (Apple
  Silicon, `torch<2.6` cache). Full architecture + wall-time math in the
  spec doc below.

## Key docs
- **Runbook:** [docs/superpowers/runbooks/2026-05-10-specter2-onnx-export-deploy.md](../../docs/superpowers/runbooks/2026-05-10-specter2-onnx-export-deploy.md)
- **Design spec:** [docs/superpowers/specs/2026-05-09-vercel-suggest-wasm-specter2-design.md](../../docs/superpowers/specs/2026-05-09-vercel-suggest-wasm-specter2-design.md)
- **Smoke test spec:** [docs/superpowers/specs/2026-05-09-vercel-suggest-wasm-specter2-smoke-test.md](../../docs/superpowers/specs/2026-05-09-vercel-suggest-wasm-specter2-smoke-test.md)
- **Fixture-harvester post-pivot design:** [docs/superpowers/specs/2026-05-16-fixture-harvester-post-pivot-design.md](../../docs/superpowers/specs/2026-05-16-fixture-harvester-post-pivot-design.md)
- **Teaching guide:** [docs/admin-suggest.md](../../docs/admin-suggest.md)

## Learning targets (per Michelle, 2026-05-16)
Wants to go deeper on:
- **WASM** runtimes for ML inference (size, cold-start, SIMD)
- **ONNX** export pipeline (PyTorch → ONNX → INT8), what each stage trades
- **Alternate models** — when would you swap SPECTER2 for SciNCL, E5, BGE,
  or a smaller distilled model? Trade-offs vs the 0.99/0.93 parity bar.
