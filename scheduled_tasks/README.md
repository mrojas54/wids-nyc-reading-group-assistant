# Scheduled tasks

Each `.md` file in this directory is a standalone task prompt. Its frontmatter
declares whether it is `daily`, `weekly`, `manual`, or `deprecated`. Recurring
tasks are independent — failures of one don't block others.

## Registration

For each `daily` or `weekly` file:

1. Open the scheduled-tasks MCP UI (or use its `create_scheduled_task` tool).
2. Create a task with:
   - **Name:** the filename without `.md` (e.g. `cycle-keep-alive`)
   - **Schedule:** match the file's frontmatter; use a calm API window for daily
     tasks (for example, 09:00 ET)
   - **Prompt:** the contents of the .md file
   - **Environment:**
     - `SUPABASE_URL`
     - `SUPABASE_SERVICE_ROLE_KEY`
     - Gmail and Calendar MCPs configured at runtime level
3. Test by running once manually; verify a row appears in `command_log`.

For `prune-paper-pdfs`, also set `PAPER_PAL_PRUNE_DRY_RUN=true` for the
first scheduled runs. Flip it only after a clean dry-run, as described in
[`prune-paper-pdfs.md`](prune-paper-pdfs.md).

Do not put `new-paper-announcement` on a recurring schedule. Run it manually
after the new cycle's paper and leader are locked. It also needs
`SUPABASE_DB_URL` in addition to the Supabase and Gmail integrations, creates
Gmail drafts rather than sending, and uses a per-paper idempotency key. Follow
[`new-paper-announcement.md`](new-paper-announcement.md) for the complete
operator workflow.

## Order of registration

Doesn't matter — they're independent. But a sensible order is:

1. `meeting-auto-advance` (cheapest; verify infra)
2. `calendar-rsvp-sync`
3. `pre-meeting-reminder`
4. `cycle-keep-alive`
5. `availability-chase`
6. `post-meeting-thanks`
7. `prune-paper-pdfs` (weekly Sunday 02:00 UTC; starts dry-run)

Do **not** register `leader-nudge`. It is deprecated and superseded by the
Paper Pal companion flow; leaving it unregistered matches the root
[README](../README.md#5-scheduled-tasks-mcp).

## Observability

Every task writes to `command_log`. Daily check:

```sql
SELECT ran_at, name, status, summary, error
FROM command_log
WHERE source='scheduled_task' AND ran_at > now() - interval '2 days'
ORDER BY ran_at DESC;
```
