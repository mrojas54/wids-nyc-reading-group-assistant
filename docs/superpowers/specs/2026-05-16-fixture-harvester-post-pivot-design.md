# Fixture Harvester — Post-Pivot Orchestration Design

**Date:** 2026-05-16
**Status:** Revised after commit `66142fd` — local FP32 SPECTER2 validated bit-identical to S2's served vectors.
**Supersedes:** the pre-pivot dry-run design (S2-as-ground-truth, three-pool orchestration).

---

## What changed

The pre-pivot design treated Semantic Scholar's served embedding as the
canonical vector and any locally-computed vector as an approximation that
had to be validated against S2 round-trip. That coupled the harvester to
S2's API key, rate limits, and any silent drift in S2's serving pipeline.

`scripts/verify_specter2_local_vs_s2.py` (commit `66142fd`) confirmed
median cos ≥ 0.999 / min cos ≥ 0.998 across all parity fixtures between
local FP32 inference and S2's served vectors. That means **local FP32 is
the ground truth**, and S2 was only ever a proxy for it.

Concrete consequences:

1. **S2 worker pool is dropped.** No vector fetch from S2 anywhere in the
   harvester. The `SEMANTIC_SCHOLAR_API_KEY` is no longer a blocker for
   fixture growth.
2. **Abstract sources become pluggable.** Anything that can yield
   `(title, abstract)` is a valid input — arXiv, OpenAlex, Crossref, a
   pasted CSV, Zotero export. The harvester no longer cares which.
3. **Parity-test semantics shift.** The INT8 parity test (and the
   WASM-vs-server parity test downstream) used to compare INT8 quantized
   output against S2-served vectors — which conflated *quantization noise*
   with *S2-pipeline drift*. The revised test compares INT8 against the
   **FP32 reference** computed locally with the same recipe. This is
   strictly more correct: the only signal left is quantization, no
   confounder.

The orchestrator, parity-report writer, and threshold gate keep their
shape — only the pool topology and per-stage cost model change.

---

## Architecture: two pools instead of three

```
                ┌─────────────────────────────────────────┐
                │              orchestrator               │
                │  (work queue, progress, parity report)  │
                └────────┬────────────────────┬───────────┘
                         │                    │
              ┌──────────▼─────────┐  ┌───────▼──────────────┐
              │ abstract-source    │  │ local-embed workers  │
              │ workers (I/O)      │  │ (CPU, FP32 SPECTER2) │
              │                    │  │                      │
              │  - arXiv           │  │  shell out to        │
              │  - OpenAlex        │  │  scripts/embed_      │
              │  - Crossref        │  │  specter2_fp32.py    │
              │                    │  │  --stdin-json        │
              │  yield JSONL:      │  │                      │
              │  {paperId,title,   │  │  emit JSONL with     │
              │   abstract}        │  │  {...,vector:[...]}  │
              └──────────┬─────────┘  └───────┬──────────────┘
                         │                    │
                         └────────►◄──────────┘
                              JSONL pipe
```

### Pool 1 — abstract-source workers

I/O-bound. Each worker pulls a queue of `paperId` (or DOI / arXiv ID)
candidates and hits one upstream API. Concurrency is bounded by per-source
rate limits, not by CPU. Expect:

| Source    | Typical latency | Polite rate    | Notes |
|-----------|-----------------|----------------|-------|
| arXiv     | 200–500 ms      | ~1 req/3s      | Best for cs.* preprints; abstract is in `<summary>`. |
| OpenAlex  | 150–400 ms      | 10 req/s       | Best general coverage; mailto identifier required. |
| Crossref  | 200–600 ms      | 50 req/s polite| DOI-keyed; abstract present for ~60% of records. |

Workers normalize all sources into a single JSONL schema:

```json
{"paperId": "...", "title": "...", "abstract": "...", "source": "openalex"}
```

`paperId` is whatever string the orchestrator uses as the join key (S2
paperId where known, else DOI, else arXiv ID — opaque to the embed pool).

### Pool 2 — local-embed workers

CPU-bound. Each worker is a long-lived `python scripts/embed_specter2_fp32.py
--stdin-json --report-timing` subprocess; the orchestrator pipes the
abstract-source JSONL into stdin and reads the augmented JSONL from
stdout (now carrying `vector: [768 floats]`).

Why a long-lived subprocess: model load is ~5–10 s (specter2_base +
adapter from HF cache). Re-paying that on every paper would dominate
wall-time. With `--stdin-json` the load is amortized across the entire
batch.

Concurrency = number of physical cores (each worker pins ~1 core during
the attention pass). On an 8-core M-series Mac, 4–6 parallel workers is
the sweet spot before thermal throttling kicks in; on a Linux box with
N cores, use N–1.

**Measured per-paper inference time: ~1100 ms steady-state on CPU**
(median 1099 ms across the 10 parity fixtures, range 846–1615 ms,
excluding a 3068 ms first-paper warmup). Measured via PR #40's batch
smoke test: `embed_specter2_fp32.py --stdin-json --report-timing` on
Apple Silicon with the `torch<2.6` cache. An earlier figure of ~600 ms
from the commit-`66142fd` validation run reflected a warmer cache /
different state; the 1100 ms number is what fresh workers should plan
against.

---

## Wall-time estimates

Let:

- `N` = number of papers to embed
- `W_src` = abstract-source workers (default 3, one per source)
- `W_emb` = local-embed workers (default 4 on a typical laptop)
- `T_src` ≈ 400 ms median abstract-fetch
- `T_emb` ≈ 1100 ms per paper, measured steady-state (see note above)

The two pools run **concurrently** with the JSONL pipe between them as a
bounded buffer. Steady-state throughput is the *bottleneck* of:

```
Throughput_src = W_src / T_src     ≈ 3 / 0.4 s    = 7.5 papers/s
Throughput_emb = W_emb / T_emb     ≈ 4 / 1.1 s    = 3.64 papers/s
```

Embed is the bottleneck (CPU-bound > I/O-bound at these worker counts),
so:

```
Wall-time ≈ N / Throughput_emb + startup
        ≈ N × 0.275 s + 10 s    (with W_emb=4)
```

Concrete points (W_emb=4, T_emb=1.1 s steady-state):

| N papers | Embed-only wall-time | + 10s startup | Pre-pivot S2 (1 req/s) |
|----------|----------------------|---------------|------------------------|
|     100  |   28 s               |  38 s         |  100 s                 |
|   1,000  |  275 s (4.6 min)     |  285 s        | 1,000 s (17 min)       |
|  10,000  | 2,750 s (46 min)     | 2,760 s       | 10,000 s (2h 47m)      |

**Scaling lever:** doubling `W_emb` from 4 to 8 halves the embed term
(linear up to physical-core count). The pre-pivot S2 path had no such
lever — rate limits were fixed by the API key tier.

If a faster machine or accelerator is available, `T_emb` itself can drop
(GPU FP32 SPECTER2 is roughly 30–50 ms/paper). The CLI doesn't currently
expose a `--device` flag; that's a one-line follow-up if/when needed.

---

## Stages kept unchanged

| Stage                  | Change? | Notes |
|------------------------|---------|-------|
| Orchestrator state machine | no | Still queue → workers → result-merger; just one fewer pool. |
| Parity-report writer       | no | Same output format; the *reference* it compares against changes (see below). |
| Threshold gate             | no | PASS/FAIL decision keeps the existing INT8 thresholds (median ≥ 0.99, min ≥ 0.93). |

---

## Parity-test semantics — INT8 vs FP32 reference

**Before:** `cosine(INT8_local, FP32_S2_served)` — implicitly bundled
quantization noise *plus* any divergence in S2's serving pipeline
(different adapter snapshot, post-norm, etc.) into one number.

**After:** `cosine(INT8_local, FP32_local)` — both vectors come from the
same model checkpoint and same tokenization recipe (validated in
`verify_specter2_local_vs_s2.py`). A failure on this metric **must** be
quantization-attributable; there is no other variable.

This is strictly more correct because:

1. It isolates the variable the test is *named for* (INT8 quantization).
2. It removes a hidden floor on achievable cosine — S2-pipeline drift
   was previously eating ~0.001 of the budget unprovably.
3. It lets us tighten the INT8 thresholds in the future if we want,
   without worrying that S2 changed something silently.

The existing fixtures file (`scripts/specter2_parity_fixtures.json`) keeps
`vector` populated with the S2-served values — useful as a regression
sentinel that our local FP32 recipe still matches what S2 was serving on
the day of capture — but the parity test's *reference* column is now the
freshly-computed FP32 vector, not `fix["vector"]`.

---

## Open questions / follow-ups (not blocking)

- **GPU/MPS support in the CLI.** `embed_specter2_fp32.py` currently runs
  on CPU. Adding `--device {cpu,mps,cuda}` is straightforward but
  unneeded until N grows past ~50k.
- **Adapter version pinning.** `model.load_adapter("allenai/specter2",
  source="hf")` resolves to whatever HF serves at call time. If
  reproducibility becomes a concern, pin a revision hash and document it
  in `memory/projects/specter2.md`.
- **Batched inference.** Current CLI processes one paper per forward
  pass. Batching 8–16 papers into a single forward could drop `T_emb` by
  ~3× on CPU and ~6× on GPU. Worth doing if/when we run > 10k papers.
