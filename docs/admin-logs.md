# /admin/logs - operator event log

Operator-facing triage page for answering "what broke?" from the
`command_log` audit table.

This guide is written for:

- **Operators** checking the health of server actions, scheduled tasks, and
  slash commands -> start at "Using it as an operator."
- **Maintainers** adding new log writers -> "Writing useful log rows."
- **Future developers** changing the page or schema -> "Behind the scenes."

---

## TL;DR

`/admin/logs` is a read-only dashboard over `command_log`:

1. The page requires a signed-in `operator`, `leader`, or `admin` member.
2. It reads `command_log` with the Supabase service-role client because the
   table is RLS-locked with no browser policies.
3. It shows the newest 50 events, then keyset-paginates older rows with
   "Load more."
4. It derives severity from `status`: `failure` -> error,
   `no_action` -> warn, and `success` -> info.
5. Enriched fields from migration `020_command_log_enrichment.sql`
   (`actor`, `duration_ms`, `metadata`, `idempotency_key`) appear in the
   table or expandable JSON context when present.

Use it before direct SQL when debugging portal actions or scheduled jobs.

---

## Using it as an operator

### Access

Open `/admin/logs` on the member portal.

The route uses the same leader-role gate as `/admin/suggest`:

| Caller | Result |
|---|---|
| Not signed in | Middleware redirects protected `/admin/*` requests to `/`; if the server gate is reached without a user, it redirects to `/auth`. |
| Signed-in member without `operator`, `leader`, or `admin` role | Redirects to `/dashboard`. |
| `operator`, `leader`, or `admin` | Can view the log page. |

The page is not a write surface. Copying an event copies JSON to your
clipboard only.

### What to look at first

The sticky status header summarizes the last 24 hours:

| Header state | Meaning |
|---|---|
| All clear | No `failure` or `no_action` rows in the last 24 hours. |
| Last error | One `failure` row in the last 24 hours. |
| N errors | Multiple `failure` rows in the last 24 hours. |
| No errors, N warnings | No failures, but at least one `no_action` row. |
| Couldn't load status | The service-role query failed. Retry, then check env vars/logs. |

Clicking the header applies the relevant filter so you land on the affected
rows.

### Filters and shortcuts

The page filters client-side over rows already loaded in the browser:

- **Source:** `server_action`, `scheduled_task`, `slash_command`, or
  `edge_function`.
- **Severity:** derived from `status`, not stored in the database.
- **Range:** last 24 hours, 7 days, or 30 days.
- **Search:** matches event name, actor, summary, source, and error text.
- **Sort:** `Slowest first` appears only when Source is `edge_function`;
  it sorts by `duration_ms`.

Shortcut chips apply common filters:

| Shortcut | Filter it applies |
|---|---|
| What broke today | `source=server_action`, `severity=error`, last 24h. |
| Slowest LLM calls | `source=edge_function`, last 7d, sorted by duration. |
| Recent 404s | `name=page_404`, last 24h. |

If a filter looks incomplete, click **Load more** to fetch older rows, then
filter again. The server action loads rows older than the current cursor and
re-checks the role gate on every call.

### Reading an event

Each event row shows:

| Column | Source |
|---|---|
| Time | `command_log.ran_at`, rendered as relative time with NY timestamp in the tooltip. |
| Source | `command_log.source`. |
| Name | `command_log.name`. |
| Status | `command_log.status`. |
| Severity | Derived in `web/lib/logs.ts`. |
| Who | `command_log.actor`, or `-` when null. |
| Summary | `command_log.summary`, or blank when null. |

Expand a row to see:

- `context`: `{ source, name, status, ranAt }` plus `idempotencyKey`,
  `durationMs`, and non-empty `metadata` when the row has them.
- `error`: the stored error text, or `null - no error attached`.
- **Copy as JSON:** a compact payload to paste into issues or debugging notes.

---

## Writing useful log rows

### Server actions

Use `logServerAction` from `web/lib/log.ts`. The first four arguments are the
stable core fields; the fifth optional argument writes migration-020
enrichment columns only when supplied.

```ts
await logServerAction(
  "setRsvp",
  "success",
  "meeting=7 member=3 attending=true",
  undefined,
  {
    actor: "alice@example.com",
    durationMs: 42,
    idempotencyKey: "setRsvp:meeting=7:member=3",
    metadata: { meetingId: 7, memberId: 3, attending: true },
  },
);
```

Use these conventions:

- `name`: stable machine-readable event name (`submitAvailability`,
  `requestMagicLink`, `page_404`). Avoid embedding ids in the name; put ids in
  `summary`, `metadata`, or `idempotencyKey`.
- `summary`: one-line human summary that is safe to show to an operator.
- `error`: exception message or stack when the action failed.
- `actor`: member email, operator email, or cron/task id when known.
- `durationMs`: measured wall-clock time for slow or provider-backed work.
- `metadata`: structured context (`meetingId`, `paperId`, recipient counts,
  provider names). Do not put secrets here.
- `idempotencyKey`: stable key only when duplicate writes should be prevented.

### Slash commands and scripts

Python code can write enrichment columns through
`scripts/zotero_push.py::record_failure`, which appends only the optional
columns that are passed. The base failure row remains:

```sql
INSERT INTO command_log (source, name, status, error)
VALUES ('slash_command', <name>, 'failure', <error>);
```

Scheduled task prompts that need at-most-once behavior should prefer
`command_log.idempotency_key` over matching text in `summary`. The unique
partial index makes the second keyed insert fail with Postgres error `23505`;
the caller should treat that duplicate-key failure as a no-op when the work is
already represented by the first row.

### Constraints

- `command_log.source` is constrained to `server_action`, `scheduled_task`, and
  `slash_command` in the database. The UI also has an `edge_function` filter
  vocabulary for design parity and future rows, but no current migration adds
  that value to the database check constraint.
- `command_log.status` must be `success`, `failure`, or `no_action`.
- `command_log.metadata` defaults to `{}` and is omitted from the expanded
  context when empty.
- `idempotency_key` is nullable. Many nulls are allowed; only non-null keys are
  unique.
- The log table is service-role-only by design. Do not add broad RLS read
  policies just to power UI features.

---

## Behind the scenes

### Data flow

```
/admin/logs request
    |
    | requireLeaderRole()
    v
Server Component: web/app/admin/logs/page.tsx
    |
    | createSupabaseServiceClient()
    v
web/lib/logs.ts:listCommandLog()
    |
    | SELECT id, ran_at, source, name, status, summary, error,
    |        duration_ms, actor, metadata, idempotency_key
    | FROM command_log
    | ORDER BY ran_at DESC
    | LIMIT 50
    v
mapCommandLogRow() -> LogEvent view model
    |
    v
Client page filters, expands, copies JSON, and loads more rows
```

Pagination is keyset-based on `ran_at`: `loadMoreCommandLog(cursorIso)` fetches
rows with `ran_at < cursorIso`, newest first. The page deduplicates loaded rows
by id before appending them.

### Why service role is required

Migration `003_rls_policies.sql` enables RLS on `command_log` and intentionally
does not add a table policy. That keeps audit details out of browser sessions.
The `/admin/logs` server component and "Load more" server action both re-check
`requireLeaderRole()` before reading with the service-role client.

### Tests

Focused tests live in:

- `web/lib/__tests__/logs.test.ts` - severity mapping, relative time,
  enrichment mapping, header summaries, filters, and presets.
- `web/lib/__tests__/log.test.ts` - `logServerAction` core fields and optional
  enrichment writes.

Run them with:

```sh
cd web
npm test -- lib/__tests__/logs.test.ts lib/__tests__/log.test.ts
```

---

## Troubleshooting

| Symptom | Check |
|---|---|
| `/admin/logs` redirects to `/auth` | The Supabase session is missing or expired. Sign in again. |
| `/admin/logs` redirects to `/dashboard` | The roster row does not have `role` set to `operator`, `leader`, or `admin`. |
| Header says "Couldn't load status" | Confirm `SUPABASE_SERVICE_ROLE_KEY` is present in the Vercel `web` project and the migration has been applied. |
| Rows are missing enrichment fields | Older rows and writers that do not pass the optional fifth argument keep those columns null/defaulted. |
| "Slowest LLM calls" is empty | No current database row can use `source='edge_function'`; the filter is present for the UI vocabulary and future rows. |
| Duplicate scheduled task row fails with `23505` | A non-null `idempotency_key` already exists. Treat it as an already-logged no-op if the key represents the same intended work. |

## Where things live

```
docs/admin-logs.md                         <- this guide
migrations/020_command_log_enrichment.sql  <- actor/duration/metadata/idempotency schema
web/app/admin/logs/                        <- route, table, filters, status header
web/lib/log.ts                             <- server-action writer helper
web/lib/logs.ts                            <- read/query/view-model layer
web/lib/__tests__/log.test.ts              <- writer helper tests
web/lib/__tests__/logs.test.ts             <- view-model/filter tests
scripts/zotero_push.py                     <- Python failure writer with optional enrichment
```
