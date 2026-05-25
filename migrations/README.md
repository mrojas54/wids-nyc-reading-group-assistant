# Database migrations

SQL migrations for the WiDS NYC reading-group Supabase project, applied
**in numeric order** (`001` → `019`). They are hand-applied — paste each file
into the Supabase SQL Editor, or use the Supabase MCP `apply_migration` tool.
There is no migration-tracking table; filenames define order only.

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
- Portal columns and helpers exist: `members.auth_user_id`, `members.role`
  accepts `leader` / `admin`, `papers.companion_url`, `papers.s2_paper_id`,
  `papers.zotero_item_key`, `availability.created_at`, the
  `current_member_id()` function, and 10 RLS policies.
- Paper Pal artifacts exist: `paper_companions`,
  `paper_socratic_turns`, `paper_embeddings`, the
  `upsert_paper_companion()`, `can_synthesize_paper_pal(int)`, and
  `current_member_role()` functions, plus the
  `meetings_propose_placeholder_paper_unique` partial unique index.
- Storage is ready for portal synthesis: the private `papers-pdfs` bucket
  exists, and `storage.objects` has the
  `papers_pdfs_owner_or_leader_insert` INSERT policy.
