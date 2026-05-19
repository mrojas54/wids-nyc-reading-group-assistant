---
schedule: weekly
description: Soft-prune the papers-pdfs Storage bucket when it exceeds 500 MB (oldest-first)
---

# scheduled_tasks/prune-paper-pdfs

Weekly, on Sunday at 02:00 UTC. Reads the `papers-pdfs` Supabase Storage
bucket, sums object sizes, and — if the total exceeds 500 MB — deletes
oldest-by-`created_at` PDFs until the total drops below 450 MB.

This is the enforcement arm of the §11 Q1 "keep indefinitely, soft-prune
at 500 MB" policy from
[`docs/superpowers/specs/2026-05-17-paper-pal-edge-functions.md`](../docs/superpowers/specs/2026-05-17-paper-pal-edge-functions.md).

## Safety: dry-run default

This task ships with `PAPER_PAL_PRUNE_DRY_RUN=true` so the first runs
log what they WOULD delete without touching the bucket. After the
operator confirms one clean dry run, flip the env var to `false` (PR2's
deploy step does this).

## Step 1 — Enumerate every PDF (flat list with full paths)

Bucket paths are `<paper_id>/<uuid>.pdf` (spec §8), so `list("")` only
returns top-level folder entries. We do a two-level walk and accumulate
a flat `allFiles` list with full paths + sizes, then sort by `created_at`
so the oldest comes first:

```js
const bucket = "papers-pdfs";
const { data: folders, error } = await sbSvc.storage.from(bucket).list("", {
  limit: 10000,
  sortBy: { column: "name", order: "asc" },
});
if (error) throw new Error(`storage list failed: ${error.message}`);

const allFiles = [];
for (const folder of folders ?? []) {
  // Real files have an id; folder placeholders have id === null. Skip
  // any stray top-level files (none expected, but harmless).
  if (folder.id !== null) continue;
  const { data: inner, error: innerErr } = await sbSvc.storage
    .from(bucket)
    .list(folder.name, {
      limit: 1000,
      sortBy: { column: "created_at", order: "asc" },
    });
  if (innerErr) throw new Error(`list ${folder.name} failed: ${innerErr.message}`);
  for (const file of inner ?? []) {
    allFiles.push({
      path: `${folder.name}/${file.name}`,
      size: file.metadata?.size ?? 0,
      created_at: file.created_at,
    });
  }
}
allFiles.sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""));

const totalBytes = allFiles.reduce((sum, f) => sum + f.size, 0);
const THRESHOLD_BYTES = 500 * 1024 * 1024;  // 500 MB
const FLOOR_BYTES     = 450 * 1024 * 1024;  // delete down to here
```

If `totalBytes < THRESHOLD_BYTES`, log a `noop` row and exit (see Step 4).

## Step 2 — Pick deletion candidates

Walk `allFiles` from oldest forward, accumulating until projected
remaining-after-delete drops below `FLOOR_BYTES`:

```js
const candidates = [];
let remaining = totalBytes;
for (const f of allFiles) {
  if (remaining <= FLOOR_BYTES) break;
  candidates.push(f);
  remaining -= f.size;
}
```

## Step 3 — Delete (or log in dry-run)

```js
const dryRun = (Deno.env.get("PAPER_PAL_PRUNE_DRY_RUN") ?? "true") === "true";
const paths = candidates.map((c) => c.path);

if (dryRun) {
  console.log(`[dry-run] would delete ${paths.length} files:`, paths);
} else if (paths.length > 0) {
  const { error: delErr } = await sbSvc.storage.from(bucket).remove(paths);
  if (delErr) throw new Error(`delete failed: ${delErr.message}`);
}
```

## Step 4 — Log to command_log

```sql
INSERT INTO command_log (source, name, status, summary)
VALUES (
  'scheduled_task',
  'wids-prune-paper-pdfs',
  'success',
  format(
    '%s mode: %s candidates (%s MB) of %s MB total',
    CASE WHEN <dry_run> THEN 'dry-run' ELSE 'live' END,
    <candidate_count>,
    <freed_mb>,
    <total_mb>
  )
);
```

The `<dry_run>` token is the same boolean read from
`PAPER_PAL_PRUNE_DRY_RUN`. The summary is sortable on `_count_` so the
operator can spot a sudden spike in deletions.

## Idempotency

This task is safe to re-run: a subsequent invocation re-lists the bucket
and re-evaluates the threshold. There's no per-meeting key to dedupe
against because the bucket-level state IS the only state.

## Operational notes

- The 500 MB threshold + Supabase 1 GB free-tier cap leaves a 500 MB
  buffer for non-PDF storage. Re-tune if other buckets grow.
- If the dry-run logs ever show a candidate set larger than ~30 files,
  investigate — that's >5× a normal year's worth of papers and likely
  indicates a misconfigured upload (e.g., duplicates from a retry loop).
- Deletion is permanent — Supabase Storage does not version objects.
  The 6-month-buffer rationale in spec §11 Q1 assumes we can re-download
  arXiv preprints; if a future paper source loses that property, revisit.
