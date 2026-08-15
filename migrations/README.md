# Database migrations

SQL migrations for the WiDS NYC reading-group Supabase project, applied
**in numeric order**. They are hand-applied — paste each file
into the Supabase SQL Editor, or use the Supabase MCP `apply_migration` tool.
There is no migration-tracking table; filenames define order only.

Because of that, **do not edit a migration that has already been applied** —
not even its comments. Changing a landed file updates the repository but not
any database that already ran it, so the two silently disagree. Correct a
landed migration with a new forward migration instead (see `025`, which
re-applies a `COMMENT` that was edited in place on `023`). Editing an
unapplied migration you have not yet run anywhere is fine.

| File | What it does |
|---|---|
| `001_initial_schema.sql` | Base tables. |
| `002_member_app.sql` | Auth linkage, RLS policies for portal tables, `companion_url` column, `current_member_id()` helper. |
| `003_rls_policies.sql` | RLS policies for `topics`, `paper_topics`, `paper_suggestions`, `volunteers`. Browser (anon-key + session) reads via these. |
| `004_function_grants.sql` | Restricts the `current_member_id()` RPC to authenticated callers only. |
| `005_revoke_rls_auto_enable.sql` | Hides the `rls_auto_enable()` event-trigger function from PostgREST. |
| `006_members_phone.sql` | Validates nullable `members.phone` / `members.whatsapp` values as E.164. |
| `007_members_select_grant.sql` | Grants authenticated reads on `members` so portal server actions can resolve the signed-in member row. **Table-level `SELECT` — over-broad.** Postgres treats that as every column, so it undid the `002` column lock. Corrected forward by `031`. |
| `008_meeting_attendance_grants.sql` | Pins authenticated grants for RSVP reads/writes and the attendance sequence. |
| `009_papers_zotero_item_key.sql` | Stores the Zotero group-library item key after companion pushes. |
| `010_paper_embeddings.sql` | Enables `pgvector`; creates the `paper_embeddings` cache used by paper-suggestion ranking. |
| `011_papers_s2_paper_id.sql` | Adds `papers.s2_paper_id` for Semantic Scholar lookups. |
| `012_papers_s2_paper_id_constraint.sql` | Replaces the partial S2-ID index with a full unique constraint for Supabase upserts. |
| `013_paper_companions.sql` | Creates the `paper_companions` table (JSONB Paper Pal synthesis payload, keyed by `paper_id`) and its four RLS policies. |
| `014_members_role_leader_admin.sql` | Widens `members.role` to `member \| operator \| leader \| admin`; `operator` stays unique, `leader` / `admin` are uncapped. |
| `015_availability_created_at.sql` | Adds `availability.created_at` plus a `(meeting_id, created_at)` index for reminder-chase queries. Existing rows are backfilled with migration time, not their true historical submission time. |
| `016_paper_pal_provider_metadata.sql` | Adds provider/rate-limit/telemetry columns to `paper_companions`, creates `paper_socratic_turns`, and the atomic `upsert_paper_companion()` write RPC. |
| `017_synthesis_gate_rpc.sql` | `can_synthesize_paper_pal()` and `current_member_role()` RPCs — the single source of truth for the Paper Pal synthesis gate. |
| `018_papers_pdfs_bucket.sql` | Creates the private `papers-pdfs` Storage bucket and the INSERT RLS policy gating PDF uploads to synthesis-eligible callers. |
| `019_meetings_propose_placeholder_unique.sql` | Partial unique index on `meetings(paper_id)` for `prep` `reading_group` rows with no `planned_by_admin_id` — one member-proposed placeholder per paper, so concurrent `proposePaper` calls can't mint duplicates. |
| `020_command_log_enrichment.sql` | Adds `command_log.duration_ms`, `metadata` (JSONB, default `{}`), `idempotency_key` (nullable, partial-unique for at-most-once keyed runs), and `actor`. Writers: `web/lib/log.ts` (`logServerAction` 5th arg) and `scripts/zotero_push.py` (`record_failure` kwargs). |
| `021_blackout_periods.sql` | Creates the `blackout_periods` table (half-open `[range_start, range_end)` windows) and seeds the two 2026 summer-break windows. Service-role-only (no RLS policies), read by the scheduler and the availability portal. |
| `022_papers_prerequisites.sql` | Adds nullable `papers.prerequisites` JSONB — the AI-drafted announcement bundle (`{lede, items, summary, short_title, status, model, generated_at}`) consumed by the new-paper-announcement email via `scripts/generate_prerequisites.py`. Additive + nullable; papers RLS unaffected. |
| `023_members_vouched_by.sql` | Adds nullable self-referencing `members.vouched_by INT REFERENCES members(id) ON DELETE SET NULL`, a `members_vouched_by_not_self` CHECK, and a partial index. Source for the `vouch.firstName` token in `welcome-availability` (caller reduces `members.name` to a first name). Nullable by design — every pre-existing row has no voucher. Turning the vouch **card** off is `Blocks(vouch=False)`, but `vouch.firstName` is still required for the always-on intro/preheader/footer — see `docs/welcome-availability-flow.md`. Header claims `vouched_by` is invisible to `authenticated` because `002` locked `members` to `(id, name, role)`. That lock was already gone: `007` granted table-level `SELECT`. Restored by `031`. |
| `024_drop_packets_sent_at.sql` | Drops `meetings.packets_sent_at`. The PDF-packet flow it tracked (`/wids-send-packets`, `/wids-make-guide`) is deprecated; Paper Pal supersedes it. Safe when the column is NULL on every row (verify with the `SELECT` in the migration header before applying). Do **not** add a replacement `meetings.paper_pal_generated_at` — use `paper_companions.generated_at` via `paper_id` instead. After apply, regenerate `web/lib/database.types.ts`. |
| `025_members_vouched_by_comment.sql` | Re-applies the `members.vouched_by` column comment. `023`'s `COMMENT` text was edited in place after `023` had been applied (`dc5ec0f`), so databases running the old wording never picked up the correction. Comment-only — no DDL, no data change, idempotent and safe to re-run. |
| `026_meetings_updated_at.sql` | Adds `meetings.updated_at` (backfilled from `created_at`, then `NOT NULL DEFAULT now()`) plus `public.set_updated_at()` and the `meetings_set_updated_at` BEFORE UPDATE trigger. Lets `calendar-rsvp-sync` tell which side of a Calendar-vs-database disagreement was written last — see [`docs/venue-drift.md`](../docs/venue-drift.md). The trigger's `WHEN (OLD.* IS DISTINCT FROM NEW.*)` guard keeps a no-op re-sync from advancing the timestamp and falsely suppressing a drift alert. **Contains a multi-row `UPDATE meetings`** (the backfill) — CLAUDE.md requires operator confirmation before applying. First `updated_at` in this schema; no other table has one. Regenerate `web/lib/database.types.ts` after applying. **Shipped the trigger function with `now()`; corrected forward by `027`.** |
| `027_set_updated_at_clock_timestamp.sql` | Redefines `public.set_updated_at()` to stamp `clock_timestamp()` rather than `now()`, and re-applies the function comment. `now()` is the *transaction start* time and is constant for the transaction's whole duration, so a long-running transaction backdated the row to before the write — wrong for a column whose only job is answering "which side was written more recently". The error was in the safe direction (an early stamp under-claims, so the tiebreaker surfaces a drift alert rather than suppressing one), which is why this is a correction and not an incident. Found by `tests/meetings_updated_at_test.sql`, which under `now()` could not observe `updated_at` advance at all — every UPDATE in a single-transaction test shared one timestamp, making the no-op guard untestable. `CREATE OR REPLACE FUNCTION` only: idempotent, no DDL on `meetings`, no data change, no confirmation needed. |
| `028_meetings_calendar_event.sql` | Adds nullable `meetings.calendar_event_id` and `meetings.calendar_html_link` plus a partial unique index on the id, so the Google Calendar event behind a meeting is identified by a stored key instead of the `scheduled_at` + `WiDS NYC%` title search that `calendar-rsvp-sync` Step 2 itself flagged as a V1 shortcut. Also gives `links.calendar` in the RSVP thank-you a real source, replacing `meetings.calendar_ics_url` — a column named by the spec that has never existed in this schema. **Not backfilled and not backfillable:** an event id lives only in Google's copy, so every pre-`028` row stays NULL and consumers must keep the title search as a documented fallback rather than reading NULL as "no event exists". Populated at booking time by `/wids-schedule-reading-group` and `/wids-schedule-admin`. Purely additive (two nullable `ADD COLUMN`s, one index) — no `UPDATE`, no confirmation needed. Regenerate `web/lib/database.types.ts` after applying. |
| `029_command_log_needs_action_status.sql` | Widens the `command_log_status_check` CHECK to add a fourth status, `needs_action`: the run finished its own work and a **human must now act** for the outcome to be real. Exists because the three original statuses could not express that — `success` renders `info`/green on `/admin/logs`, so a run holding 8 unsent Gmail drafts looked identical to a clean one, and `no_action` renders warn but is untrue and collides with the genuine nothing-to-do case. Maps to **warn** in `web/lib/logs.ts`, rendered amber rather than `no_action`'s neutral grey. The standing producer is any member-facing scheduled task, since the Gmail MCP has no send tool and those tasks terminate in a draft the operator sends. Widening a CHECK cannot invalidate existing rows, so there is no backfill and no row rewrite; `ADD CONSTRAINT` does take a brief ACCESS EXCLUSIVE lock and re-validate the table, which is immaterial on a small service-role-only table. `DROP ... IF EXISTS` + `ADD` in one transaction, so it is re-runnable and a failure leaves the original constraint in place. No confirmation needed. `status` is typed as plain `string` in `web/lib/database.types.ts`, so no regeneration is required. |
| `030_meetings_grants.sql` | Revokes the leftover default `GRANT ALL` on `meetings` from `anon`/`authenticated` and pins the table to `SELECT`-only for `authenticated` (nothing for `anon`), matching the one policy that actually exists (`meetings_select`). Closes a latent gap: RLS had no write policy on `meetings`, so the stale grant was harmless today, but it was the widest possible ceiling for whatever write policy gets added next. All current `meetings` writes already go through the service-role client (`web/lib/paperpal/inbox-actions.ts`), so this changes no observable behavior. Also drops the now-unused `USAGE`/`SELECT` grant on `meetings_id_seq`. |
| `031_members_column_grants.sql` | Restores the `members` column lock. `REVOKE ALL` from `anon`/`authenticated`, then `GRANT SELECT (id, name, role, auth_user_id)` to `authenticated` — the four columns the portal session client actually reads (`auth_user_id` is what `007` needed; `007`'s table-level `SELECT` had re-opened `email` / `phone` / `whatsapp` / `active` / `vouched_by`). Also drops leftover default write grants and the unused `members_id_seq` USAGE, matching `030`'s meetings posture. No row rewrite. After apply: `psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f tests/members_column_grants_test.sql`. |
| `032_replace_my_availability.sql` | Adds `replace_my_availability(meeting_id, range_starts[], range_ends[])` — a `SECURITY DEFINER` RPC that deletes and re-inserts the caller's availability rows in one transaction, bound to `current_member_id()` and `meetings.status = 'prep'`. Also adds `UNIQUE (meeting_id, member_id, range_start)` so overlapping submits cannot duplicate a day. Replaces the two-round-trip delete-then-insert in `web/app/availability/actions.ts`. Preview for duplicate days before applying (see migration header). After apply: `psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f tests/replace_my_availability_test.sql`. |

## `ensure_rls` event trigger

This project's database has a custom event trigger named `ensure_rls`
(function `public.rls_auto_enable()`, owner `postgres`) that auto-runs
`ALTER TABLE ... ENABLE ROW LEVEL SECURITY` on every new table created in the
`public` schema. It was added out-of-band — not in any migration here — and is
intentionally kept as a defense-in-depth guardrail.

**Implication for new tables:** RLS is on automatically, so a migration that
creates a table *must* also add policies, or the table is invisible to the
browser (anon/authenticated). `command_log` is the one accepted exception
(service-role-only, no browser access needed).

## Post-migration verification

- 10 base tables exist: `members`, `topics`, `papers`, `paper_topics`,
  `meetings`, `volunteers`, `availability`, `meeting_attendance`,
  `paper_suggestions`, `command_log`.
- Portal columns and helpers exist: `members.auth_user_id`,
  `members.vouched_by`, `members.role` accepts `leader` / `admin`,
  `papers.companion_url`, `papers.s2_paper_id`, `papers.zotero_item_key`,
  `papers.prerequisites`, `availability.created_at`, the
  `current_member_id()` function, and 10 RLS policies.
- `meetings.packets_sent_at` is **absent** after `024`. Derive Paper Pal
  readiness from `paper_companions.generated_at` (see migration header).
  Active operator prompts that still queried the old column — notably
  `/wids-status` — were updated to join `paper_companions` instead.
- Paper Pal artifacts exist: `paper_companions`,
  `paper_socratic_turns`, `paper_embeddings`, the
  `upsert_paper_companion()`, `can_synthesize_paper_pal(int)`, and
  `current_member_role()` functions, plus the
  `meetings_propose_placeholder_paper_unique` partial unique index.
- Storage is ready for portal synthesis: the private `papers-pdfs` bucket
  exists, and `storage.objects` has the
  `papers_pdfs_owner_or_leader_insert` INSERT policy.
- `command_log` carries the enrichment columns `duration_ms`, `metadata`
  (JSONB, default `{}`), `idempotency_key`, and `actor`, plus the
  `command_log_idempotency_key_unique` partial unique index.
- `blackout_periods` exists and remains service-role-only.
- `replace_my_availability(int, timestamptz[], timestamptz[])` exists and is
  executable by `authenticated`. `availability` has a unique index on
  `(meeting_id, member_id, range_start)`.
- `meetings.updated_at` exists, is `NOT NULL`, and equals `created_at` on every
  row that has not been edited since migration 026; the
  `meetings_set_updated_at` trigger is attached to `meetings`, and
  `public.set_updated_at()` stamps `clock_timestamp()` (not `now()` — see 027).
- `meetings` grants: `authenticated` holds exactly `SELECT`; `anon` holds
  nothing. Check with:
  `SELECT grantee, privilege_type FROM information_schema.role_table_grants
  WHERE table_schema = 'public' AND table_name = 'meetings' ORDER BY 1, 2;`
- `members` grants after `031`: `authenticated` can `SELECT` only
  `id`, `name`, `role`, `auth_user_id`; `anon` holds nothing; neither role
  has INSERT/UPDATE/DELETE. Check with:
  `SELECT has_column_privilege('authenticated', 'public.members', c, 'SELECT')
  FROM unnest(ARRAY['id','name','role','auth_user_id','email','phone',
  'whatsapp','active','vouched_by']) AS c;`
  — expected `t t t t f f f f f`.
