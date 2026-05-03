# WiDS NYC AI Reading Group Assistant

Semi-autonomous workflow for running the WiDS NYC AI reading group. See `docs/superpowers/specs/2026-05-03-wids-nyc-reading-group-design.md` for the design and `docs/superpowers/plans/2026-05-03-wids-nyc-reading-group-implementation.md` for the implementation plan.

## Prerequisites (one-time setup)

Before running `/wids-bootstrap`, the operator must:

### 1. Supabase project
- Sign up at https://supabase.com (free tier).
- Create a new project (note the project URL and `service_role` key).
- Open the SQL Editor and paste the contents of `migrations/001_initial_schema.sql`. Run.
- Verify all 10 tables exist: `members, topics, papers, paper_topics, meetings, volunteers, availability, meeting_attendance, paper_suggestions, command_log`.

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
After running `/wids-bootstrap`, register the 8 scheduled task prompts (output by bootstrap) via the scheduled-tasks MCP. See `scheduled_tasks/README.md`.

## Running

Once prerequisites are met, run `/wids-bootstrap` in Claude Code from this directory.
