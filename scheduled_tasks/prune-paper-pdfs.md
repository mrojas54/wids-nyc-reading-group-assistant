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

## Step 1 — Check threshold

```js
const bucket = "papers-pdfs";
const { data: objects, error } = await sbSvc.storage.from(bucket).list("", {
  limit: 10000,
  sortBy: { column: "created_at", order: "asc" },
});
if (error) throw new Error(`storage list failed: ${error.message}`);

const totalBytes = (objects ?? []).reduce(
  (sum, o) => sum + (o.metadata?.size ?? 0),
  0,
);
const THRESHOLD_BYTES = 500 * 1024 * 1024;  // 500 MB
const FLOOR_BYTES = 450 * 1024 * 1024;       // delete down to here
```

If `totalBytes < THRESHOLD_BYTES`, log a `noop` row and exit (see Step 4).

## Step 2 — Pick deletion candidates

Walk `objects` from oldest forward, accumulating until the projected
remaining-after-delete drops below `FLOOR_BYTES`:

```js
const candidates = [];
let remaining = totalBytes;
for (const o of objects) {
  if (remaining <= FLOOR_BYTES) break;
  candidates.push(o);
  remaining -= o.metadata?.size ?? 0;
}
```

Recursive directory listing: if the bucket uses `<paper_id>/<uuid>.pdf`
paths (it does — see spec §8), `list("")` only returns top-level folder
entries. List each folder explicitly to enumerate PDFs:

```js
const allFiles = [];
for (const folder of objects) {
  if (!folder.id) {  // null id means it's a folder placeholder
    const { data: inner } = await sbSvc.storage.from(bucket).list(folder.name, {
      limit: 1000,
      sortBy: { column: "created_at", order: "asc" },
    });
    for (const file of inner ?? []) {
      allFiles.push({ path: `${folder.name}/${file.name}`, ...file });
    }
  }
}
// Sort the flat list by created_at, then apply Step 2 logic.
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
