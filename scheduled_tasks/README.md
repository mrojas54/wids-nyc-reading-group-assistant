# Scheduled tasks

Each non-deprecated `.md` file in this directory is a standalone prompt to register with the scheduled-tasks MCP. Most run daily; `prune-paper-pdfs` runs weekly. They are independent — failures of one don't block others.

## Registration

For each file:

1. Open the scheduled-tasks MCP UI (or use its `create_scheduled_task` tool).
2. Create a task with:
   - **Name:** the filename without `.md` (e.g. `cycle-keep-alive`)
   - **Schedule:** daily at a time when API rate limits are calm (e.g., 09:00 ET)
   - **Prompt:** the contents of the .md file
   - **Environment:**
     - `SUPABASE_URL`
     - `SUPABASE_SERVICE_ROLE_KEY`
     - Gmail and Calendar MCPs configured at runtime level
3. Test by running once manually; verify a row appears in `command_log`.

For `prune-paper-pdfs`, also set `PAPER_PAL_PRUNE_DRY_RUN=true` for the
first scheduled runs. Flip it only after a clean dry-run, as described in
[`prune-paper-pdfs.md`](prune-paper-pdfs.md).

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
