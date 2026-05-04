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
