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
| `024_drop_packets_sent_at.sql` | Drops `meetings.packets_sent_at`. The PDF-packet flow it tracked (`/wids-send-packets`, `/wids-make-guide`) is deprecated; Paper Pal supersedes it. Safe when the column is NULL on every row (verify with the `SELECT` in the migration header before applying). Do **not** add a replacement `meetings.paper_pal_generated_at` — use `paper_companions.generated_at` via `paper_id` instead. After apply, regenerate `web/lib/database.types.ts`. |
| `025_members_vouched_by_comment.sql` | Re-applies the `members.vouched_by` column comment. `023`'s `COMMENT` text was edited in place after `023` had been applied (`dc5ec0f`), so databases running the old wording never picked up the correction. Comment-only — no DDL, no data change, idempotent and safe to re-run. |

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
