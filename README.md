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
- Apply the migrations in order:
  - `migrations/001_initial_schema.sql` — base tables. Paste into SQL Editor and run, or use Supabase MCP `apply_migration`.
  - `migrations/002_member_app.sql` — auth linkage, RLS policies, `companion_url` column, `current_member_id()` helper. Paste into SQL Editor and run, or use Supabase MCP `apply_migration`.
- Verify 10 base tables exist: `members, topics, papers, paper_topics, meetings, volunteers, availability, meeting_attendance, paper_suggestions, command_log`.
- Verify migration 002 added `members.auth_user_id`, `papers.companion_url`, the `current_member_id()` function, and 10 RLS policies.

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

### 4. Custom skill
The operator must have a `reading-group-guide` skill installed. The make-guide command invokes this skill; if it's not installed, `/wids-make-guide` will halt.

### 5. Scheduled-tasks MCP
After running `/wids-bootstrap`, register the scheduled task prompts (output by bootstrap) via the scheduled-tasks MCP. See [scheduled_tasks/README.md](scheduled_tasks/README.md).

### 6. Vercel project (only needed once the member portal is ready to deploy)
- Connect this GitHub repo to Vercel.
- Set the **Root Directory** to `web` in project settings.
- Add env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_GITHUB_REPO=mrojas54/wids-nyc-reading-group-assistant`.
- In Supabase → Authentication → URL Configuration, add `<vercel-url>/auth/callback` to the allowed redirect list.
- See [web/README.md](web/README.md) for full deployment notes.

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

The leader (a different person each cycle) handles `/wids-find-paper`, `/wids-make-guide`, `/wids-make-companion`, `/wids-send-packets`.

### When something goes wrong

- **DB write failed** → check `command_log` for the `failure` row with the error message. Server-action failures from the portal are logged with `source='server_action'`.
- **Form responses too low** → `form-response-chase` (renamed `availability-chase` after the portal cutover) will email you. Reply with what to do, or just nag your members on WhatsApp.
- **Leader has gone silent** → `leader-nudge` will email them. CC's you on the third nudge (packets-not-sent). At that point, step in.
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

Cycle pauses during operator absence — `cycle-keep-alive`, `form-response-chase` / `availability-chase`, and `leader-nudge` (third condition) emails queue up for your return. V2 will support a backup operator.

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
migrations/          SQL migrations (apply in order)
.claude/commands/    Operator slash commands (markdown)
scheduled_tasks/     Scheduled background task specs (markdown)
docs/                Specs and plans
tests/               SQL smoke tests (RLS)
web/                 Next.js member portal app
```
