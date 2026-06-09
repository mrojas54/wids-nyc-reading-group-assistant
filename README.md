# WiDS NYC AI Reading Group Assistant

Semi-autonomous workflow plus a member-facing portal for running the WiDS NYC AI reading group.

**Repo:** https://github.com/mrojas54/wids-nyc-reading-group-assistant

## Two surfaces

- **Operator** — Claude Code slash commands (`/wids-bootstrap`, `/wids-meeting-start`, etc.) and scheduled background tasks. Drives the cycle: scheduling, paper picks, packet generation, calendar/email orchestration. Run from this repo.
- **Member portal** — Next.js web app at [web/](web/), deployed on Vercel. Members sign in with a magic link to submit availability, RSVP, see status, and read per-paper companion pages. Replaces the Google Form once cut over.

## Documentation

| Surface | Guide | Spec | Plan |
|---|---|---|---|
| Operator | — | [2026-05-03-wids-nyc-reading-group-design.md](docs/superpowers/specs/2026-05-03-wids-nyc-reading-group-design.md) | [2026-05-03-wids-nyc-reading-group-implementation.md](docs/superpowers/plans/2026-05-03-wids-nyc-reading-group-implementation.md) |
| Member portal | — | [2026-05-03-wids-member-app-design.md](docs/superpowers/specs/2026-05-03-wids-member-app-design.md) | [2026-05-03-wids-member-app.md](docs/superpowers/plans/2026-05-03-wids-member-app.md) |
| Paper Pal portal | [docs/paper-pal-portal.md](docs/paper-pal-portal.md) | [2026-05-17-paper-pal-design.md](docs/superpowers/specs/2026-05-17-paper-pal-design.md) | [2026-05-18-paper-pal-pr2-implementation.md](docs/superpowers/plans/2026-05-18-paper-pal-pr2-implementation.md) |
| Find-a-paper / suggest | [docs/admin-suggest.md](docs/admin-suggest.md) | [2026-05-06-wids-find-paper-suggest-design.md](docs/superpowers/specs/2026-05-06-wids-find-paper-suggest-design.md), [2026-06-07-arxiv-taxonomy-design.md](docs/superpowers/specs/2026-06-07-arxiv-taxonomy-design.md) | [2026-05-06-wids-find-paper-suggest-implementation.md](docs/superpowers/plans/2026-05-06-wids-find-paper-suggest-implementation.md), [2026-06-07-arxiv-taxonomy.md](docs/superpowers/plans/2026-06-07-arxiv-taxonomy.md) |
| Operator event log | [docs/admin-logs.md](docs/admin-logs.md) | — | — |

## Prerequisites (one-time operator setup)

Before running `/wids-bootstrap`, the operator must:

### 1. Supabase project
- Sign up at https://supabase.com (free tier).
- Create a new project (note the project URL and `service_role` key).
- Apply every file in `migrations/` in numeric order (`001` → `019`) — paste each into the Supabase SQL Editor, or use the Supabase MCP `apply_migration` tool. See [migrations/README.md](migrations/README.md) for what each migration does, the `ensure_rls` event-trigger gotcha, and the post-apply verification checklist.

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

Register these active task prompts (7): `pre-meeting-reminder`, `calendar-rsvp-sync`, `meeting-auto-advance`, `post-meeting-thanks`, `cycle-keep-alive`, `availability-chase`, and weekly `prune-paper-pdfs`. `leader-nudge` is **deprecated** — superseded by the Paper Pal companion flow; do not register.

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

The leader (a different person each cycle) handles `/wids-find-paper` and then generates the **Paper Pal companion** for the paper via the portal's operator surface at `/new` (signed in as a member with `role='operator'`, or as the meeting leader). `/new` uploads the paper PDF to the `papers-pdfs` Supabase Storage bucket and POSTs `/functions/v1/analyze-paper`, which streams a 5-stage progress SSE while it parses, calls the provider, and UPSERTs the synthesis into `paper_companions`. Paper Pal supersedes the previous `/wids-make-guide` + `/wids-make-companion` + `/wids-send-packets` chain — those slash commands remain as a fallback but the portal flow is the supported path. Members read the companion live at `/papers/<id>`; no PDF packet is mailed. Apply migrations through `019_meetings_propose_placeholder_unique.sql` before going live, and see [docs/paper-pal-portal.md](docs/paper-pal-portal.md) for the full member, leader, and ops workflow.

### When something goes wrong

- **DB write failed** → check `/admin/logs` or query `command_log` for the `failure` row with the error message. Server-action failures from the portal are logged with `source='server_action'`. See [docs/admin-logs.md](docs/admin-logs.md) for filters, enrichment fields, and idempotency-key conventions.
- **Form responses too low** → `availability-chase` will email you. Reply with what to do, or just nag your members on WhatsApp.
- **Leader has gone silent** → the Paper Pal companion flow handles leader follow-up. (The standalone `leader-nudge` task is deprecated; do not register it.)
- **Calendar event got rescheduled by someone** → `calendar-rsvp-sync` syncs it back to the DB nightly.
- **Paper Pal synthesis failed** → the `/new` upload page surfaces the error inline; inspect the Supabase Edge Function logs for `analyze-paper`. The leader retries by re-uploading the PDF at `/new?paperId=<id>`. (Legacy fallback only: if running the deprecated `/wids-make-guide` chain, a failure sets `meetings.status='guide_failed'` and is re-run manually.)
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

## Python tooling

The operator-side Python helpers under [scripts/](scripts/) (paper suggestion, Zotero
push, arXiv taxonomy, email preview rendering) are managed with
[uv](https://docs.astral.sh/uv/). Dependencies and tool config live in a single
[pyproject.toml](pyproject.toml); the resolved set is pinned in the committed
`uv.lock`.

```sh
uv sync                  # install the locked dependency set (creates .venv/)
uv run pytest tests      # run the Python test suite
uv run ruff check scripts tests
uv run mypy              # type-check (strict) the scripts/ package
```

`uv sync --frozen` asserts the lockfile is in sync with `pyproject.toml` and is what
CI runs — re-run `uv lock` after changing a dependency so the lock stays current.
The optional `ml` extra (`uv sync --extra ml`) pulls the heavy torch/transformers
stack needed only by the SPECTER2 embedding scripts.

## Repository layout

```
migrations/          SQL migrations, applied in numeric order (see migrations/README.md)
supabase/functions/  Deno edge functions (Paper Pal synthesis + assessment)
.claude/commands/    Operator slash commands (markdown)
scheduled_tasks/     Scheduled background task specs (markdown)
scripts/             Operator-side Python helpers (uv-managed; see "Python tooling")
docs/                Guides, specs, and plans
tests/               SQL smoke tests (RLS) + Python unit tests (pytest)
web/                 Next.js member portal app
pyproject.toml       Python deps + ruff/mypy config (single source of truth)
```
