# WiDS NYC AI Reading Group Assistant

Semi-autonomous workflow plus a member-facing portal for running the WiDS NYC AI reading group.

**Repo:** https://github.com/mrojas54/wids-nyc-reading-group-assistant

## Two surfaces

- **Operator** — Claude Code slash commands (`/wids-bootstrap`, `/wids-meeting-start`, etc.) and scheduled background tasks. Drives the cycle: scheduling, paper picks, packet generation, calendar/email orchestration. Run from this repo.
- **Member portal** — Next.js 14 web app at [web/](web/), deployed on Vercel. Members sign in with a magic link to submit availability, RSVP, see status, and read per-paper companion pages. Replaces the Google Form once cut over.

## Documentation

| Surface | Spec | Plan |
|---|---|---|
| Operator | [2026-05-03-wids-nyc-reading-group-design.md](docs/superpowers/specs/2026-05-03-wids-nyc-reading-group-design.md) | [2026-05-03-wids-nyc-reading-group-implementation.md](docs/superpowers/plans/2026-05-03-wids-nyc-reading-group-implementation.md) |
| Member portal | [2026-05-03-wids-member-app-design.md](docs/superpowers/specs/2026-05-03-wids-member-app-design.md) | [2026-05-03-wids-member-app.md](docs/superpowers/plans/2026-05-03-wids-member-app.md) |

## Prerequisites (one-time operator setup)

Before running `/wids-bootstrap`, the operator must:

### 1. Supabase project
- Sign up at https://supabase.com (free tier).
- Create a new project (note the project URL and `service_role` key).
- Apply the migrations in order. Historical hand-applied files live in `migrations/`; newer Supabase CLI files live in `supabase/migrations/`. A production project needs both sets:
  - `migrations/001_initial_schema.sql` — base tables. Paste into SQL Editor and run, or use Supabase MCP `apply_migration`.
  - `migrations/002_member_app.sql` — auth linkage, RLS policies for portal tables, `companion_url` column, `current_member_id()` helper.
  - `migrations/003_rls_policies.sql` — RLS policies for `topics`, `paper_topics`, `paper_suggestions`, `volunteers`. Browser (anon-key + session) reads via these.
  - `migrations/004_function_grants.sql` — restricts `current_member_id()` RPC to authenticated callers only.
  - `migrations/005_revoke_rls_auto_enable.sql` — hides the `rls_auto_enable()` event-trigger function from PostgREST.
  - `migrations/006_members_phone.sql` — validates nullable `members.phone` / `members.whatsapp` values as E.164.
  - `migrations/007_members_select_grant.sql` — grants authenticated reads on `members` so portal server actions can resolve the signed-in member row.
  - `migrations/008_meeting_attendance_grants.sql` — pins authenticated grants for RSVP reads/writes and the attendance sequence.
  - `migrations/009_papers_zotero_item_key.sql` — stores the Zotero group-library item key after companion pushes.
  - `migrations/010_paper_embeddings.sql` — enables `pgvector` and creates the `paper_embeddings` cache used by paper suggestion ranking.
  - `migrations/011_papers_s2_paper_id.sql` — adds `papers.s2_paper_id` for Semantic Scholar lookups.
  - `migrations/012_papers_s2_paper_id_constraint.sql` — replaces the partial S2 ID index with a full unique constraint for Supabase upserts.
  - `migrations/013_paper_companions.sql` — creates the `paper_companions` table (the JSONB Paper Pal synthesis payload, keyed by `paper_id`) and its four RLS policies.
  - `migrations/014_members_role_leader_admin.sql` — widens `members.role` to `member | operator | leader | admin`; `operator` remains unique, `leader` / `admin` are uncapped.
  - `supabase/migrations/20260518040000_015_availability_created_at.sql` — adds `availability.created_at` plus `(meeting_id, created_at)` index for reminder-chase queries. Existing rows are backfilled with migration time, not their true historical submission time.
  - `migrations/016_paper_pal_provider_metadata.sql` — adds provider/rate-limit/telemetry columns to `paper_companions`, creates `paper_socratic_turns`, and the atomic `upsert_paper_companion()` write RPC.
  - `migrations/017_synthesis_gate_rpc.sql` — `can_synthesize_paper_pal()` and `current_member_role()` RPCs; the single source of truth for the Paper Pal synthesis gate.
  - `migrations/018_papers_pdfs_bucket.sql` — creates the private `papers-pdfs` Storage bucket and the INSERT RLS policy gating PDF uploads to synthesis-eligible callers.
  - Note: file numbering jumps from `014` to `015` (the `015` file lives under `supabase/migrations/`); `016`–`018` resume in `migrations/`. Apply all files in numeric order regardless of directory.
- Verify 10 base tables exist: `members, topics, papers, paper_topics, meetings, volunteers, availability, meeting_attendance, paper_suggestions, command_log`.
- Verify portal columns and helpers exist: `members.auth_user_id`, `members.role` accepts `leader` / `admin`, `papers.companion_url`, `papers.s2_paper_id`, `papers.zotero_item_key`, `availability.created_at`, the `current_member_id()` function, and 10 RLS policies.

#### Note: `ensure_rls` event trigger
This project's database has a custom event trigger named `ensure_rls` (function: `public.rls_auto_enable()`, owner: `postgres`) that auto-runs `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` on every new table created in the `public` schema. It was added out-of-band (not in any migration in this repo) and is intentionally kept as a defense-in-depth guardrail. **Implication for new tables:** RLS will be on automatically — your migration must add policies, or the table will be invisible to the browser (anon/authenticated). `command_log` is the one accepted exception (service-role-only, no browser access needed).

### 2. Google Drive root folder
- Create a folder in your Drive named `WiDS NYC AI Reading Group`.
- Inside it, create a subfolder named `cycles`.
- Note the root folder URL (you'll paste it during bootstrap).

### 3. Claude Code MCPs
Configure these MCPs in your Claude Code settings:
- **Supabase MCP** — connects to the Postgres project; needs project URL + service_role key.
- **Drive MCP** (already connected for most users) — for creating cycle subfolders and uploading PDFs.
- **Gmail MCP** (already connected for most users) — for sending emails and creating drafts.
- **Calendar MCP** (already connected for most users) — for creating Meet/in-person events.

#### Destructive SQL guard

This repo installs a Claude Code `PreToolUse` hook at [.claude/hooks/destructive-sql-guard.sh](.claude/hooks/destructive-sql-guard.sh), wired by [.claude/settings.json](.claude/settings.json). It inspects Bash commands and MCP SQL calls matching `mcp__.*__execute_sql` / `mcp__.*__apply_migration`.

The guard blocks `DELETE`, `TRUNCATE`, and `DROP TABLE` / `DROP COLUMN` statements against production tables `members`, `meetings`, `papers`, `availability`, and `command_log` until the operator gives explicit confirmation for the exact statement. The safe workflow is:

1. Paste the exact destructive SQL into chat.
2. Run a `SELECT` preview showing the rows or objects that would be affected.
3. Wait for an explicit affirmative (`yes`, `confirm`, or `proceed`) on that exact command.
4. Re-run the destructive statement.

Context such as "reset the cycle" or "I told members" is not enough. This README section is the policy Claude Code should follow.

### 4. Custom skill
The operator must have a `reading-group-guide` skill installed. The make-guide command invokes this skill; if it's not installed, `/wids-make-guide` will halt.

### 5. Scheduled-tasks MCP
After running `/wids-bootstrap`, register the scheduled task prompts (output by bootstrap) via the scheduled-tasks MCP. See [scheduled_tasks/README.md](scheduled_tasks/README.md).

Currently deployed (6): `pre-meeting-reminder`, `calendar-rsvp-sync`, `meeting-auto-advance`, `post-meeting-thanks`, `cycle-keep-alive`, and `availability-chase`. `leader-nudge` is **deprecated** — superseded by the Paper Pal companion flow; do not register.

### 6. Vercel project (only needed once the member portal is ready to deploy)
- Connect this GitHub repo to Vercel.
- Set the **Root Directory** to `web` in project settings.
- Add env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_GITHUB_REPO=mrojas54/wids-nyc-reading-group-assistant`.
- In Supabase → Authentication → URL Configuration, add `<vercel-url>/auth/callback` to the allowed redirect list.
- See [web/README.md](web/README.md) for full deployment notes.

### 7. Custom SMTP for magic-link auth

Supabase's built-in SMTP is rate-limited to ~2 emails/hour, which
throttles members during sign-in bursts. Before going live with the
member portal, configure **Resend** as a custom SMTP provider using
a Cloudflare-registered domain.

See the step-by-step runbook: [`docs/runbooks/smtp-auth-setup.md`](docs/runbooks/smtp-auth-setup.md)

One-time cost: ~$10/year for the `.org` domain. Resend's free tier
(3,000 emails/month, 100/day) covers this group's volume.

## Running

Once prerequisites are met, run `/wids-bootstrap` in Claude Code from this directory.

## Operator handbook

### What you'll do per cycle (~5 commands, spread over 4 weeks)

1. **Week 4** (after last reading group): `/wids-meeting-start admin` — kicks off planning, sends Form 1.
2. **Week 5** (ongoing): periodically export the Form 1 responses CSV from Google Forms and upload to `<drive_root>/cycles/<cycle_label>/admin-form-responses.csv`. The `process-form` scheduled task ingests new rows daily — no command needed. (Note: once the member portal cuts over, this CSV step disappears — members submit availability directly in the portal.)
3. **Week 5–6**: `/wids-schedule-admin` — picks the admin meeting date.
4. **Week 6** (during/after the admin meeting):
   - `/wids-pick-leader` — algorithm picks; you confirm or override.
   - `/wids-meeting-start reading_group` — sends Form 2.
5. **Week 7**:
   - Periodically export Form 2 responses to `<drive_root>/cycles/<cycle_label>/rg-form-responses.csv`. (Same passive ingestion via `process-form`. Also retired once the portal cuts over.)
   - `/wids-schedule-reading-group` — picks the reading group date with venue.
6. **Optional anytime**: `/wids-status` — read-only dashboard showing exactly where you are.

The leader (a different person each cycle) handles `/wids-find-paper` and then generates the **Paper Pal companion** for the paper via the portal's operator surface at `/new` (signed in as a member with `role='operator'`). `/new` uploads the paper PDF to the `papers-pdfs` Supabase Storage bucket and POSTs `/functions/v1/analyze-paper`, which streams a 5-stage progress SSE while it parses, calls the provider, and UPSERTs the synthesis into `paper_companions`. Paper Pal supersedes the previous `/wids-make-guide` + `/wids-make-companion` + `/wids-send-packets` chain — those slash commands remain as a fallback but the portal flow is the supported path. Members read the companion live at `/papers/<id>`; no PDF packet is mailed. Apply migrations through `018_papers_pdfs_bucket.sql` before going live.

### When something goes wrong

- **DB write failed** → check `command_log` for the `failure` row with the error message. Server-action failures from the portal are logged with `source='server_action'`.
- **Form responses too low** → `availability-chase` will email you. Reply with what to do, or just nag your members on WhatsApp.
- **Leader has gone silent** → the Paper Pal companion flow handles leader follow-up. (The standalone `leader-nudge` task is deprecated; do not register it.)
- **Calendar event got rescheduled by someone** → `calendar-rsvp-sync` syncs it back to the DB nightly.
- **Guide or companion generation failed** → `meetings.status='guide_failed'`. Leader investigates, re-runs `/wids-make-guide` or `/wids-make-companion` manually.
- **CSV upload not picked up** → check `command_log` for the `process-form` rows. Verify CSV path matches the convention exactly. (Goes away post-portal-cutover.)

### Rolling backups

Supabase free tier includes daily backups (7 days retention). For heavier insurance, periodically run:
```sql
COPY (SELECT * FROM members) TO STDOUT CSV HEADER;
COPY (SELECT * FROM meetings) TO STDOUT CSV HEADER;
-- ... etc per table
```
and stash the dumps in your Drive folder.

### Going on vacation

Cycle pauses during operator absence — `cycle-keep-alive` and `availability-chase` emails queue up for your return. V2 will support a backup operator.

### Smoke testing

Run `/wids-simulate-cycle` against a separate Supabase project to walk through the full cycle without affecting production data. See [.claude/commands/wids-simulate-cycle.md](.claude/commands/wids-simulate-cycle.md) for prerequisites.

### V2 candidates

See `docs/superpowers/specs/2026-05-03-wids-nyc-reading-group-design.md` for the full list. Top candidates:
- WhatsApp integration (Twilio)
- Auto-generated meeting minutes from transcript
- Zotero / arxiv-sanity integration
- Backup operator support

## Member portal local dev

```sh
cd web
cp .env.example .env.local   # fill in values
npm install
npm run dev
```

Opens http://localhost:3000. See [web/README.md](web/README.md).

## Repository layout

```
migrations/          Historical SQL migrations (apply in order)
supabase/migrations/ Supabase CLI timestamped migrations
.claude/commands/    Operator slash commands (markdown)
scheduled_tasks/     Scheduled background task specs (markdown)
docs/                Specs and plans
tests/               SQL smoke tests (RLS)
web/                 Next.js member portal app
```
