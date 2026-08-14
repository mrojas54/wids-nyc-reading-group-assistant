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
| `007_members_select_grant.sql` | Grants authenticated reads on `members` so portal server actions can resolve the signed-in member row. |
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
| `023_members_vouched_by.sql` | Adds nullable self-referencing `members.vouched_by INT REFERENCES members(id) ON DELETE SET NULL`, a `members_vouched_by_not_self` CHECK, and a partial index. Source for the `vouch.firstName` token in `welcome-availability` (caller reduces `members.name` to a first name). Nullable by design — every pre-existing row has no voucher. Turning the vouch **card** off is `Blocks(vouch=False)`, but `vouch.firstName` is still required for the always-on intro/preheader/footer — see `docs/welcome-availability-flow.md`. No GRANT change, so the column stays invisible to `authenticated` portal sessions (migration 002 restricted `members` reads to `id, name, role`). |
| `025_members_vouched_by_comment.sql` | Re-applies the `members.vouched_by` column comment. `023`'s `COMMENT` text was edited in place after `023` had been applied (`dc5ec0f`), so databases running the old wording never picked up the correction. Comment-only — no DDL, no data change, idempotent and safe to re-run. `024` is skipped: it was claimed by in-flight work when this was written, and a gap is harmless where a duplicate number would not be. |
| `026_meetings_updated_at.sql` | Adds `meetings.updated_at` (backfilled from `created_at`, then `NOT NULL DEFAULT now()`) plus `public.set_updated_at()` and the `meetings_set_updated_at` BEFORE UPDATE trigger. Lets `calendar-rsvp-sync` tell which side of a Calendar-vs-database disagreement was written last — see [`docs/venue-drift.md`](../docs/venue-drift.md). The trigger's `WHEN (OLD.* IS DISTINCT FROM NEW.*)` guard keeps a no-op re-sync from advancing the timestamp and falsely suppressing a drift alert. **Contains a multi-row `UPDATE meetings`** (the backfill) — CLAUDE.md requires operator confirmation before applying. First `updated_at` in this schema; no other table has one. Regenerate `web/lib/database.types.ts` after applying. **Shipped the trigger function with `now()`; corrected forward by `027`.** |
| `027_set_updated_at_clock_timestamp.sql` | Redefines `public.set_updated_at()` to stamp `clock_timestamp()` rather than `now()`, and re-applies the function comment. `now()` is the *transaction start* time and is constant for the transaction's whole duration, so a long-running transaction backdated the row to before the write — wrong for a column whose only job is answering "which side was written more recently". The error was in the safe direction (an early stamp under-claims, so the tiebreaker surfaces a drift alert rather than suppressing one), which is why this is a correction and not an incident. Found by `tests/meetings_updated_at_test.sql`, which under `now()` could not observe `updated_at` advance at all — every UPDATE in a single-transaction test shared one timestamp, making the no-op guard untestable. `CREATE OR REPLACE FUNCTION` only: idempotent, no DDL on `meetings`, no data change, no confirmation needed. |
| `028_meetings_calendar_event.sql` | Applied 2026-08-14. Adds nullable `meetings.calendar_event_id` and `meetings.calendar_html_link` plus a partial lookup index, so a meeting records which Calendar event books it instead of re-deriving it from a `list_events` date-range + `WiDS NYC%` title search (`calendar-rsvp-sync` Step 2, `pre-meeting-reminder` Step 1b). `calendar_html_link` is the source for the `links.calendar` token in `assets/emails/template/rsvp-confirmation.{html,txt}` — earlier specs named `meetings.calendar_ics_url`, which **has never existed in this schema**, leaving that required token with no source at all. Pre-028 rows stay NULL and are **not backfillable**, so callers must keep the title-search fallback and downgrade affected recipients to the plain reminder. Index is deliberately **not** unique: a cancelled-then-rebooked meeting can legitimately leave a stale id behind. **Writing these columns in a separate UPDATE after booking advances `meetings.updated_at` and skews the venue-drift tiebreaker (026/027)** — write them in the same statement as `location`/`scheduled_at`. Additive + nullable, no backfill, no confirmation needed. Regenerate `web/lib/database.types.ts` after applying. |
| `029_command_log_needs_action.sql` | Applied 2026-08-14. **The web half is still outstanding — until it lands, a `needs_action` row is accepted by the database but renders info/green on `/admin/logs`, which is the failure mode this status exists to prevent.** Widens `command_log_status_check` to admit `needs_action` alongside `success`/`failure`/`no_action`, naming the state "the run did its own work correctly, but a human must act for the outcome to be real" — a drafted-but-unsent email. Nothing in this repo may send mail as the operator, so `pre-meeting-reminder` always drafts; under `success` a run holding 8 unsent drafts rendered info/green and looked identical to a clean one, which is how meeting 37 (2026-08-11) went out with nobody reminded. `no_action` goes amber but is false (drafts *were* created) and collides with the real nothing-to-do case. **Requires a matching `web/lib/logs.ts` change:** `LogStatus` (line 26) must include the value and `deriveSeverity` (line 93) must map it to `warn`, or its catch-all `return "info"` renders these rows green — the exact failure mode the status exists to prevent. `LogsTable.tsx`'s pill and `logs.css`'s `.statuspill.no_action` rule need counterparts, plus a case in `web/lib/__tests__/logs.test.ts`. Widening a CHECK admits a strict superset, so no existing row can violate it. Idempotent, no data change, no confirmation needed. |

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
- `meetings.updated_at` exists, is `NOT NULL`, and equals `created_at` on every
  row that has not been edited since migration 026; the
  `meetings_set_updated_at` trigger is attached to `meetings`, and
  `public.set_updated_at()` stamps `clock_timestamp()` (not `now()` — see 027).

Verified against the live project on 2026-08-14, after applying `028` and `029`:

- `meetings.calendar_event_id` and `meetings.calendar_html_link` exist as
  nullable `text`, and are NULL on every row booked before `028`; the partial
  index `meetings_calendar_event_id_idx` exists.
- `command_log_status_check` admits `needs_action`.

Still outstanding (not a database change):

- `web/lib/logs.ts` must add `needs_action` to `LogStatus` and map it to `warn`
  in `deriveSeverity`, or its catch-all `return "info"` renders these rows
  green. `LogsTable.tsx`'s status pill, `logs.css`'s `.statuspill` rule, and
  `web/lib/__tests__/logs.test.ts` need matching cases.
