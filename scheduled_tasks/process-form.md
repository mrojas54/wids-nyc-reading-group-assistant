---
schedule: daily
description: Ingest Google Form CSV responses from Drive into availability/volunteers/paper_suggestions
---

# scheduled_tasks/process-form

Runs daily. For every meeting in `status='prep'` with a `form_url`, looks for a response CSV in Drive and processes new rows.

## Step 1 — Find prep meetings with forms

```sql
SELECT m.id, m.type, m.form_url, m.planned_by_admin_id, m.drive_folder_url,
       (SELECT id FROM meetings rg WHERE rg.planned_by_admin_id = m.id LIMIT 1) AS paired_rg_id
FROM meetings m
WHERE m.status='prep' AND m.form_url IS NOT NULL;
```

For each row, follow steps 2–6.

## Step 2 — Locate the CSV in Drive

Convention: operator exports the Form's responses (Form → Responses → ⋮ → Download responses CSV) and uploads to:
- For admin meetings: `<drive_root>/cycles/<cycle_label>/admin-form-responses.csv`
- For reading_group meetings: `<drive_root>/cycles/<cycle_label>/rg-form-responses.csv`

`cycle_label` = `YYYY-MM-meeting`, derived from the reading_group's planned month. Admin meetings live under their *paired* reading_group's cycle subfolder.

If the cycle subfolder doesn't exist (typically because `/wids-find-paper pick` hasn't run yet for the reading_group), skip — the operator can't have uploaded the CSV.

If the CSV file doesn't exist, log `no_action` for this meeting and move on.

## Step 3 — Compute new-rows watermark

```sql
SELECT MAX(ran_at) AS last_run
FROM command_log
WHERE source='scheduled_task' AND name='process-form'
  AND status='success' AND summary LIKE '%meeting=<id>%';
```

Read the CSV's `Timestamp` column (Google Forms includes one). Process only rows newer than `last_run` (all rows if `last_run` is NULL).

## Step 4 — Determine target tables

Based on `m.type`:

- **`admin`:** populates 4 streams of data
  - Admin availability → `availability(meeting_id=<admin_id>, ...)` (Form Q3)
  - Reading_group far-availability → `availability(meeting_id=<paired_rg_id>, ...)` (Form Q4)
  - Volunteers → `volunteers(meeting_id=<paired_rg_id>, ...)` (Form Q5)
  - Paper suggestions → `paper_suggestions(meeting_id=<paired_rg_id>, source='member', suggested_by=<member_id>, ...)` (Form Q6)
- **`reading_group`:** populates 1 stream
  - Availability → `availability(meeting_id=<rg_id>, ...)` (Form Q3)
  - Venue suggestions are not stored in V1; included in summary text only.

## Step 5 — UPSERT each row's data

For each new row:

1. Look up member by email:
   ```sql
   SELECT id FROM members WHERE LOWER(email) = LOWER('<email>');
   ```
   If no match, log warning, skip row.

2. Parse multi-select date-time fields (e.g. `Tue 2026-05-12 7:00 PM ET`); convert to TIMESTAMPTZ, range_end = start + 90 minutes.

3. UPSERT availability (delete-and-reinsert per (meeting_id, member_id) since no UNIQUE constraint):
   ```sql
   DELETE FROM availability WHERE meeting_id = <m_id> AND member_id = <member_id>;
   INSERT INTO availability (meeting_id, member_id, range_start, range_end)
   VALUES (<m_id>, <member_id>, <start>, <end>), ...;
   ```

4. UPSERT volunteers (admin form only):
   ```sql
   INSERT INTO volunteers (meeting_id, member_id)
   VALUES (<paired_rg_id>, <member_id>)
   ON CONFLICT (meeting_id, member_id) DO NOTHING;
   ```

5. UPSERT paper suggestion (admin form only):
   ```sql
   -- Find or create paper by URL
   SELECT id FROM papers WHERE url = '<url>';
   -- If no row: INSERT INTO papers RETURNING id

   INSERT INTO paper_suggestions (meeting_id, paper_id, suggested_by, source, notes)
   VALUES (<paired_rg_id>, <paper_id>, <member_id>, 'member', NULL)
   ON CONFLICT (meeting_id, paper_id) DO NOTHING;
   ```

## Step 6 — Per-meeting log entry

```sql
INSERT INTO command_log (source, name, status, summary)
VALUES ('scheduled_task', 'process-form', 'success',
        'meeting=<id> type=<type> processed=<N> new rows; avail=<K> volunteers=<V> suggestions=<P> skipped=<S>');
```

If no new rows: log `no_action` instead, with `summary='meeting=<id> no new rows since <last_run>'`.

## Failure handling

- CSV malformed → process valid rows, skip bad ones; per-row warnings inside `summary`.
- Drive MCP unavailable → log failure for that meeting with the error; next run retries.
- DB UPSERT error → log failure for that meeting; other meetings continue.
- Member email not in `members` → skip row, increment `skipped` count.

## Operator's role

Periodically (every few days while a form is active) export the Form's responses CSV and upload to the right Drive path. Overwriting is fine. The scheduled task picks up new rows on its next daily run.

V2 enhancement: integrate Google Forms API directly to eliminate the manual export.
