# SPECTER2 ONNX export & deploy runbook

**Date executed:** 2026-05-10
**Deploy commit:** 54ab62f5
**Operator:** Michelle

Use this runbook whenever `specter2_int8.onnx` needs to be re-exported and
pushed to Vercel Blob (e.g. after a new proximity-adapter release, a
quantization-mode change, or a parity regression).

---

## Prerequisites

- `gh` CLI authenticated and repo cloned
- `vercel` CLI linked to the project (`vercel link`)
- 1Password CLI (`op`) with the **VERCEL_BLOB** env-var group configured
  (Warp Drive → env vars → VERCEL_BLOB, or `op item get "Vercel Blob"`)
- `sha256sum` available (macOS: install via `brew install coreutils`)

---

## 1. Trigger the export workflow

```bash
gh workflow run export-specter2.yml --ref main
```

The workflow runs on `ubuntu-latest`, downloads the model from HuggingFace,
exports to ONNX, INT8-quantizes via `onnxruntime`, and uploads the result as
the `specter2-onnx` artifact (retained 7 days).

Monitor until completion:

```bash
gh run watch
```

A passing run prints the SHA-256 in the GitHub Actions step summary and
uploads `specter2_int8.onnx` as an artifact.

## 2. Download the artifact

```bash
gh run download <RUN_ID> --name specter2-onnx
# produces ./specter2_int8.onnx in the current directory
```

## 3. Verify the SHA-256 locally

```bash
sha256sum specter2_int8.onnx
```

Cross-check against the value printed in the workflow's "Compute SHA-256"
step summary on GitHub.

## 4. Upload to Vercel Blob

```bash
op run --env-file <(echo 'BLOB_READ_WRITE_TOKEN=op://Personal/<ITEM_UUID>/credential') -- \
  vercel blob put specter2_int8.onnx \
    --pathname specter2/specter2_int8.onnx \
    --access private \
    --allow-overwrite \
    --cwd /path/to/wids-nyc-reading-group-assistant
```

Replace `<ITEM_UUID>` with the 1Password item UUID for **Vercel Blob**
(currently `4vsjnrbjyhlqju5mbtw2kcf3ba`).

The `--allow-overwrite` flag is required on updates; omit it for the first
upload.

## 5. Update the SHA pin in source

Edit `web/lib/suggest/specter2-wasm.ts` and replace `EXPECTED_MODEL_SHA256`
with the new hash:

```ts
const EXPECTED_MODEL_SHA256 = "<new-sha256-here>";
```

## 6. Open a PR

```bash
git checkout -b fix/specter2-sha256-update
git add web/lib/suggest/specter2-wasm.ts
git commit -m "fix(suggest): update SPECTER2 model SHA-256 for re-exported ONNX

New SHA-256: <hash>

Co-Authored-By: Oz <oz-agent@warp.dev>"
git push -u origin fix/specter2-sha256-update
gh pr create --base main
```

Wait for Vercel preview build to pass before merging.

## 7. Merge and verify production

```bash
gh pr merge <PR_NUMBER> --merge --delete-branch
git checkout main && git pull
```

Confirm production deployment:

```bash
# Should return HTTP 200
curl -sI https://wids-nyc-reading-group-assistant.vercel.app | grep "^HTTP"

# Should return {"error":"unauthorized"} — not a 500
curl -s -X POST https://wids-nyc-reading-group-assistant.vercel.app/api/suggest \
  -H "Content-Type: application/json" \
  -d '{"query":"test"}' | jq .error
```

---

## Troubleshooting

**`ModuleNotFoundError: No module named 'onnxscript'`**
The workflow `uv run` block is missing `--with onnxscript`. Add it alongside
the other `--with` flags in `.github/workflows/export-specter2.yml`.
Fixed in PR #25 (2026-05-10).

**`vercel blob put` — "No Vercel Blob token found"**
`BLOB_READ_WRITE_TOKEN` is a `sensitive` env var scoped to
Production/Preview only; it cannot be pulled to local dev via `vercel env pull`.
Use `op run` with the 1Password reference as shown in step 4.

**`vercel blob put` — "blob already exists"**
Pass `--allow-overwrite` to replace the existing file.

**TypeScript build error: `MapIterator` spread**
Use `Array.from(map.entries())` instead of `[...map.entries()]` when the
`tsconfig.json` target is below ES2015. Fixed in PR #26 (2026-05-10).

---

## Artifact record

| Date       | SHA-256                                                          | Commit   | PRs       |
|------------|------------------------------------------------------------------|----------|-----------|
| 2026-05-10 | `1db3c70bc2f4d5debfc256059d1e73261567411410f1930515d70e43283e8f6b` | 54ab62f5 | #25, #26  |
