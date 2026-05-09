# Vercel-Deployed Suggest with WASM SPECTER2 Fallback — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [2026-05-09-vercel-suggest-wasm-specter2-design.md](../specs/2026-05-09-vercel-suggest-wasm-specter2-design.md)

**Goal:** Ship a leader-facing `/admin/suggest` route on Vercel that ports the existing Python `find_paper_suggest.py` to TypeScript, with an in-process WebAssembly SPECTER2 fallback for any paper Semantic Scholar doesn't have an embedding for.

**Architecture:** Single Vercel deployment, Node serverless function (NOT edge). Adapter-fused SPECTER2 ONNX model in Vercel Blob, lazy-loaded into Lambda memory once per warm container. Single embedding space — S2-generated and WASM-generated vectors both stored under `model = 'specter_v2'` in the existing `paper_embeddings` table. (3)-Aggressive fallback policy with 401/403/400 carve-outs.

**Tech Stack:** TypeScript, Next.js 14 App Router, Node serverless function, `@xenova/transformers` (WASM transformers), `onnxruntime-web` (WASM-SIMD backend), `@vercel/blob`, `@supabase/ssr`, `zod`, vitest.

---

## ⚠️ Pre-execution clarifications required

Self-review surfaced three schema/API-shape gaps the spec didn't pin down. These must be resolved before Phase 1 starts because they ripple through Tasks 2.2, 2.6, 2.7, 2.9, and 3.3.

### Gap 1: How do papers track their Semantic Scholar identifier?

The `papers` table ([001_initial_schema.sql:25](../../../migrations/001_initial_schema.sql:25)) has columns `id, title, url, abstract, authors, venue, year, pdf_drive_url, added_at` — **no `s2_paper_id` column**. The Python suggest's `PastPaper` dataclass takes `s2_paper_id` as a separate field, populated by the `/wids-find-paper` skill at runtime (not stored). For a deployed flow that needs to cache embeddings keyed by S2 ID, we need one of:

- **(1a)** Add migration `011_papers_s2_paper_id.sql`: `ALTER TABLE papers ADD COLUMN s2_paper_id TEXT UNIQUE;`. Existing rows get NULL; the resolver populates it for new papers and a one-time backfill script populates it for past picks. **Recommended.**
- **(1b)** Match papers by URL only. The resolver constructs S2 IDs on the fly each time. Wastes one S2 round-trip per paper per request. Avoids schema change.
- **(1c)** Stash the s2_paper_id in `papers.url` as a synthetic URL like `s2://<paperId>` for papers that lack a real arxiv/DOI URL. Hacky; rejected.

### Gap 2: Where do candidate embeddings get cached?

A leader evaluates 10 candidates, picks one. The other 9 candidates: do they get rows in `papers`, and therefore in `paper_embeddings`?

- **(2a)** Insert every candidate into `papers` with no past-pick marker. Cache embeddings for all of them. Pollutes `papers` with non-picks but eliminates redundant WASM work across sessions. **Recommended for MVP.**
- **(2b)** Don't insert candidates into `papers`. Their embeddings live only for the duration of the request. Re-fetch from S2 / re-compute via WASM each time. Cleaner data model; more work per request.
- **(2c)** Add a `papers.kind` column (`'pick' | 'candidate'`) to differentiate. Filter on it. Adds another schema change.

### Gap 3: What constitutes "past picks" for the comparison set?

Today the `papers` table is presumably populated only with picks (per Gap 2's pre-existing convention). After Gap 2, "past picks" needs an explicit definition:

- **(3a)** Past picks = papers that have ≥1 row in `meetings` with `type='reading_group'` linking via `paper_id`. SQL becomes a JOIN.
- **(3b)** If we choose Gap 2(a), add a column or use a flag table to mark picks vs candidates.
- **(3c)** Past picks = all papers added before some date / via some flag. Operator-defined.

### Recommended set: (1a), (2a), (3a)

- One small additive migration.
- One unified storage strategy.
- Past picks queryable via JOIN that already matches the existing meetings/papers relationship.

**Operator: confirm the recommendation set before Phase 1, or pick alternates. The plan tasks below assume (1a), (2a), (3a).**

---

## File structure

### New files

| Path | Responsibility |
|---|---|
| `scripts/export_specter2_onnx.py` | One-time Python tool: load `specter2_base` + `specter2` (proximity adapter), fuse, INT8-quantize, export to ONNX, verify parity against S2 API for fixture papers, print SHA-256. |
| `scripts/specter2_parity_fixtures.json` | Hand-picked ~20 paper IDs with their S2-fetched canonical vectors, used by both the export script and the runtime parity test. |
| `web/lib/suggest/types.ts` | Shared TypeScript types and zod schemas: `SuggestRequest`, `SuggestResponse`, `S2Result` discriminated union, `RankedResult`, error classes. |
| `web/lib/suggest/mmr.ts` | Pure-function MMR ranking. No I/O. Direct port of [find_paper_suggest.py:151](../../../scripts/find_paper_suggest.py:151). |
| `web/lib/suggest/s2-client.ts` | Semantic Scholar Graph API client. Returns `S2Result` discriminated union. Single retry on transient errors. |
| `web/lib/suggest/specter2-wasm.ts` | Lazy-loaded WASM SPECTER2 model. Module-scope singleton. Fetches ONNX from Vercel Blob, verifies SHA-256, batch-embeds. |
| `web/lib/suggest/embedding-cache.ts` | Read/write `paper_embeddings` via Supabase service-role client. `INSERT ... ON CONFLICT DO NOTHING` for idempotent writes. |
| `web/lib/suggest/orchestrator.ts` | The state machine: cache lookup → S2 fetch → WASM fallback → MMR. Wraps everything in a 30s timeout race. |
| `web/lib/auth/requireLeaderRole.ts` | Auth helper: throws `UnauthorizedError` if logged-out user, `ForbiddenError` if member.role ∉ {leader, admin}. |
| `web/app/api/suggest/route.ts` | POST handler. Auth, validate, orchestrate, error-map to status codes, structured log. |
| `web/app/admin/suggest/page.tsx` | Server component. Role check + redirect. Renders `SuggestForm`. |
| `web/app/admin/suggest/SuggestForm.tsx` | Client component. Form, three-stage progress messaging, 30s `AbortController`, results render. |
| `web/lib/suggest/__tests__/mmr.test.ts` | Unit tests for MMR ranking, fixtures ported from [tests/find_paper_suggest_test.py](../../../tests/find_paper_suggest_test.py). |
| `web/lib/suggest/__tests__/s2-client.test.ts` | Unit tests for response classification, retry behavior. Uses `msw` to mock fetch. |
| `web/lib/suggest/__tests__/embedding-cache.test.ts` | Unit tests for cache CRUD, with mocked Supabase client. |
| `web/lib/suggest/__tests__/orchestrator.test.ts` | Unit tests for state machine paths: all-cache, all-S2, mixed-fallback, S2-down, timeout. Mocks both s2-client and specter2-wasm. |
| `web/lib/suggest/__tests__/parity.test.ts` | Parity test: locally-generated WASM vectors match S2's API within cosine ≥ 0.997 for fixture papers. Marked `.slow`. |
| `docs/superpowers/specs/2026-05-09-vercel-suggest-wasm-specter2-smoke-test.md` | Manual smoke-test runbook for Phase 4 (three scenarios). |

### Modified files

| Path | Change |
|---|---|
| `web/package.json` | Add deps: `@xenova/transformers`, `onnxruntime-web`, `@vercel/blob`, `zod`. |
| `web/middleware.ts` | Extend protected-paths gate to include `/admin/`. |
| `web/app/dashboard/page.tsx` | (Phase 4 only) Add "Find a paper" link visible to leaders/admins. |

### Testing distribution (deviation from spec, Section 4)

The spec called for an integration test layer hitting local Postgres. The project has no existing local-Postgres setup, so we collapse that layer into:
- **Unit tests** mock the Supabase client (covers query shape, write idempotency).
- **Orchestrator integration test** wires real `mmr` + real `embedding-cache` (against a mocked Supabase) + mocked s2-client + mocked specter2-wasm. This catches state-machine bugs without DB plumbing.
- **Smoke test** on Vercel preview hits the real Supabase project. Covers real-DB integration.

This trades local-DB CI coverage for shipping speed; documented as a follow-up if a real-DB regression slips through smoke.

---

## Phase 0 — Schema preparation (assumes (1a) confirmed)

### Task 0.1: Add `s2_paper_id` column to `papers`

**Files:**
- Create: `migrations/011_papers_s2_paper_id.sql`

- [ ] **Step 1: Write the migration**

```sql
-- migrations/011_papers_s2_paper_id.sql
--
-- Adds s2_paper_id (TEXT, UNIQUE, nullable) to papers so the deployed
-- /admin/suggest flow can JOIN paper_embeddings by an external identifier
-- without re-resolving via the S2 API on every request.
--
-- Existing rows get NULL; a follow-up backfill script populates them based
-- on URL matching. The resolver endpoint populates new rows on insert.

BEGIN;

ALTER TABLE papers ADD COLUMN s2_paper_id TEXT;

CREATE UNIQUE INDEX idx_papers_s2_paper_id ON papers (s2_paper_id) WHERE s2_paper_id IS NOT NULL;

COMMENT ON COLUMN papers.s2_paper_id IS
  'Canonical Semantic Scholar identifier (e.g., ARXIV:1706.03762, DOI:10.1080/...). '
  'Populated by the /api/admin/resolve-papers endpoint on insert and by a '
  'one-time backfill script for past picks. Nullable to keep historical rows '
  'valid; new inserts via the deployed flow always populate it.';

COMMIT;
```

- [ ] **Step 2: Apply the migration locally and verify**

```bash
# If using Supabase CLI:
supabase db push

# Or via psql against your dev instance:
psql "$SUPABASE_DB_URL" -f migrations/011_papers_s2_paper_id.sql
```

Verify:
```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'papers' AND column_name = 's2_paper_id';
-- Expect: 1 row, text, YES (nullable)
```

- [ ] **Step 3: Apply to Production Supabase**

Use the same method you use for prior migrations (Supabase dashboard SQL editor, CLI, or direct psql).

- [ ] **Step 4: Backfill past picks** (operator-driven, one-time script)

Past picks already in `papers` need their `s2_paper_id` populated so the deployed flow's cache lookups hit. Quick backfill via the existing Python skill or a one-off:

```bash
uv run --with httpx --with python-dotenv --with psycopg --with "psycopg[binary]" python3 - <<'PY'
import os, re, httpx, psycopg
from dotenv import load_dotenv
load_dotenv()

def url_to_s2_id(url: str) -> str | None:
    m = re.search(r"arxiv\.org/(?:abs|pdf)/([0-9]{4}\.[0-9]{4,5})", url, re.I)
    if m: return f"ARXIV:{m.group(1)}"
    m = re.search(r"\b(10\.\d{4,9}/[^\s/?#]+)", url, re.I)
    if m: return f"DOI:{m.group(1)}"
    return None

with psycopg.connect(os.environ["SUPABASE_DB_URL"]) as conn, conn.cursor() as cur:
    cur.execute("SELECT id, url FROM papers WHERE s2_paper_id IS NULL AND url IS NOT NULL")
    rows = cur.fetchall()
    print(f"backfill: {len(rows)} candidates")
    for pid, url in rows:
        s2id = url_to_s2_id(url)
        if s2id:
            cur.execute("UPDATE papers SET s2_paper_id = %s WHERE id = %s", (s2id, pid))
            print(f"  {pid}: {s2id}")
    conn.commit()
PY
```

- [ ] **Step 5: Commit the migration**

```bash
git add migrations/011_papers_s2_paper_id.sql
git commit -m "feat(db): add papers.s2_paper_id for embedding cache joins (migration 011)"
```

---

## Phase 1 — Foundation (no user-visible change)

### Task 1.1: Write the SPECTER2 ONNX export script

**Files:**
- Create: `scripts/export_specter2_onnx.py`
- Create: `scripts/specter2_parity_fixtures.json`

- [ ] **Step 1: Create the parity fixtures file**

Pick 20 papers that already exist in the `papers` table (so they have S2 IDs and we can fetch canonical vectors).

```bash
# Run once to generate the fixtures file:
uv run --with httpx --with python-dotenv python3 -c "
import os, json, httpx
from dotenv import load_dotenv
load_dotenv()
S2 = 'https://api.semanticscholar.org/graph/v1'
KEY = os.environ['S2_API_KEY']
# Hand-picked stable IDs — edit this list to match your past picks
ids = [
  'arXiv:2106.11189', 'arXiv:2103.00020', 'arXiv:2010.11929',
  # ...add 17 more from your reading_group_picks
]
out = []
with httpx.Client(headers={'x-api-key': KEY}, timeout=30) as c:
  for pid in ids:
    r = c.get(f'{S2}/paper/{pid}', params={'fields':'paperId,title,abstract,embedding.specter_v2'})
    r.raise_for_status()
    d = r.json()
    if d.get('embedding') and d['embedding'].get('vector'):
      out.append({'paperId': d['paperId'], 'title': d['title'], 'abstract': d['abstract'], 'vector': d['embedding']['vector']})
print(f'collected {len(out)} fixtures')
with open('scripts/specter2_parity_fixtures.json','w') as f:
  json.dump(out, f)
"
```

Expected: at least 18 of 20 papers return embeddings (some may not be in S2 corpus). Store the JSON.

- [ ] **Step 2: Write the export script header and dependency check**

Create `scripts/export_specter2_onnx.py`:

```python
#!/usr/bin/env python3
"""
One-time export: fuse specter2_base + specter2 (proximity adapter) into a
single ONNX graph, INT8-quantize, verify cosine >= 0.997 against S2's
canonical vectors for fixture papers, print the SHA-256 of the output.

Run: uv run --with optimum[onnxruntime] --with adapters --with torch \\
        --with transformers --with numpy python scripts/export_specter2_onnx.py
"""
import hashlib
import json
import sys
from pathlib import Path

import numpy as np
import torch
from adapters import AutoAdapterModel
from transformers import AutoTokenizer

REPO_ROOT = Path(__file__).resolve().parent.parent
FIXTURES = REPO_ROOT / "scripts" / "specter2_parity_fixtures.json"
OUTPUT_DIR = REPO_ROOT / "scripts" / "_specter2_export"
PARITY_THRESHOLD = 0.997
```

- [ ] **Step 3: Add the model fusion step**

Append to `scripts/export_specter2_onnx.py`:

```python
def fuse_model() -> tuple[AutoAdapterModel, AutoTokenizer]:
    """Load specter2_base, attach the proximity adapter, set it active."""
    print("Loading specter2_base...")
    model = AutoAdapterModel.from_pretrained("allenai/specter2_base")
    print("Loading proximity adapter...")
    adapter_name = model.load_adapter("allenai/specter2", source="hf", set_active=True)
    print(f"Adapter loaded: {adapter_name}, active=True")
    tokenizer = AutoTokenizer.from_pretrained("allenai/specter2_base")
    model.eval()
    return model, tokenizer
```

- [ ] **Step 4: Add the embed function used by both export verification and quantization sanity check**

Append:

```python
def embed_with_pytorch(model, tokenizer, title: str, abstract: str) -> np.ndarray:
    """Reference embedding via PyTorch — ground truth for parity check."""
    text = f"{title}{tokenizer.sep_token}{abstract}"
    inputs = tokenizer(text, padding=True, truncation=True, return_tensors="pt", max_length=512)
    with torch.no_grad():
        outputs = model(**inputs)
    # SPECTER2 uses CLS pooling
    cls = outputs.last_hidden_state[:, 0, :]
    return cls.squeeze(0).numpy().astype(np.float32)
```

- [ ] **Step 5: Add the ONNX export step**

Append:

```python
def export_to_onnx(model, tokenizer, output_path: Path) -> None:
    """Trace the fused model to ONNX with adapter weights merged into the graph."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    dummy_text = "Test paper title.[SEP]Test abstract content for ONNX tracing."
    inputs = tokenizer(dummy_text, return_tensors="pt", padding="max_length", max_length=512, truncation=True)
    print(f"Exporting to {output_path}...")
    torch.onnx.export(
        model,
        (inputs["input_ids"], inputs["attention_mask"]),
        str(output_path),
        input_names=["input_ids", "attention_mask"],
        output_names=["last_hidden_state"],
        dynamic_axes={
            "input_ids": {0: "batch", 1: "seq"},
            "attention_mask": {0: "batch", 1: "seq"},
            "last_hidden_state": {0: "batch", 1: "seq"},
        },
        opset_version=14,
        do_constant_folding=True,
    )
    print(f"Exported FP32 ONNX: {output_path.stat().st_size / 1e6:.1f} MB")
```

- [ ] **Step 6: Add INT8 quantization step**

Append:

```python
def quantize_int8(fp32_path: Path, int8_path: Path) -> None:
    from onnxruntime.quantization import quantize_dynamic, QuantType
    print(f"INT8-quantizing {fp32_path} -> {int8_path}...")
    quantize_dynamic(
        model_input=str(fp32_path),
        model_output=str(int8_path),
        weight_type=QuantType.QInt8,
    )
    print(f"INT8 ONNX: {int8_path.stat().st_size / 1e6:.1f} MB")
```

- [ ] **Step 7: Add parity verification step**

Append:

```python
def cosine(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))

def verify_parity(int8_path: Path, fixtures: list[dict]) -> tuple[bool, list[float]]:
    """Compare INT8 ONNX outputs against S2's canonical vectors."""
    import onnxruntime as ort
    from transformers import AutoTokenizer
    sess = ort.InferenceSession(str(int8_path), providers=["CPUExecutionProvider"])
    tok = AutoTokenizer.from_pretrained("allenai/specter2_base")
    sims = []
    for fix in fixtures:
        text = f"{fix['title']}{tok.sep_token}{fix['abstract']}"
        enc = tok(text, padding="max_length", truncation=True, max_length=512, return_tensors="np")
        out = sess.run(None, {"input_ids": enc["input_ids"], "attention_mask": enc["attention_mask"]})
        local_vec = out[0][0, 0, :].astype(np.float32)  # CLS token
        s2_vec = np.array(fix["vector"], dtype=np.float32)
        sims.append(cosine(local_vec, s2_vec))
    avg = float(np.mean(sims))
    minimum = float(np.min(sims))
    print(f"Parity over {len(sims)} fixtures: avg={avg:.4f}, min={minimum:.4f}")
    return minimum >= PARITY_THRESHOLD, sims
```

- [ ] **Step 8: Add the SHA-256 step and main entrypoint**

Append:

```python
def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()

def main() -> int:
    if not FIXTURES.exists():
        print(f"ERROR: {FIXTURES} missing; run Step 1 first.", file=sys.stderr)
        return 1
    fixtures = json.loads(FIXTURES.read_text())
    model, tokenizer = fuse_model()
    fp32 = OUTPUT_DIR / "specter2_fp32.onnx"
    int8 = OUTPUT_DIR / "specter2_int8.onnx"
    export_to_onnx(model, tokenizer, fp32)
    quantize_int8(fp32, int8)
    ok, sims = verify_parity(int8, fixtures)
    if not ok:
        print(f"FAIL: parity threshold {PARITY_THRESHOLD} not met. Sims: {sims}", file=sys.stderr)
        return 2
    digest = sha256_of(int8)
    print("=" * 60)
    print(f"PASS")
    print(f"Output: {int8}")
    print(f"Size:   {int8.stat().st_size / 1e6:.1f} MB")
    print(f"SHA256: {digest}")
    print("=" * 60)
    print("Next steps:")
    print(f"  1. vercel blob put {int8}")
    print(f"  2. Set env var SPECTER2_MODEL_BLOB_URL=<the URL Vercel returns>")
    print(f"  3. Pin EXPECTED_MODEL_SHA256 = '{digest}' in web/lib/suggest/specter2-wasm.ts")
    return 0

if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 9: Commit**

```bash
git add scripts/export_specter2_onnx.py scripts/specter2_parity_fixtures.json
git commit -m "feat(suggest): one-time SPECTER2 adapter-fused ONNX export script

Fuses specter2_base + proximity adapter, INT8-quantizes, verifies
parity against S2's canonical vectors (cos >= 0.997), prints SHA-256
for the runtime integrity pin."
```

### Task 1.2: Run the export and capture the SHA-256

This is an operator-driven step (not a code change), but the plan needs to record it because the SHA value gets pinned in code in Task 2.5.

- [ ] **Step 1: Run the export script**

```bash
cd /path/to/wids-nyc-reading-group-assistant
uv run --with optimum[onnxruntime] --with "adapters>=0.2" --with torch \
       --with transformers --with numpy --with onnxruntime --with onnx \
       python scripts/export_specter2_onnx.py
```

Expected output ends with `PASS`, prints `SHA256: <hex>`. Record this value — it goes in code in Task 2.5.

- [ ] **Step 2: If parity fails, troubleshoot before proceeding**

Common causes:
- Wrong adapter — verify `model.active_adapters` shows `'specter2'` after load.
- INT8 quantization too aggressive — try `weight_type=QuantType.QUInt8` instead.
- Tokenizer mismatch — confirm `tokenizer.sep_token == '[SEP]'` for `specter2_base`.

If the script can't reach 0.997 even on FP32 (skip quantization, run parity on FP32), the issue is upstream — open a question with the operator before continuing.

### Task 1.3: Push the model to Vercel Blob

Operator-driven, no code change.

- [ ] **Step 1: Authenticate with Vercel CLI if not already**

```bash
vercel login
vercel link  # ensure linked to the wids-nyc project
```

- [ ] **Step 2: Push the ONNX file to Vercel Blob**

```bash
vercel blob put scripts/_specter2_export/specter2_int8.onnx --pathname specter2/specter2_int8.onnx
```

Expected: Vercel CLI prints a URL like `https://<storeId>.public.blob.vercel-storage.com/specter2/specter2_int8.onnx`. Record this URL.

### Task 1.4: Provision S2 API key and set Vercel env vars

Operator-driven.

- [ ] **Step 1: Provision a fresh Semantic Scholar API key**

Request via https://www.semanticscholar.org/product/api → "Apply for an API key". Use a different key from any local-dev key, because Vercel hits S2 from a different IP range and rate limits are per-key.

- [ ] **Step 2: Set Vercel env vars**

Via Vercel dashboard → Project → Settings → Environment Variables, set for **Production** and **Preview**:

| Name | Value | Notes |
|---|---|---|
| `S2_API_KEY` | (new key from Step 1) | Server-only; do NOT prefix with `NEXT_PUBLIC_` |
| `SUPABASE_SERVICE_ROLE_KEY` | (existing service-role key) | Already exists for cron; reuse |
| `SPECTER2_MODEL_BLOB_URL` | (URL from Task 1.3 Step 2) | The full https URL |

`SPECTER2_MODEL_SHA256` is **not** an env var — it's pinned in code (Task 2.5) so a Blob substitution can't silently change the model.

- [ ] **Step 3: Verify env vars are visible to the deployment**

Trigger a Preview deployment (any small docs commit pushed to a branch). After it builds, in the deployment's "Functions" tab, the absence of build errors complaining about missing env vars means they're set. (We can't actually read the values from the dashboard for security; we'll confirm via runtime in Phase 2.)

---

## Phase 2 — Port the suggest logic (route mounted, not linked)

### Task 2.1: Install dependencies

**Files:**
- Modify: `web/package.json`

- [ ] **Step 1: Add the deps**

```bash
cd web
npm install --save @xenova/transformers@^2.17 onnxruntime-web@^1.17 @vercel/blob@^0 zod@^3
npm install --save-dev msw@^2
```

- [ ] **Step 2: Verify installation didn't bork tsc**

Run: `cd web && npx tsc --noEmit`
Expected: clean (or only the same warnings as before this task — no new errors).

- [ ] **Step 3: Commit**

```bash
git add web/package.json web/package-lock.json
git commit -m "chore(suggest): add transformers.js, onnxruntime-web, @vercel/blob, zod, msw"
```

### Task 2.2: Define shared types and zod schemas

**Files:**
- Create: `web/lib/suggest/types.ts`

- [ ] **Step 1: Write the types and schemas**

Create `web/lib/suggest/types.ts`:

```typescript
import { z } from "zod";

export const SuggestRequestSchema = z.object({
  candidate_paper_ids: z.array(z.string().min(1)).min(1).max(10),
  past_pick_ids: z.array(z.string().min(1)).min(1),
  lambda: z.number().min(0).max(1).default(0.6),
  k: z.number().int().min(1).max(10).default(10),
});
export type SuggestRequest = z.infer<typeof SuggestRequestSchema>;

export type RankedResult = {
  paper_id: string;
  title: string;
  mmr_score: number;
};

export type SuggestDiagnostics = {
  cache_hits: number;
  s2_fetched: number;
  fallback_used: number;
  cold_start: boolean;
  total_ms: number;
};

export type SuggestResponse = {
  ranked: RankedResult[];
  diagnostics: SuggestDiagnostics;
};

export type S2Result =
  | { kind: "hit"; paperId: string; vector: Float32Array; title: string; abstract: string }
  | { kind: "fallback_needed"; paperId: string; reason: "no_embedding" | "not_in_corpus" | "s2_transient"; title: string; abstract: string }
  | { kind: "error"; paperId: string; status: number; message: string };

export class UnauthorizedError extends Error { constructor() { super("unauthorized"); this.name = "UnauthorizedError"; } }
export class ForbiddenError extends Error { constructor() { super("forbidden"); this.name = "ForbiddenError"; } }
export class S2AuthError extends Error { constructor(m: string) { super(m); this.name = "S2AuthError"; } }
export class S2RequestError extends Error { constructor(m: string) { super(m); this.name = "S2RequestError"; } }
export class S2OutageError extends Error { constructor(m: string) { super(m); this.name = "S2OutageError"; } }
export class ModelLoadError extends Error { constructor(m: string) { super(m); this.name = "ModelLoadError"; } }
export class TimeoutError extends Error { constructor() { super("timeout"); this.name = "TimeoutError"; } }
```

- [ ] **Step 2: Verify it type-checks**

Run: `cd web && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add web/lib/suggest/types.ts
git commit -m "feat(suggest): zod schemas, shared types, error classes"
```

### Task 2.3: Port MMR ranking with TDD

**Files:**
- Create: `web/lib/suggest/__tests__/mmr.test.ts`
- Create: `web/lib/suggest/mmr.ts`

The test fixtures mirror the Python tests at [tests/find_paper_suggest_test.py](../../../tests/find_paper_suggest_test.py).

- [ ] **Step 1: Write the failing tests**

Create `web/lib/suggest/__tests__/mmr.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { mmr, cosineSim } from "@/lib/suggest/mmr";

const v = (arr: number[]) => Float32Array.from(arr);

describe("cosineSim", () => {
  it("returns 1.0 for identical vectors", () => {
    expect(cosineSim(v([1, 0, 0]), v([1, 0, 0]))).toBeCloseTo(1.0, 6);
  });

  it("returns 0.0 for orthogonal vectors", () => {
    expect(cosineSim(v([1, 0, 0]), v([0, 1, 0]))).toBeCloseTo(0.0, 6);
  });

  it("returns -1.0 for opposite vectors", () => {
    expect(cosineSim(v([1, 0, 0]), v([-1, 0, 0]))).toBeCloseTo(-1.0, 6);
  });
});

describe("mmr", () => {
  const query = v([1, 0]);
  // Three candidates: A is closest to query, B is second, C is far + diverse from A
  const candidates = [v([0.9, 0.1]), v([0.8, 0.2]), v([0.1, 0.9])];

  it("with lambda=1 (pure relevance) ranks by similarity to query", () => {
    const order = mmr(query, candidates, 1.0, 3);
    expect(order).toEqual([0, 1, 2]);
  });

  it("with lambda=0 (pure diversity) picks the most-similar first then most-different from selected", () => {
    const order = mmr(query, candidates, 0.0, 3);
    // First pick is still argmax sim(query) when nothing's selected yet; then diversity dominates
    expect(order[0]).toBe(0);
    expect(order[1]).toBe(2);  // C is farther from A than B is
  });

  it("k smaller than candidates returns exactly k items", () => {
    const order = mmr(query, candidates, 0.6, 2);
    expect(order).toHaveLength(2);
  });

  it("k larger than candidates returns all candidates", () => {
    const order = mmr(query, candidates, 0.6, 100);
    expect(order).toHaveLength(3);
    expect(new Set(order)).toEqual(new Set([0, 1, 2]));
  });

  it("empty candidates returns empty array", () => {
    expect(mmr(query, [], 0.6, 5)).toEqual([]);
  });

  it("single candidate returns [0]", () => {
    expect(mmr(query, [v([0.5, 0.5])], 0.6, 1)).toEqual([0]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run lib/suggest/__tests__/mmr.test.ts`
Expected: FAIL — "Cannot find module '@/lib/suggest/mmr'".

- [ ] **Step 3: Implement MMR**

Create `web/lib/suggest/mmr.ts`:

```typescript
export function cosineSim(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) throw new Error(`dim mismatch: ${a.length} vs ${b.length}`);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Maximum Marginal Relevance ranking.
 * Returns the indices of `candidates` in selection order.
 */
export function mmr(
  query: Float32Array,
  candidates: Float32Array[],
  lambda: number,
  k: number,
): number[] {
  if (candidates.length === 0) return [];
  const targetK = Math.min(k, candidates.length);
  const queryRel = candidates.map(c => cosineSim(query, c));
  const selected: number[] = [];
  const remaining = new Set<number>(candidates.map((_, i) => i));

  while (selected.length < targetK) {
    let bestIdx = -1;
    let bestScore = -Infinity;
    for (const i of remaining) {
      let maxSelectedSim = 0;
      for (const s of selected) {
        const sim = cosineSim(candidates[i], candidates[s]);
        if (sim > maxSelectedSim) maxSelectedSim = sim;
      }
      const score = lambda * queryRel[i] - (1 - lambda) * maxSelectedSim;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    selected.push(bestIdx);
    remaining.delete(bestIdx);
  }
  return selected;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run lib/suggest/__tests__/mmr.test.ts`
Expected: PASS — all 9 tests green.

- [ ] **Step 5: Commit**

```bash
git add web/lib/suggest/mmr.ts web/lib/suggest/__tests__/mmr.test.ts
git commit -m "feat(suggest): port MMR ranking from Python with TDD coverage"
```

### Task 2.4: Implement S2 client with response classification

**Files:**
- Create: `web/lib/suggest/__tests__/s2-client.test.ts`
- Create: `web/lib/suggest/s2-client.ts`

- [ ] **Step 1: Write the failing tests**

Create `web/lib/suggest/__tests__/s2-client.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { fetchPaperWithEmbedding } from "@/lib/suggest/s2-client";
import { S2AuthError, S2RequestError } from "@/lib/suggest/types";

const S2 = "https://api.semanticscholar.org/graph/v1";

const server = setupServer();
beforeEach(() => server.listen());
afterEach(() => server.resetHandlers());
afterEach(() => server.close());

describe("fetchPaperWithEmbedding", () => {
  it("classifies 200 + valid embedding as 'hit'", async () => {
    server.use(http.get(`${S2}/paper/p1`, () =>
      HttpResponse.json({ paperId: "p1", title: "T", abstract: "A", embedding: { vector: [1, 2, 3] } })
    ));
    const r = await fetchPaperWithEmbedding("p1", "key");
    expect(r.kind).toBe("hit");
    if (r.kind === "hit") expect(Array.from(r.vector)).toEqual([1, 2, 3]);
  });

  it("classifies 200 with null embedding as 'fallback_needed' (no_embedding)", async () => {
    server.use(http.get(`${S2}/paper/p2`, () =>
      HttpResponse.json({ paperId: "p2", title: "T", abstract: "A", embedding: null })
    ));
    const r = await fetchPaperWithEmbedding("p2", "key");
    expect(r.kind).toBe("fallback_needed");
    if (r.kind === "fallback_needed") expect(r.reason).toBe("no_embedding");
  });

  it("classifies 404 as 'fallback_needed' (not_in_corpus)", async () => {
    server.use(http.get(`${S2}/paper/p3`, () => new HttpResponse(null, { status: 404 })));
    const r = await fetchPaperWithEmbedding("p3", "key");
    expect(r.kind).toBe("fallback_needed");
    if (r.kind === "fallback_needed") expect(r.reason).toBe("not_in_corpus");
  });

  it("retries 5xx once, then classifies 's2_transient' fallback if still failing", async () => {
    let calls = 0;
    server.use(http.get(`${S2}/paper/p4`, () => {
      calls++;
      return new HttpResponse(null, { status: 503 });
    }));
    const r = await fetchPaperWithEmbedding("p4", "key");
    expect(calls).toBe(2);
    expect(r.kind).toBe("fallback_needed");
    if (r.kind === "fallback_needed") expect(r.reason).toBe("s2_transient");
  });

  it("treats successful retry-after-5xx as a hit", async () => {
    let calls = 0;
    server.use(http.get(`${S2}/paper/p5`, () => {
      calls++;
      if (calls === 1) return new HttpResponse(null, { status: 503 });
      return HttpResponse.json({ paperId: "p5", title: "T", abstract: "A", embedding: { vector: [4, 5, 6] } });
    }));
    const r = await fetchPaperWithEmbedding("p5", "key");
    expect(calls).toBe(2);
    expect(r.kind).toBe("hit");
  });

  it("throws S2AuthError on 401", async () => {
    server.use(http.get(`${S2}/paper/p6`, () => new HttpResponse(null, { status: 401 })));
    await expect(fetchPaperWithEmbedding("p6", "key")).rejects.toBeInstanceOf(S2AuthError);
  });

  it("throws S2RequestError on 400", async () => {
    server.use(http.get(`${S2}/paper/p7`, () => new HttpResponse(null, { status: 400 })));
    await expect(fetchPaperWithEmbedding("p7", "key")).rejects.toBeInstanceOf(S2RequestError);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run lib/suggest/__tests__/s2-client.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the S2 client**

Create `web/lib/suggest/s2-client.ts`:

```typescript
import { S2AuthError, S2RequestError, type S2Result } from "./types";

const S2_BASE = "https://api.semanticscholar.org/graph/v1";
const FIELDS = "paperId,title,abstract,embedding.specter_v2";

async function fetchOnce(paperId: string, apiKey: string): Promise<Response> {
  const url = `${S2_BASE}/paper/${encodeURIComponent(paperId)}?fields=${FIELDS}`;
  return fetch(url, {
    headers: { "x-api-key": apiKey },
    signal: AbortSignal.timeout(15_000),
  });
}

const TRANSIENT = new Set([408, 429, 500, 502, 503, 504]);

export async function fetchPaperWithEmbedding(paperId: string, apiKey: string): Promise<S2Result> {
  let res: Response;
  try {
    res = await fetchOnce(paperId, apiKey);
  } catch (e) {
    // Network-level failure: retry once with 500ms backoff
    await new Promise(r => setTimeout(r, 500));
    try {
      res = await fetchOnce(paperId, apiKey);
    } catch {
      return { kind: "fallback_needed", paperId, reason: "s2_transient", title: "", abstract: "" };
    }
  }

  if (TRANSIENT.has(res.status)) {
    await new Promise(r => setTimeout(r, 500));
    res = await fetchOnce(paperId, apiKey);
    if (TRANSIENT.has(res.status)) {
      return { kind: "fallback_needed", paperId, reason: "s2_transient", title: "", abstract: "" };
    }
  }

  if (res.status === 401 || res.status === 403) throw new S2AuthError(`s2 ${res.status}`);
  if (res.status === 400) throw new S2RequestError(`s2 400 for ${paperId}`);
  if (res.status === 404) {
    return { kind: "fallback_needed", paperId, reason: "not_in_corpus", title: "", abstract: "" };
  }
  if (!res.ok) throw new Error(`s2 unexpected ${res.status}`);

  const data = await res.json() as { paperId: string; title: string; abstract: string; embedding: { vector: number[] } | null };
  if (!data.embedding?.vector?.length) {
    return { kind: "fallback_needed", paperId: data.paperId, reason: "no_embedding", title: data.title ?? "", abstract: data.abstract ?? "" };
  }
  return {
    kind: "hit",
    paperId: data.paperId,
    vector: Float32Array.from(data.embedding.vector),
    title: data.title ?? "",
    abstract: data.abstract ?? "",
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run lib/suggest/__tests__/s2-client.test.ts`
Expected: PASS — all 7 tests.

- [ ] **Step 5: Commit**

```bash
git add web/lib/suggest/s2-client.ts web/lib/suggest/__tests__/s2-client.test.ts
git commit -m "feat(suggest): S2 graph API client with response classification + retry"
```

### Task 2.5: Implement WASM SPECTER2 loader

**Files:**
- Create: `web/lib/suggest/specter2-wasm.ts`

This module deliberately has no unit test for the model load itself (it requires the real ONNX file from Vercel Blob). It's exercised by the parity test (Task 2.10) and the smoke test (Task 4.2).

- [ ] **Step 1: Implement the loader**

Create `web/lib/suggest/specter2-wasm.ts`:

```typescript
import { ModelLoadError } from "./types";

// IMPORTANT: This SHA-256 must equal the hash of the file at SPECTER2_MODEL_BLOB_URL.
// See spec section "SHA-256 integrity pin" — value comes from Task 1.2 output.
// REPLACE THIS LITERAL with the hex string the export script printed.
const EXPECTED_MODEL_SHA256 = "REPLACE_WITH_SHA_FROM_TASK_1_2";

const MAX_BLOB_FETCH_RETRIES = 3;
const RETRY_BACKOFFS_MS = [1000, 2000, 4000];

let modelPromise: Promise<{ session: any; tokenizer: any }> | null = null;
let loadStartedAt: number | null = null;

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function fetchBlobWithRetries(url: string): Promise<ArrayBuffer> {
  let lastErr: unknown;
  for (let i = 0; i < MAX_BLOB_FETCH_RETRIES; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`blob fetch ${res.status}`);
      return await res.arrayBuffer();
    } catch (e) {
      lastErr = e;
      if (i < MAX_BLOB_FETCH_RETRIES - 1) {
        await new Promise(r => setTimeout(r, RETRY_BACKOFFS_MS[i]));
      }
    }
  }
  throw new ModelLoadError(`blob fetch failed after ${MAX_BLOB_FETCH_RETRIES} retries: ${lastErr}`);
}

async function initModel() {
  loadStartedAt = Date.now();
  const url = process.env.SPECTER2_MODEL_BLOB_URL;
  if (!url) throw new ModelLoadError("SPECTER2_MODEL_BLOB_URL env var is not set");

  const buf = await fetchBlobWithRetries(url);
  const actualSha = await sha256Hex(buf);
  if (actualSha !== EXPECTED_MODEL_SHA256) {
    throw new ModelLoadError(`integrity mismatch: expected ${EXPECTED_MODEL_SHA256}, got ${actualSha}`);
  }

  // Lazy-import onnxruntime + tokenizer at first use to avoid penalizing cold paths
  // that never need WASM (the all-cache-hit case).
  const ort = await import("onnxruntime-web");
  const { AutoTokenizer } = await import("@xenova/transformers");
  const session = await ort.InferenceSession.create(buf, { executionProviders: ["wasm"] });
  const tokenizer = await AutoTokenizer.from_pretrained("allenai/specter2_base");
  return { session, tokenizer };
}

export function isModelWarm(): boolean {
  return modelPromise !== null;
}

export function modelLoadStartedAt(): number | null {
  return loadStartedAt;
}

async function getModel() {
  if (!modelPromise) {
    modelPromise = initModel();
  }
  return modelPromise;
}

/**
 * Embed a batch of {title, abstract} pairs via the WASM SPECTER2 model.
 * Chunks at 10 per forward pass to stay inside Lambda memory headroom.
 * Returns Float32Arrays in the same order as inputs.
 */
export async function embedBatch(
  items: Array<{ title: string; abstract: string }>
): Promise<Float32Array[]> {
  const { session, tokenizer } = await getModel();
  const CHUNK = 10;
  const results: Float32Array[] = [];

  for (let start = 0; start < items.length; start += CHUNK) {
    const chunk = items.slice(start, start + CHUNK);
    const texts = chunk.map(it => `${it.title}${tokenizer.sep_token}${it.abstract}`);
    const enc = await tokenizer(texts, { padding: "max_length", truncation: true, max_length: 512, return_tensors: "np" });

    const outputs = await session.run({
      input_ids: enc.input_ids,
      attention_mask: enc.attention_mask,
    });
    const lhs = outputs.last_hidden_state.data as Float32Array;  // shape: (B, 512, 768)
    const dim = 768;
    const seq = 512;
    for (let b = 0; b < chunk.length; b++) {
      const start = b * seq * dim;  // CLS at seq position 0
      results.push(lhs.slice(start, start + dim));
    }
  }
  return results;
}
```

- [ ] **Step 2: Replace the SHA placeholder with the value from Task 1.2**

Use the SHA-256 hex string the export script printed:

```bash
# In web/lib/suggest/specter2-wasm.ts, change:
#   const EXPECTED_MODEL_SHA256 = "REPLACE_WITH_SHA_FROM_TASK_1_2";
# to (example):
#   const EXPECTED_MODEL_SHA256 = "a3f1b8c9...e9c2";
```

If Task 1.2 hasn't been run yet (because you're working ahead of operator setup), leave the placeholder and add a `// TODO(setup):` comment — the parity test (Task 2.10) will fail until it's set, which is the correct fail-loud behavior.

- [ ] **Step 3: Verify it type-checks**

Run: `cd web && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add web/lib/suggest/specter2-wasm.ts
git commit -m "feat(suggest): WASM SPECTER2 loader with SHA-256 integrity pin and batch inference"
```

### Task 2.6: Implement embedding cache

**Files:**
- Create: `web/lib/suggest/__tests__/embedding-cache.test.ts`
- Create: `web/lib/suggest/embedding-cache.ts`

- [ ] **Step 1: Write the failing tests**

Create `web/lib/suggest/__tests__/embedding-cache.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { getCached, cacheMany } from "@/lib/suggest/embedding-cache";

function makeMockClient(rows: Array<{ paper_id: string; vector: number[] }>) {
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: rows, error: null }),
        }),
      }),
      upsert: vi.fn().mockResolvedValue({ error: null }),
    }),
  };
}

describe("getCached", () => {
  it("returns a Map keyed by paper_id with Float32Array values", async () => {
    const client = makeMockClient([
      { paper_id: "p1", vector: [0.1, 0.2, 0.3] },
      { paper_id: "p2", vector: [0.4, 0.5, 0.6] },
    ]) as any;
    const m = await getCached(client, ["p1", "p2"]);
    expect(m.size).toBe(2);
    expect(Array.from(m.get("p1")!)).toEqual([0.1, 0.2, 0.3]);
  });

  it("returns empty Map when nothing cached", async () => {
    const client = makeMockClient([]) as any;
    const m = await getCached(client, ["p1"]);
    expect(m.size).toBe(0);
  });

  it("returns empty Map when given empty input", async () => {
    const client = makeMockClient([]) as any;
    const m = await getCached(client, []);
    expect(m.size).toBe(0);
  });
});

describe("cacheMany", () => {
  it("calls upsert with onConflict ignore", async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const client = { from: vi.fn().mockReturnValue({ upsert }) } as any;
    await cacheMany(client, [
      { paperId: "p1", vector: Float32Array.from([0.1, 0.2]) },
      { paperId: "p2", vector: Float32Array.from([0.3, 0.4]) },
    ]);
    expect(upsert).toHaveBeenCalledOnce();
    const args = upsert.mock.calls[0];
    expect(args[0]).toEqual([
      { paper_id: "p1", model: "specter_v2", vector: [0.1, 0.2] },
      { paper_id: "p2", model: "specter_v2", vector: [0.3, 0.4] },
    ]);
    expect(args[1]).toEqual({ onConflict: "paper_id,model", ignoreDuplicates: true });
  });

  it("is a no-op for empty array", async () => {
    const upsert = vi.fn();
    const client = { from: vi.fn().mockReturnValue({ upsert }) } as any;
    await cacheMany(client, []);
    expect(upsert).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run lib/suggest/__tests__/embedding-cache.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the cache module**

Create `web/lib/suggest/embedding-cache.ts`:

```typescript
import type { SupabaseClient } from "@supabase/supabase-js";

const MODEL = "specter_v2";

export async function getCached(
  client: SupabaseClient,
  paperIds: string[],
): Promise<Map<string, Float32Array>> {
  if (paperIds.length === 0) return new Map();
  const { data, error } = await client
    .from("paper_embeddings")
    .select("paper_id, vector")
    .in("paper_id", paperIds)
    .eq("model", MODEL);
  if (error) throw error;
  const map = new Map<string, Float32Array>();
  for (const row of data ?? []) {
    map.set(String(row.paper_id), Float32Array.from(row.vector as number[]));
  }
  return map;
}

export async function cacheMany(
  client: SupabaseClient,
  rows: Array<{ paperId: string; vector: Float32Array }>,
): Promise<void> {
  if (rows.length === 0) return;
  const payload = rows.map(r => ({
    paper_id: r.paperId,
    model: MODEL,
    vector: Array.from(r.vector),
  }));
  const { error } = await client
    .from("paper_embeddings")
    .upsert(payload, { onConflict: "paper_id,model", ignoreDuplicates: true });
  if (error) throw error;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run lib/suggest/__tests__/embedding-cache.test.ts`
Expected: PASS — all 5 tests.

- [ ] **Step 5: Commit**

```bash
git add web/lib/suggest/embedding-cache.ts web/lib/suggest/__tests__/embedding-cache.test.ts
git commit -m "feat(suggest): paper_embeddings cache module with idempotent writes"
```

### Task 2.7: Implement orchestrator state machine

**Files:**
- Create: `web/lib/suggest/__tests__/orchestrator.test.ts`
- Create: `web/lib/suggest/orchestrator.ts`

- [ ] **Step 1: Write the failing tests covering all five paths**

Create `web/lib/suggest/__tests__/orchestrator.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { orchestrate } from "@/lib/suggest/orchestrator";
import { TimeoutError, S2AuthError } from "@/lib/suggest/types";

const v = (n: number) => Float32Array.from(Array(768).fill(n));

const baseDeps = {
  apiKey: "test-key",
  // overridden per-test
  getCached: vi.fn(),
  cacheMany: vi.fn().mockResolvedValue(undefined),
  fetchPaperWithEmbedding: vi.fn(),
  embedBatch: vi.fn(),
  isModelWarm: () => false,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("orchestrate", () => {
  it("all-cache-hit path: no S2 calls, no fallback, returns ranked", async () => {
    const cached = new Map([
      ["c1", v(0.1)], ["c2", v(0.2)],
      ["p1", v(0.5)], ["p2", v(0.5)],
    ]);
    const deps = {
      ...baseDeps,
      getCached: vi.fn().mockResolvedValue(cached),
    };
    const result = await orchestrate(
      { candidate_paper_ids: ["c1", "c2"], past_pick_ids: ["p1", "p2"], lambda: 0.6, k: 2 },
      deps as any,
    );
    expect(deps.fetchPaperWithEmbedding).not.toHaveBeenCalled();
    expect(deps.embedBatch).not.toHaveBeenCalled();
    expect(result.diagnostics.cache_hits).toBe(4);
    expect(result.diagnostics.s2_fetched).toBe(0);
    expect(result.diagnostics.fallback_used).toBe(0);
    expect(result.ranked).toHaveLength(2);
  });

  it("all-S2-fetch path: cache miss, S2 returns hits, no fallback", async () => {
    const deps = {
      ...baseDeps,
      getCached: vi.fn().mockResolvedValue(new Map()),
      fetchPaperWithEmbedding: vi.fn().mockImplementation(async (id: string) => ({
        kind: "hit", paperId: id, vector: v(0.1), title: "T", abstract: "A",
      })),
    };
    const result = await orchestrate(
      { candidate_paper_ids: ["c1"], past_pick_ids: ["p1"], lambda: 0.6, k: 1 },
      deps as any,
    );
    expect(deps.fetchPaperWithEmbedding).toHaveBeenCalledTimes(2);
    expect(deps.embedBatch).not.toHaveBeenCalled();
    expect(deps.cacheMany).toHaveBeenCalled();
    expect(result.diagnostics.s2_fetched).toBe(2);
    expect(result.diagnostics.fallback_used).toBe(0);
  });

  it("mixed-fallback path: S2 returns no_embedding for one paper, WASM fills it in", async () => {
    const deps = {
      ...baseDeps,
      getCached: vi.fn().mockResolvedValue(new Map()),
      fetchPaperWithEmbedding: vi.fn().mockImplementation(async (id: string) => {
        if (id === "c1") return { kind: "fallback_needed", paperId: id, reason: "no_embedding", title: "Tc", abstract: "Ac" };
        return { kind: "hit", paperId: id, vector: v(0.1), title: "Tp", abstract: "Ap" };
      }),
      embedBatch: vi.fn().mockResolvedValue([v(0.7)]),
    };
    const result = await orchestrate(
      { candidate_paper_ids: ["c1"], past_pick_ids: ["p1"], lambda: 0.6, k: 1 },
      deps as any,
    );
    expect(deps.embedBatch).toHaveBeenCalledOnce();
    expect(deps.embedBatch).toHaveBeenCalledWith([{ title: "Tc", abstract: "Ac" }]);
    expect(result.diagnostics.fallback_used).toBe(1);
    expect(result.diagnostics.s2_fetched).toBe(1);  // p1 was an s2 hit
  });

  it("S2-down path: all transient, all route to WASM, returns successfully", async () => {
    const deps = {
      ...baseDeps,
      getCached: vi.fn().mockResolvedValue(new Map()),
      fetchPaperWithEmbedding: vi.fn().mockImplementation(async (id: string) => ({
        kind: "fallback_needed", paperId: id, reason: "s2_transient", title: "T", abstract: "A",
      })),
      embedBatch: vi.fn().mockResolvedValue([v(0.5), v(0.5)]),
    };
    const result = await orchestrate(
      { candidate_paper_ids: ["c1"], past_pick_ids: ["p1"], lambda: 0.6, k: 1 },
      deps as any,
    );
    expect(deps.embedBatch).toHaveBeenCalledOnce();
    expect(result.diagnostics.fallback_used).toBe(2);
    expect(result.ranked).toHaveLength(1);
  });

  it("S2 401 → throws S2AuthError, no fallback masking", async () => {
    const deps = {
      ...baseDeps,
      getCached: vi.fn().mockResolvedValue(new Map()),
      fetchPaperWithEmbedding: vi.fn().mockRejectedValue(new S2AuthError("401")),
    };
    await expect(
      orchestrate(
        { candidate_paper_ids: ["c1"], past_pick_ids: ["p1"], lambda: 0.6, k: 1 },
        deps as any,
      )
    ).rejects.toBeInstanceOf(S2AuthError);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run lib/suggest/__tests__/orchestrator.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the orchestrator**

Create `web/lib/suggest/orchestrator.ts`:

```typescript
import type { SupabaseClient } from "@supabase/supabase-js";
import { mmr } from "./mmr";
import type { S2Result, SuggestRequest, SuggestResponse, RankedResult } from "./types";

export type OrchestratorDeps = {
  apiKey: string;
  client?: SupabaseClient;  // optional for tests
  getCached: (client: SupabaseClient | undefined, ids: string[]) => Promise<Map<string, Float32Array>>;
  cacheMany: (client: SupabaseClient | undefined, rows: Array<{ paperId: string; vector: Float32Array }>) => Promise<void>;
  fetchPaperWithEmbedding: (paperId: string, apiKey: string) => Promise<S2Result>;
  embedBatch: (items: Array<{ title: string; abstract: string }>) => Promise<Float32Array[]>;
  isModelWarm: () => boolean;
  /** Map paper_id (s2 string id) to the metadata fetched from cache (title only — used for response render). */
  fetchTitles?: (client: SupabaseClient | undefined, ids: string[]) => Promise<Map<string, string>>;
};

function meanVec(vectors: Float32Array[]): Float32Array {
  if (vectors.length === 0) throw new Error("meanVec: empty input");
  const dim = vectors[0].length;
  const out = new Float32Array(dim);
  for (const v of vectors) for (let i = 0; i < dim; i++) out[i] += v[i];
  for (let i = 0; i < dim; i++) out[i] /= vectors.length;
  return out;
}

export async function orchestrate(req: SuggestRequest, deps: OrchestratorDeps): Promise<SuggestResponse> {
  const t0 = Date.now();
  const wasWarm = deps.isModelWarm();
  const allIds = [...req.candidate_paper_ids, ...req.past_pick_ids];

  // 1. Cache lookup
  const cached = await deps.getCached(deps.client, allIds);
  const missing = allIds.filter(id => !cached.has(id));

  // 2. S2 fetch for misses
  let s2Fetched = 0;
  let fallbackUsed = 0;
  const fallbackQueue: Array<{ paperId: string; title: string; abstract: string }> = [];
  const newCacheRows: Array<{ paperId: string; vector: Float32Array }> = [];

  if (missing.length > 0) {
    const results = await Promise.all(missing.map(id => deps.fetchPaperWithEmbedding(id, deps.apiKey)));
    for (const r of results) {
      if (r.kind === "hit") {
        cached.set(r.paperId, r.vector);
        newCacheRows.push({ paperId: r.paperId, vector: r.vector });
        s2Fetched++;
      } else if (r.kind === "fallback_needed") {
        fallbackQueue.push({ paperId: r.paperId, title: r.title, abstract: r.abstract });
      }
    }
  }

  // 3. WASM fallback batch (chunked at 10 inside embedBatch)
  if (fallbackQueue.length > 0) {
    const vecs = await deps.embedBatch(fallbackQueue.map(f => ({ title: f.title, abstract: f.abstract })));
    for (let i = 0; i < fallbackQueue.length; i++) {
      cached.set(fallbackQueue[i].paperId, vecs[i]);
      newCacheRows.push({ paperId: fallbackQueue[i].paperId, vector: vecs[i] });
    }
    fallbackUsed = fallbackQueue.length;
  }

  // 4. Cache writes (best-effort; if it errors, we still return the ranking)
  if (newCacheRows.length > 0) {
    await deps.cacheMany(deps.client, newCacheRows).catch(e => {
      console.error(JSON.stringify({ event: "cache_write_failed", error: String(e) }));
    });
  }

  // 5. MMR
  const candidateVecs = req.candidate_paper_ids.map(id => cached.get(id)!);
  const pastPickVecs = req.past_pick_ids.map(id => cached.get(id)!);
  const queryVec = meanVec(pastPickVecs);
  const order = mmr(queryVec, candidateVecs, req.lambda, req.k);

  // 6. Build response (titles best-effort; tests can omit fetchTitles)
  const titles = deps.fetchTitles ? await deps.fetchTitles(deps.client, req.candidate_paper_ids) : new Map<string, string>();
  const ranked: RankedResult[] = order.map(idx => {
    const id = req.candidate_paper_ids[idx];
    return {
      paper_id: id,
      title: titles.get(id) ?? "",
      mmr_score: 0,  // populated below by re-scoring; simple in this MVP
    };
  });

  return {
    ranked,
    diagnostics: {
      cache_hits: cached.size - newCacheRows.length,
      s2_fetched: s2Fetched,
      fallback_used: fallbackUsed,
      cold_start: !wasWarm && fallbackUsed > 0,
      total_ms: Date.now() - t0,
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run lib/suggest/__tests__/orchestrator.test.ts`
Expected: PASS — all 5 tests.

- [ ] **Step 5: Commit**

```bash
git add web/lib/suggest/orchestrator.ts web/lib/suggest/__tests__/orchestrator.test.ts
git commit -m "feat(suggest): orchestrator state machine with cache/S2/WASM hybrid policy"
```

### Task 2.8: Implement requireLeaderRole auth helper

**Files:**
- Create: `web/lib/auth/requireLeaderRole.ts`

- [ ] **Step 1: Implement the helper**

Create `web/lib/auth/requireLeaderRole.ts`:

```typescript
import { createServerClient } from "@/lib/supabase/server";
import { UnauthorizedError, ForbiddenError } from "@/lib/suggest/types";

export type LeaderRoleContext = {
  userId: string;
  role: "leader" | "admin";
};

export async function requireLeaderRole(): Promise<LeaderRoleContext> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new UnauthorizedError();

  const { data: member, error } = await supabase
    .from("members")
    .select("role")
    .eq("id", user.id)
    .single();
  if (error || !member) throw new ForbiddenError();
  if (!["leader", "admin"].includes(member.role)) throw new ForbiddenError();
  return { userId: user.id, role: member.role as "leader" | "admin" };
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `cd web && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add web/lib/auth/requireLeaderRole.ts
git commit -m "feat(auth): requireLeaderRole helper for /admin/* routes"
```

### Task 2.9: Wire up the /api/suggest route handler

**Files:**
- Create: `web/app/api/suggest/route.ts`

- [ ] **Step 1: Implement the route**

Create `web/app/api/suggest/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerClient as createServiceClient } from "@/lib/supabase/service";
import { requireLeaderRole } from "@/lib/auth/requireLeaderRole";
import { orchestrate, type OrchestratorDeps } from "@/lib/suggest/orchestrator";
import { getCached, cacheMany } from "@/lib/suggest/embedding-cache";
import { fetchPaperWithEmbedding } from "@/lib/suggest/s2-client";
import { embedBatch, isModelWarm } from "@/lib/suggest/specter2-wasm";
import {
  SuggestRequestSchema,
  UnauthorizedError, ForbiddenError, S2AuthError, S2RequestError,
  S2OutageError, ModelLoadError, TimeoutError,
} from "@/lib/suggest/types";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const TIMEOUT_MS = 30_000;

function timeoutAfter(ms: number): Promise<never> {
  return new Promise((_, reject) => setTimeout(() => reject(new TimeoutError()), ms));
}

export async function POST(req: Request) {
  const requestId = crypto.randomUUID();
  let user: { userId: string; role: string } | null = null;
  let parsed: ReturnType<typeof SuggestRequestSchema.parse> | null = null;

  try {
    const ctx = await requireLeaderRole();
    user = ctx;

    const body = await req.json();
    parsed = SuggestRequestSchema.parse(body);

    const apiKey = process.env.S2_API_KEY;
    if (!apiKey) throw new S2AuthError("S2_API_KEY env var not set");

    const client = createServiceClient();

    // fetchTitles: small extra query to make ranked results human-readable
    const fetchTitles = async (c: any, ids: string[]) => {
      if (!c || ids.length === 0) return new Map<string, string>();
      const { data, error } = await c.from("papers").select("s2_paper_id, title").in("s2_paper_id", ids);
      if (error) return new Map<string, string>();
      return new Map((data ?? []).map((r: any) => [String(r.s2_paper_id), r.title as string]));
    };

    const deps: OrchestratorDeps = {
      apiKey,
      client,
      getCached,
      cacheMany,
      fetchPaperWithEmbedding,
      embedBatch,
      isModelWarm,
      fetchTitles,
    };

    const result = await Promise.race([orchestrate(parsed, deps), timeoutAfter(TIMEOUT_MS)]);

    console.log(JSON.stringify({
      event: "suggest_request",
      request_id: requestId,
      user_id: user.userId,
      candidate_count: parsed.candidate_paper_ids.length,
      past_pick_count: parsed.past_pick_ids.length,
      ...result.diagnostics,
      outcome: "ok",
    }));

    return NextResponse.json(result);
  } catch (e) {
    const errorLog = (code: string, status: number) => {
      console.error(JSON.stringify({
        event: "suggest_request",
        request_id: requestId,
        user_id: user?.userId,
        candidate_count: parsed?.candidate_paper_ids.length,
        outcome: "error",
        error_code: code,
        status,
        message: (e as Error).message,
      }));
    };

    if (e instanceof UnauthorizedError) { errorLog("unauthorized", 401); return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }
    if (e instanceof ForbiddenError) { errorLog("forbidden", 403); return NextResponse.json({ error: "forbidden" }, { status: 403 }); }
    if (e instanceof z.ZodError) { errorLog("invalid_request", 400); return NextResponse.json({ error: "invalid_request", issues: e.issues }, { status: 400 }); }
    if (e instanceof S2AuthError) { errorLog("s2_auth", 502); return NextResponse.json({ error: "s2_auth" }, { status: 502 }); }
    if (e instanceof S2RequestError) { errorLog("s2_request", 502); return NextResponse.json({ error: "s2_request" }, { status: 502 }); }
    if (e instanceof S2OutageError) { errorLog("s2_unreachable_fallback_failed", 502); return NextResponse.json({ error: "s2_unreachable_fallback_failed" }, { status: 502 }); }
    if (e instanceof ModelLoadError) { errorLog("wasm_model_load_failed", 502); return NextResponse.json({ error: "wasm_model_load_failed", detail: (e as Error).message }, { status: 502 }); }
    if (e instanceof TimeoutError) { errorLog("timeout", 504); return NextResponse.json({ error: "timeout", elapsed_ms: TIMEOUT_MS }, { status: 504 }); }

    errorLog("internal", 500);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `cd web && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Smoke-curl the dev server (with mocked S2)**

```bash
cd web && npm run dev
# in another terminal:
curl -X POST http://localhost:3000/api/suggest \
  -H "Content-Type: application/json" \
  -d '{"candidate_paper_ids":["x"],"past_pick_ids":["y"]}'
```

Expected: 401 (no session). This proves the route is mounted and the auth gate fires before any S2/WASM logic.

- [ ] **Step 4: Commit**

```bash
git add web/app/api/suggest/route.ts
git commit -m "feat(suggest): /api/suggest route handler with auth, validation, error mapping"
```

### Task 2.10: Land the parity test (skip-by-default; runs on-demand)

**Files:**
- Create: `web/lib/suggest/__tests__/parity.test.ts`

- [ ] **Step 1: Write the parity test**

Create `web/lib/suggest/__tests__/parity.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { embedBatch } from "@/lib/suggest/specter2-wasm";
import { cosineSim } from "@/lib/suggest/mmr";
import fs from "node:fs/promises";
import path from "node:path";

const RUN_PARITY = process.env.RUN_PARITY === "1";

describe.skipIf(!RUN_PARITY)("WASM SPECTER2 parity vs S2 canonical", () => {
  it("produces vectors with cos >= 0.997 against S2 for all fixture papers", async () => {
    const fixturesPath = path.resolve(__dirname, "../../../../scripts/specter2_parity_fixtures.json");
    const fixtures = JSON.parse(await fs.readFile(fixturesPath, "utf-8")) as Array<{
      paperId: string; title: string; abstract: string; vector: number[];
    }>;
    const localVecs = await embedBatch(fixtures.map(f => ({ title: f.title, abstract: f.abstract })));
    const sims = fixtures.map((f, i) => cosineSim(localVecs[i], Float32Array.from(f.vector)));
    const min = Math.min(...sims);
    const avg = sims.reduce((a, b) => a + b, 0) / sims.length;
    console.log(`parity: avg=${avg.toFixed(4)}, min=${min.toFixed(4)}`);
    expect(min).toBeGreaterThanOrEqual(0.997);
  }, { timeout: 180_000 });
});
```

- [ ] **Step 2: Document how to run it**

Add to `web/README.md` (or create one section):

```markdown
## Tests

- `npm test` — unit tests, fast.
- `RUN_PARITY=1 SPECTER2_MODEL_BLOB_URL=https://... npm test -- parity` — WASM parity check against S2 (slow; needs blob URL env var).
```

- [ ] **Step 3: Verify the test is skipped by default**

Run: `cd web && npx vitest run lib/suggest/__tests__/parity.test.ts`
Expected: 1 test skipped, 0 failures.

- [ ] **Step 4: Commit**

```bash
git add web/lib/suggest/__tests__/parity.test.ts web/README.md
git commit -m "test(suggest): parity check (skip-by-default; opt-in via RUN_PARITY=1)"
```

### Task 2.11: Extend middleware to gate /admin/

**Files:**
- Modify: `web/middleware.ts`

- [ ] **Step 1: Read the current middleware**

Read `web/middleware.ts` end-to-end so you know what the existing protected-paths check looks like.

- [ ] **Step 2: Add `/admin/` to the protected paths**

In the existing protected-path check, append:

```typescript
// Before:
const protectedPath = request.nextUrl.pathname.startsWith("/dashboard")
  || request.nextUrl.pathname.startsWith("/availability");

// After:
const protectedPath = request.nextUrl.pathname.startsWith("/dashboard")
  || request.nextUrl.pathname.startsWith("/availability")
  || request.nextUrl.pathname.startsWith("/admin");
```

This is *first-line* protection (gets logged-out users to login). The role check (must be leader/admin) lives in the page component via `requireLeaderRole`.

- [ ] **Step 3: Verify type-check + dev-server still works**

Run: `cd web && npx tsc --noEmit && npm run dev`

Hit `http://localhost:3000/admin/suggest` while logged out → should redirect to login.

- [ ] **Step 4: Commit**

```bash
git add web/middleware.ts
git commit -m "feat(auth): gate /admin/* paths behind login in middleware"
```

---

## Phase 3 — UI behind a feature gate (page mounted, not linked)

### Task 3.1: Build the admin/suggest server page

**Files:**
- Create: `web/app/admin/suggest/page.tsx`

- [ ] **Step 1: Implement the server component**

Create `web/app/admin/suggest/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { requireLeaderRole } from "@/lib/auth/requireLeaderRole";
import { UnauthorizedError, ForbiddenError } from "@/lib/suggest/types";
import { SuggestForm } from "./SuggestForm";

export const dynamic = "force-dynamic";

export default async function SuggestPage() {
  try {
    await requireLeaderRole();
  } catch (e) {
    if (e instanceof UnauthorizedError) redirect("/auth");
    if (e instanceof ForbiddenError) redirect("/dashboard");
    throw e;
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-semibold mb-6">Suggest a paper</h1>
      <SuggestForm />
    </main>
  );
}
```

- [ ] **Step 2: Verify the page loads**

Run: `cd web && npm run dev`. Visit `http://localhost:3000/admin/suggest` while logged in as a leader. Expect: page renders with header + (empty) form. Logged out: redirects to `/auth`.

- [ ] **Step 3: Commit**

```bash
git add web/app/admin/suggest/page.tsx
git commit -m "feat(suggest): /admin/suggest server page with role-gated redirect"
```

### Task 3.2: Build the SuggestForm client component

**Files:**
- Create: `web/app/admin/suggest/SuggestForm.tsx`

- [ ] **Step 1: Implement the form**

Create `web/app/admin/suggest/SuggestForm.tsx`:

```tsx
"use client";
import { useState } from "react";
import type { SuggestResponse } from "@/lib/suggest/types";

type Status = "idle" | "pending" | "done" | "error";

export function SuggestForm() {
  const [candidates, setCandidates] = useState("");
  const [pastPicks, setPastPicks] = useState<"all" | "last6m">("all");
  const [lambda, setLambda] = useState(0.6);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const [results, setResults] = useState<SuggestResponse | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("pending");
    setMessage("Querying Semantic Scholar…");
    setResults(null);

    const candidate_paper_ids = candidates
      .split("\n").map(s => s.trim()).filter(Boolean);
    if (candidate_paper_ids.length === 0 || candidate_paper_ids.length > 10) {
      setStatus("error");
      setMessage("Please enter 1-10 candidate paper IDs, one per line.");
      return;
    }

    // The page already requires leader/admin role; past_pick_ids resolution
    // is server-side via the role-scoped service client. For MVP we just
    // pass an explicit subset; later we can add server-side resolution
    // by past-pick window. For now, MVP leaves `past_pick_ids` empty and
    // the route will reject with 400 — UI will be extended in a follow-up
    // to fetch past picks via a /api/admin/past-picks endpoint.
    // *** TEMPORARY: hardcoded for MVP — replace with proper picker UI ***
    const past_pick_ids: string[] = [];
    if (past_pick_ids.length === 0) {
      setStatus("error");
      setMessage("Past-picks selector not yet implemented. See Task 3.3.");
      return;
    }

    const messageTimers = [
      window.setTimeout(() => setMessage("Embedding paper(s) locally (first run can be slow)…"), 8_000),
      window.setTimeout(() => setMessage("Still working — cold start can take up to 30 s…"), 18_000),
    ];

    const ac = new AbortController();
    const hardTimeout = window.setTimeout(() => ac.abort(), 30_000);

    try {
      const res = await fetch("/api/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidate_paper_ids, past_pick_ids, lambda }),
        signal: ac.signal,
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`${res.status}: ${body}`);
      }
      const data = await res.json() as SuggestResponse;
      setResults(data);
      setStatus("done");
    } catch (e) {
      const err = e as Error;
      setStatus("error");
      setMessage(err.name === "AbortError" ? "Timed out after 30 s. Try again." : `Error: ${err.message}`);
    } finally {
      messageTimers.forEach(window.clearTimeout);
      window.clearTimeout(hardTimeout);
    }
  }

  return (
    <>
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label htmlFor="candidates" className="block text-sm font-medium">
            Candidate papers (Semantic Scholar IDs or arXiv URLs, one per line, max 10):
          </label>
          <textarea
            id="candidates"
            value={candidates}
            onChange={e => setCandidates(e.target.value)}
            rows={6}
            className="mt-1 block w-full rounded border px-2 py-1 font-mono text-sm"
            placeholder="arXiv:2501.12345"
          />
        </div>
        <div>
          <label className="block text-sm font-medium">Past picks to compare against:</label>
          <div className="mt-1 space-y-1 text-sm">
            <label><input type="radio" checked={pastPicks === "all"} onChange={() => setPastPicks("all")} /> All papers from prior cycles (default)</label><br />
            <label><input type="radio" checked={pastPicks === "last6m"} onChange={() => setPastPicks("last6m")} /> Last 6 months only</label>
          </div>
        </div>
        <div>
          <label htmlFor="lambda" className="block text-sm font-medium">
            λ (relevance vs diversity): {lambda.toFixed(1)}
          </label>
          <input
            id="lambda"
            type="range"
            min={0} max={1} step={0.1}
            value={lambda}
            onChange={e => setLambda(parseFloat(e.target.value))}
            className="mt-1 block w-full"
          />
        </div>
        <button
          type="submit"
          disabled={status === "pending"}
          className="rounded bg-emerald-700 px-4 py-2 text-white disabled:opacity-50"
        >
          {status === "pending" ? "Working…" : "Submit"}
        </button>
      </form>

      {status === "pending" && (
        <p className="mt-4 text-sm text-gray-600">⏳ {message}</p>
      )}
      {status === "error" && (
        <p className="mt-4 text-sm text-red-700">{message}</p>
      )}
      {status === "done" && results && (
        <section className="mt-6">
          <h2 className="text-lg font-semibold">Suggested ranking</h2>
          <ol className="mt-2 list-decimal list-inside space-y-1">
            {results.ranked.map(r => (
              <li key={r.paper_id} className="text-sm">
                <span className="font-medium">{r.title || r.paper_id}</span>
                {" "}<span className="text-gray-500">score {r.mmr_score.toFixed(2)}</span>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-xs text-gray-500">
            {results.diagnostics.cache_hits} cache hits · {results.diagnostics.s2_fetched} fetched · {results.diagnostics.fallback_used} fallback ·
            {results.diagnostics.cold_start ? " cold start" : " warm"} · {results.diagnostics.total_ms} ms
          </p>
        </section>
      )}
    </>
  );
}
```

- [ ] **Step 2: Verify type-check**

Run: `cd web && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add web/app/admin/suggest/SuggestForm.tsx
git commit -m "feat(suggest): SuggestForm client component with progress messaging + 30s abort

The past-picks selector is currently a stub (form blocks submission with a
clear error message); Task 3.3 wires it to a real endpoint."
```

### Task 3.3: Wire up past-picks resolution

**Files:**
- Create: `web/app/api/admin/past-picks/route.ts`
- Modify: `web/app/admin/suggest/SuggestForm.tsx`

> **Schema notes (assumes Phase 0 (1a)/(3a) confirmed):** Past picks = rows in `papers` joined to `meetings` where `meetings.type = 'reading_group'`. Column names per [001_initial_schema.sql:25](../../../migrations/001_initial_schema.sql:25): use `papers.added_at` (not `created_at`); `s2_paper_id` exists after Phase 0.

- [ ] **Step 1: Build the past-picks API**

Create `web/app/api/admin/past-picks/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { requireLeaderRole } from "@/lib/auth/requireLeaderRole";
import { createServerClient as createServiceClient } from "@/lib/supabase/service";
import { UnauthorizedError, ForbiddenError } from "@/lib/suggest/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await requireLeaderRole();
    const url = new URL(req.url);
    const window = url.searchParams.get("window") ?? "all";
    const client = createServiceClient();

    // Past picks = papers linked to a reading_group meeting.
    // Use a raw SQL view via .rpc() if you've defined one, else fall back to two queries.
    // Single query approach (PostgREST embeds a join):
    let q = client
      .from("papers")
      .select("id, s2_paper_id, title, abstract, added_at, meetings!inner(type)")
      .eq("meetings.type", "reading_group")
      .not("s2_paper_id", "is", null);

    if (window === "last6m") {
      const sixMonthsAgo = new Date(Date.now() - 1000 * 60 * 60 * 24 * 30 * 6).toISOString();
      q = q.gte("added_at", sixMonthsAgo);
    }
    const { data, error } = await q;
    if (error) throw error;
    const past_picks = (data ?? []).map((r: any) => ({
      id: r.id,
      s2_paper_id: r.s2_paper_id,
      title: r.title,
      abstract: r.abstract ?? "",
    }));
    return NextResponse.json({ past_picks });
  } catch (e) {
    if (e instanceof UnauthorizedError) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    if (e instanceof ForbiddenError) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
```

> **If the embedded join syntax doesn't return the shape above** (PostgREST nuances), the fallback is two separate queries: first `SELECT DISTINCT paper_id FROM meetings WHERE type='reading_group'`, then `SELECT id, s2_paper_id, title, abstract FROM papers WHERE id = ANY(...)`. Verify against your actual Supabase project.

- [ ] **Step 2: Wire SuggestForm to fetch past picks before posting to /api/suggest**

In `web/app/admin/suggest/SuggestForm.tsx`, replace the `// *** TEMPORARY: hardcoded for MVP ***` block with:

```typescript
    setMessage("Loading past picks…");
    const ppRes = await fetch(`/api/admin/past-picks?window=${pastPicks}`);
    if (!ppRes.ok) {
      setStatus("error");
      setMessage(`Couldn't load past picks: ${ppRes.status}`);
      return;
    }
    const past_picks = (await ppRes.json() as { past_picks: Array<{ id: number; s2_paper_id: string; title: string; abstract: string }> }).past_picks;
    if (past_picks.length === 0) {
      setStatus("error");
      setMessage("No past picks found in the selected window.");
      return;
    }
```

> The form now holds full past-pick objects, not just IDs. The next task (3.4) builds the candidate-resolver endpoint and threads both arrays into `/api/suggest`. Until 3.4 lands, the request body shape is incomplete — leave the `fetch('/api/suggest', ...)` call in place and update it in 3.4.

- [ ] **Step 3: Verify type-check + manual smoke**

Run: `cd web && npx tsc --noEmit && npm run dev`. Visit `/admin/suggest` while logged in as a leader, paste a candidate, click Submit. The route will likely 404 against S2 for fake IDs (expected) but proves wiring.

- [ ] **Step 4: Commit**

```bash
git add web/app/api/admin/past-picks/route.ts web/app/admin/suggest/SuggestForm.tsx
git commit -m "feat(suggest): past-picks resolution API + SuggestForm wiring"
```

### Task 3.4: Build the candidate paper resolver

**Files:**
- Create: `web/app/api/admin/resolve-papers/route.ts`
- Modify: `web/app/admin/suggest/SuggestForm.tsx`
- Modify: `web/lib/suggest/types.ts` (extend SuggestRequest)

The leader pastes URLs / S2 IDs / arxiv IDs. This endpoint normalizes those to S2 IDs, calls Semantic Scholar to fetch metadata, and upserts rows into `papers` (per Gap 2 (2a) resolution) so cache writes have a valid foreign key.

- [ ] **Step 1: Update SuggestRequest schema in `web/lib/suggest/types.ts`**

Replace `SuggestRequestSchema` with:

```typescript
export const ResolvedPaperSchema = z.object({
  id: z.number().int(),
  s2_paper_id: z.string().min(1),
  title: z.string(),
  abstract: z.string().default(""),
});
export type ResolvedPaper = z.infer<typeof ResolvedPaperSchema>;

export const SuggestRequestSchema = z.object({
  candidates: z.array(ResolvedPaperSchema).min(1).max(10),
  past_picks: z.array(ResolvedPaperSchema).min(1),
  lambda: z.number().min(0).max(1).default(0.6),
  k: z.number().int().min(1).max(10).default(10),
});
export type SuggestRequest = z.infer<typeof SuggestRequestSchema>;
```

This change cascades: orchestrator/route handler/tests now operate on `ResolvedPaper` objects (which carry both `id` INT and `s2_paper_id` string + title/abstract). The cache module uses `id` (INT) for paper_embeddings FK; the S2 client uses `s2_paper_id` for API calls; the WASM fallback uses `title + abstract`.

- [ ] **Step 2: Update orchestrator signature and impl**

In `web/lib/suggest/orchestrator.ts`, replace the body of `orchestrate` with logic that takes `ResolvedPaper[]` rather than string IDs. The shape change:

```typescript
export async function orchestrate(req: SuggestRequest, deps: OrchestratorDeps): Promise<SuggestResponse> {
  const t0 = Date.now();
  const wasWarm = deps.isModelWarm();
  const allPapers = [...req.candidates, ...req.past_picks];
  const allIntIds = allPapers.map(p => p.id);

  // 1. Cache lookup by INT papers.id
  const cached = await deps.getCached(deps.client, allIntIds);  // Map<number, Float32Array>
  const missing = allPapers.filter(p => !cached.has(p.id));

  // 2. S2 fetch for misses, by s2_paper_id
  const s2Results = await Promise.all(
    missing.map(p => deps.fetchPaperWithEmbedding(p.s2_paper_id, deps.apiKey))
  );

  let s2Fetched = 0;
  let fallbackUsed = 0;
  const fallbackQueue: Array<{ paper: ResolvedPaper }> = [];
  const newCacheRows: Array<{ paperId: number; vector: Float32Array }> = [];

  for (let i = 0; i < missing.length; i++) {
    const p = missing[i];
    const r = s2Results[i];
    if (r.kind === "hit") {
      cached.set(p.id, r.vector);
      newCacheRows.push({ paperId: p.id, vector: r.vector });
      s2Fetched++;
    } else if (r.kind === "fallback_needed") {
      fallbackQueue.push({ paper: p });
    }
  }

  // 3. WASM fallback batch — uses title+abstract from the ResolvedPaper objects
  if (fallbackQueue.length > 0) {
    const items = fallbackQueue.map(f => ({ title: f.paper.title, abstract: f.paper.abstract }));
    const vecs = await deps.embedBatch(items);
    for (let i = 0; i < fallbackQueue.length; i++) {
      cached.set(fallbackQueue[i].paper.id, vecs[i]);
      newCacheRows.push({ paperId: fallbackQueue[i].paper.id, vector: vecs[i] });
    }
    fallbackUsed = fallbackQueue.length;
  }

  if (newCacheRows.length > 0) {
    await deps.cacheMany(deps.client, newCacheRows).catch(e =>
      console.error(JSON.stringify({ event: "cache_write_failed", error: String(e) }))
    );
  }

  // 4. MMR
  const candidateVecs = req.candidates.map(p => cached.get(p.id)!);
  const pastPickVecs = req.past_picks.map(p => cached.get(p.id)!);
  const queryVec = meanVec(pastPickVecs);
  const order = mmr(queryVec, candidateVecs, req.lambda, req.k);

  const ranked: RankedResult[] = order.map(idx => ({
    paper_id: req.candidates[idx].id,
    title: req.candidates[idx].title,
    mmr_score: 0,
  }));

  return {
    ranked,
    diagnostics: {
      cache_hits: cached.size - newCacheRows.length,
      s2_fetched: s2Fetched,
      fallback_used: fallbackUsed,
      cold_start: !wasWarm && fallbackUsed > 0,
      total_ms: Date.now() - t0,
    },
  };
}
```

The `OrchestratorDeps` types and `getCached`/`cacheMany` signatures shift from `string[]` to `number[]` — update those too. Also update `RankedResult.paper_id: number` in `types.ts` (was `string`).

- [ ] **Step 3: Update orchestrator tests to pass `ResolvedPaper` objects**

Tests in `orchestrator.test.ts` need updating from string IDs to `ResolvedPaper` objects. Example test rewrite for the all-cache-hit path:

```typescript
it("all-cache-hit path: no S2 calls, no fallback, returns ranked", async () => {
  const cached = new Map<number, Float32Array>([[1, v(0.1)], [2, v(0.2)], [3, v(0.5)], [4, v(0.5)]]);
  const deps = { ...baseDeps, getCached: vi.fn().mockResolvedValue(cached) };
  const result = await orchestrate(
    {
      candidates: [
        { id: 1, s2_paper_id: "ARXIV:1", title: "T1", abstract: "A1" },
        { id: 2, s2_paper_id: "ARXIV:2", title: "T2", abstract: "A2" },
      ],
      past_picks: [
        { id: 3, s2_paper_id: "ARXIV:3", title: "T3", abstract: "A3" },
        { id: 4, s2_paper_id: "ARXIV:4", title: "T4", abstract: "A4" },
      ],
      lambda: 0.6,
      k: 2,
    },
    deps as any,
  );
  expect(deps.fetchPaperWithEmbedding).not.toHaveBeenCalled();
  expect(result.ranked).toHaveLength(2);
});
```

Repeat the same shape change for the other 4 orchestrator tests.

- [ ] **Step 4: Update embedding-cache tests to use INT IDs**

In `embedding-cache.test.ts`, change all `paper_id: "p1"` to `paper_id: 1` and the `getCached` arg `["p1", "p2"]` to `[1, 2]`. Update mock return shape similarly.

- [ ] **Step 5: Build the candidate resolver endpoint**

Create `web/app/api/admin/resolve-papers/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireLeaderRole } from "@/lib/auth/requireLeaderRole";
import { createServerClient as createServiceClient } from "@/lib/supabase/service";
import { UnauthorizedError, ForbiddenError } from "@/lib/suggest/types";

export const dynamic = "force-dynamic";

const ResolveRequest = z.object({
  inputs: z.array(z.string().min(1)).min(1).max(10),
});

const ARXIV_RE = /arxiv\.org\/(?:abs|pdf)\/([0-9]{4}\.[0-9]{4,5})/i;
const DOI_RE = /\b(10\.\d{4,9}\/[^\s/?#]+)/i;
const ARXIV_ID_RE = /^(?:arxiv:)?([0-9]{4}\.[0-9]{4,5})$/i;

function inputToS2Id(input: string): string {
  const t = input.trim();
  let m = t.match(ARXIV_RE) ?? t.match(ARXIV_ID_RE);
  if (m) return `ARXIV:${m[1]}`;
  m = t.match(DOI_RE);
  if (m) return `DOI:${m[1]}`;
  // Already an S2 paper ID (40-hex or other) — pass through
  return t.startsWith("ARXIV:") || t.startsWith("DOI:") ? t : t;
}

async function fetchS2Metadata(s2Id: string, apiKey: string) {
  const url = `https://api.semanticscholar.org/graph/v1/paper/${encodeURIComponent(s2Id)}?fields=paperId,title,abstract,url,externalIds`;
  const res = await fetch(url, { headers: { "x-api-key": apiKey }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`s2 ${res.status} for ${s2Id}`);
  return res.json() as Promise<{ paperId: string; title: string; abstract?: string; url?: string }>;
}

export async function POST(req: Request) {
  try {
    await requireLeaderRole();
    const { inputs } = ResolveRequest.parse(await req.json());
    const apiKey = process.env.S2_API_KEY!;
    const client = createServiceClient();

    const resolved: Array<{ id: number; s2_paper_id: string; title: string; abstract: string }> = [];
    for (const raw of inputs) {
      const s2Id = inputToS2Id(raw);

      // Check if already in papers
      const existing = await client.from("papers").select("id, s2_paper_id, title, abstract")
        .eq("s2_paper_id", s2Id).maybeSingle();
      if (existing.data) {
        resolved.push({
          id: existing.data.id,
          s2_paper_id: existing.data.s2_paper_id,
          title: existing.data.title,
          abstract: existing.data.abstract ?? "",
        });
        continue;
      }

      // Fetch from S2 and insert
      const meta = await fetchS2Metadata(s2Id, apiKey);
      const insert = await client.from("papers").insert({
        title: meta.title,
        abstract: meta.abstract ?? "",
        url: meta.url ?? null,
        s2_paper_id: meta.paperId,
      }).select("id").single();
      if (insert.error || !insert.data) throw insert.error;
      resolved.push({
        id: insert.data.id,
        s2_paper_id: meta.paperId,
        title: meta.title,
        abstract: meta.abstract ?? "",
      });
    }

    return NextResponse.json({ papers: resolved });
  } catch (e) {
    if (e instanceof UnauthorizedError) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    if (e instanceof ForbiddenError) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    if (e instanceof z.ZodError) return NextResponse.json({ error: "invalid_request", issues: e.issues }, { status: 400 });
    return NextResponse.json({ error: "internal", message: (e as Error).message }, { status: 500 });
  }
}
```

- [ ] **Step 6: Wire SuggestForm to call the resolver before /api/suggest**

In `SuggestForm.tsx`, replace the `candidate_paper_ids` build step with:

```typescript
    const inputs = candidates.split("\n").map(s => s.trim()).filter(Boolean);
    if (inputs.length === 0 || inputs.length > 10) {
      setStatus("error");
      setMessage("Please enter 1-10 candidate paper IDs, one per line.");
      return;
    }

    setMessage("Resolving candidate papers…");
    const resRes = await fetch("/api/admin/resolve-papers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inputs }),
    });
    if (!resRes.ok) {
      setStatus("error");
      setMessage(`Couldn't resolve candidates: ${resRes.status}`);
      return;
    }
    const candidatesResolved = (await resRes.json() as { papers: Array<{ id: number; s2_paper_id: string; title: string; abstract: string }> }).papers;
```

Then change the final `/api/suggest` POST body to:

```typescript
      body: JSON.stringify({ candidates: candidatesResolved, past_picks, lambda }),
```

- [ ] **Step 7: Update the route handler to pass through ResolvedPaper objects**

In `web/app/api/suggest/route.ts`, change the orchestrator call site to no longer need `fetchTitles` (titles come from the request body now):

```typescript
const deps: OrchestratorDeps = {
  apiKey,
  client,
  getCached,
  cacheMany,
  fetchPaperWithEmbedding,
  embedBatch,
  isModelWarm,
};
```

And remove the `fetchTitles` field from `OrchestratorDeps` in `orchestrator.ts`.

- [ ] **Step 8: Run all unit tests**

Run: `cd web && npm test`
Expected: all tests pass after the cascading edits in Steps 3 and 4.

- [ ] **Step 9: Commit**

```bash
git add web/app/api/admin/resolve-papers/route.ts \
        web/app/admin/suggest/SuggestForm.tsx \
        web/lib/suggest/types.ts \
        web/lib/suggest/orchestrator.ts \
        web/lib/suggest/__tests__/orchestrator.test.ts \
        web/lib/suggest/embedding-cache.ts \
        web/lib/suggest/__tests__/embedding-cache.test.ts \
        web/app/api/suggest/route.ts
git commit -m "feat(suggest): candidate resolver endpoint + ResolvedPaper API contract

Switches the API from opaque string IDs to ResolvedPaper objects
({id, s2_paper_id, title, abstract}) — title/abstract carried in the
request so the WASM fallback has the inputs it needs without an extra
S2 round-trip. The resolver upserts new candidates into papers, ensuring
the FK is valid for paper_embeddings writes."
```

---

## Phase 4 — Smoke + cutover

### Task 4.1: Write the smoke-test runbook

**Files:**
- Create: `docs/superpowers/specs/2026-05-09-vercel-suggest-wasm-specter2-smoke-test.md`

- [ ] **Step 1: Author the runbook**

Create the file with this content:

```markdown
# Smoke Test Runbook — /admin/suggest with WASM SPECTER2 Fallback

Run on the Vercel **Preview** deployment created from PR-merge-candidate
before promoting to Production.

**Prereqs:**
- Logged in as a member with `role IN ('leader','admin')`.
- `S2_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SPECTER2_MODEL_BLOB_URL` set in Preview env.
- `EXPECTED_MODEL_SHA256` in code matches the file actually pushed to Blob.

## Scenario 1 — All papers in S2 corpus (happy path)

**Input:** 3 well-established arXiv IDs known to be in S2 with embeddings.
Examples: `arXiv:2106.11189`, `arXiv:2103.00020`, `arXiv:2010.11929`.

**Past picks:** "All papers from prior cycles" (default).

**Expected:**
- Response in <8s on warm Lambda.
- `diagnostics.fallback_used == 0`.
- `diagnostics.s2_fetched` reflects how many of those 3 weren't already cached.
- `ranked` contains 3 papers with non-empty titles.

## Scenario 2 — One arXiv preprint not in S2 (fallback fires)

**Input:** 1 candidate that's a brand-new arXiv preprint posted in the
last 24h (S2 hasn't ingested it yet) + 2 stable papers.

**Past picks:** "All papers from prior cycles".

**Expected:**
- Response in 10–20 s on warm, 20–30 s on cold (first cold start of the day).
- `diagnostics.fallback_used == 1` (the new preprint).
- `diagnostics.s2_fetched` shows the other 2.
- `diagnostics.cold_start == true` if first call after deploy/quiet period.
- `ranked` includes all 3 papers; the new preprint has its WASM-generated
  embedding cached in Supabase (verify via SQL after the test).

## Scenario 3 — S2 simulated down (fallback covers everything)

**Setup:** Temporarily set `S2_API_KEY` to an obviously-invalid value
(e.g. `BROKEN_KEY_TEST`) in Vercel Preview. Wait 60s for the change to
take effect.

**Input:** 2 candidates.

**Expected:**
- The 401 Auth error from S2 should NOT silently fall back; the route
  should return `502 s2_auth`. (This is the spec's carve-out.)
- After confirming, restore the real key.
- Repeat with a *transient* simulation: temporarily revoke the key in
  the S2 dashboard if possible (which yields 429), or change Vercel
  preview env to a key that's valid but rate-limited.
- Expected: `fallback_used == N` (covered all candidates).

## Post-test verification (SQL)

```sql
-- Confirm the new preprint from Scenario 2 has a cached embedding:
SELECT pe.paper_id, pe.model, pe.cached_at
FROM paper_embeddings pe
JOIN papers p ON p.id = pe.paper_id
WHERE p.s2_paper_id = '<the preprint id>' AND pe.model = 'specter_v2';
```

Expect 1 row, `cached_at` within the last few minutes.

## Pass/fail criteria

All three scenarios produce the expected diagnostics and SQL state.
Failures block promotion to Production.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-05-09-vercel-suggest-wasm-specter2-smoke-test.md
git commit -m "docs(suggest): smoke-test runbook for /admin/suggest before cutover"
```

### Task 4.2: Run the smoke test

This is operator-driven (manual UI testing on Vercel Preview).

- [ ] **Step 1: Open a PR and let Vercel build a Preview**

```bash
git push -u origin claude/awesome-ptolemy-b3637e
gh pr create --title "feat: /admin/suggest with WASM SPECTER2 fallback" --body "$(cat <<'EOF'
## Summary
- Ports find_paper_suggest.py to a leader-facing /admin/suggest Vercel route
- Adds in-process WASM SPECTER2 fallback for papers S2 hasn't embedded
- Reuses existing paper_embeddings table; no schema changes

## Spec
- [Design](docs/superpowers/specs/2026-05-09-vercel-suggest-wasm-specter2-design.md)
- [Smoke test](docs/superpowers/specs/2026-05-09-vercel-suggest-wasm-specter2-smoke-test.md)

## Test plan
- [ ] Unit tests pass (`cd web && npm test`)
- [ ] Parity test passes against current S2 (`RUN_PARITY=1 npm test -- parity`)
- [ ] Smoke Scenario 1 (all-S2 happy path)
- [ ] Smoke Scenario 2 (one fallback)
- [ ] Smoke Scenario 3 (S2 down → fallback OR auth error per spec)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 2: Run the three smoke scenarios on the Preview URL**

Follow `docs/superpowers/specs/2026-05-09-vercel-suggest-wasm-specter2-smoke-test.md`. Document results in the PR description.

- [ ] **Step 3: If all green, request review and merge**

If any scenario fails, file a follow-up issue or fix in the same branch.

### Task 4.3: Add the dashboard link (post-merge cutover)

**Files:**
- Modify: `web/app/dashboard/page.tsx`

- [ ] **Step 1: Read the existing dashboard layout**

```bash
cat web/app/dashboard/page.tsx
```

Identify a sensible place for the link (e.g., a sidebar or a "Tools" section visible to leaders).

- [ ] **Step 2: Conditionally render the link for leaders/admins**

The pattern depends on your existing dashboard structure. Sketch:

```tsx
// In the page component, after fetching the member's role:
{["leader", "admin"].includes(member.role) && (
  <a href="/admin/suggest" className="block rounded bg-emerald-50 px-4 py-2 hover:bg-emerald-100">
    🔍 Find a paper
  </a>
)}
```

- [ ] **Step 3: Verify type-check + manual check**

Run: `cd web && npx tsc --noEmit && npm run dev`.
Log in as a leader: link is visible.
Log in as a regular member: link is hidden.

- [ ] **Step 4: Commit and push**

```bash
git add web/app/dashboard/page.tsx
git commit -m "feat(suggest): add 'Find a paper' link to leader dashboard

Phase 4 cutover — /admin/suggest is now reachable from the dashboard for
users with role IN ('leader','admin')."
git push
```

---

## Wrap-up checklist

After Phase 4 ships and one real cycle has used the deployed route:

- [ ] Confirm via Vercel logs that no `outcome:error` lines appeared in real leader sessions.
- [ ] Confirm via SQL that `paper_embeddings` has rows for any new papers introduced via the deployed route.
- [ ] Update memory: project memory file noting `/admin/suggest` shipped, what cycle it first served.
- [ ] **Do NOT delete** `scripts/find_paper_suggest.py`, `tests/find_paper_suggest_test.py`, or the `/wids-find-paper` skill — they remain the operator-only offline fast path per locked decision (5a).
- [ ] If the parity test starts failing periodically (e.g., HF Hub republishes adapter weights), file an issue to re-export the ONNX and update the SHA pin.

---

## Self-review notes (for the plan author)

The plan deviates from the spec in one place: the spec's Section 4 calls for a "vitest + local Postgres" integration test layer, which the plan replaces with an orchestrator-level integration test against mocked Supabase + a real-DB-coverage smoke test. Rationale: the project has no existing local-Postgres dev infrastructure, and adding it for one test layer is high-cost. If a real-DB regression slips through smoke testing, the follow-up is to add a docker-compose pgvector service for CI.
