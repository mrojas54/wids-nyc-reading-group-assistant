# WiDS NYC AI Reading Group Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the multi-agent workflow described in `docs/superpowers/specs/2026-05-03-wids-nyc-reading-group-design.md` — a hybrid of Claude Code slash commands + scheduled background tasks for running the WiDS NYC AI reading group.

**Architecture:** Pure markdown slash commands (`.claude/commands/wids-*.md`) that orchestrate MCPs (Supabase for state, Drive for artifacts, Gmail for email, Calendar for events). No Python library — algorithms are SQL queries, PDF generation is delegated to the operator's custom `reading-group-guide` skill + Anthropic's `pdf` skill. Scheduled tasks are markdown prompts registered with the scheduled-tasks MCP.

**Tech Stack:** Claude Code, Supabase Postgres (free tier), Google Drive/Gmail/Calendar MCPs, Anthropic scheduled-tasks MCP, custom `reading-group-guide` skill.

---

## Phase 0 — Project foundations

### Task 0.1: Initialize project structure and git

**Files:**
- Create: `.gitignore`
- Create: `.claude/commands/.gitkeep`
- Create: `migrations/.gitkeep`
- Create: `scheduled_tasks/.gitkeep`
- Create: `README.md` (stub)

- [ ] **Step 1: Create directory structure**

```bash
cd /Users/michellerojas/wids_reading_group_assisstant
mkdir -p .claude/commands migrations scheduled_tasks
touch .claude/commands/.gitkeep migrations/.gitkeep scheduled_tasks/.gitkeep
```

- [ ] **Step 2: Write .gitignore**

```
# OS
.DS_Store
Thumbs.db

# Editors
.vscode/
.idea/
*.swp

# Local config / credentials
.env
.env.local
.envrc
*.pem
*.key

# Build artifacts
__pycache__/
*.pyc
node_modules/
dist/
build/
```

- [ ] **Step 3: Write README stub**

```markdown
# WiDS NYC AI Reading Group Assistant

Semi-autonomous workflow for running the WiDS NYC AI reading group. See `docs/superpowers/specs/2026-05-03-wids-nyc-reading-group-design.md` for the design.

## Quick start

1. Set up Supabase project, Drive folder, and operator's MCP configuration.
2. Run `/wids-bootstrap` in Claude Code to seed members, topics, and kick off the first cycle.

(Full setup instructions added in Phase 5.)
```

- [ ] **Step 4: git init + first commit**

```bash
git init
git add .gitignore README.md .claude/ migrations/ scheduled_tasks/ docs/
git commit -m "chore: initialize project structure"
```

Verify: `git log --oneline` shows one commit.

---

### Task 0.2: Write Supabase schema migration

**Files:**
- Create: `migrations/001_initial_schema.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- migrations/001_initial_schema.sql
-- WiDS NYC AI Reading Group Assistant — initial schema
-- Apply via: supabase db push, or paste into Supabase SQL Editor

BEGIN;

CREATE TABLE members (
  id        SERIAL PRIMARY KEY,
  name      TEXT NOT NULL,
  email     TEXT NOT NULL UNIQUE,
  phone     TEXT,
  whatsapp  TEXT,
  active    BOOLEAN NOT NULL DEFAULT true,
  role      TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'operator')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX one_operator ON members(role) WHERE role='operator';

CREATE TABLE topics (
  id     SERIAL PRIMARY KEY,
  name   TEXT NOT NULL UNIQUE,
  weight INT NOT NULL DEFAULT 1
);

CREATE TABLE papers (
  id            SERIAL PRIMARY KEY,
  title         TEXT NOT NULL,
  url           TEXT,
  abstract      TEXT,
  authors       TEXT[],
  venue         TEXT,
  year          INT,
  pdf_drive_url TEXT,
  added_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE paper_topics (
  paper_id INT REFERENCES papers(id) ON DELETE CASCADE,
  topic_id INT REFERENCES topics(id) ON DELETE CASCADE,
  PRIMARY KEY (paper_id, topic_id)
);

CREATE TABLE meetings (
  id                  SERIAL PRIMARY KEY,
  type                TEXT NOT NULL CHECK (type IN ('admin', 'reading_group')),
  status              TEXT NOT NULL CHECK (status IN ('prep','scheduled','done','cancelled','guide_failed')),
  scheduled_at        TIMESTAMPTZ,
  location            TEXT,
  planned_by_admin_id INT REFERENCES meetings(id),
  leader_id           INT REFERENCES members(id),
  paper_id            INT REFERENCES papers(id),
  form_url            TEXT,
  drive_folder_url    TEXT,
  packets_sent_at     TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE volunteers (
  id           SERIAL PRIMARY KEY,
  meeting_id   INT NOT NULL REFERENCES meetings(id),
  member_id    INT NOT NULL REFERENCES members(id),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(meeting_id, member_id)
);

CREATE TABLE availability (
  id          SERIAL PRIMARY KEY,
  meeting_id  INT NOT NULL REFERENCES meetings(id),
  member_id   INT NOT NULL REFERENCES members(id),
  range_start TIMESTAMPTZ NOT NULL,
  range_end   TIMESTAMPTZ NOT NULL,
  CHECK (range_end > range_start)
);

CREATE TABLE meeting_attendance (
  id           SERIAL PRIMARY KEY,
  meeting_id   INT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  member_id    INT NOT NULL REFERENCES members(id),
  rsvp_status  TEXT NOT NULL CHECK (rsvp_status IN ('attending','declined','tentative','no_response')) DEFAULT 'no_response',
  responded_at TIMESTAMPTZ,
  notes        TEXT,
  UNIQUE(meeting_id, member_id)
);

CREATE TABLE paper_suggestions (
  id            SERIAL PRIMARY KEY,
  meeting_id    INT NOT NULL REFERENCES meetings(id),
  paper_id      INT NOT NULL REFERENCES papers(id),
  suggested_by  INT REFERENCES members(id),
  source        TEXT NOT NULL CHECK (source IN ('member','agent','leader')),
  notes         TEXT,
  suggested_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(meeting_id, paper_id)
);

CREATE TABLE command_log (
  id      SERIAL PRIMARY KEY,
  ran_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  source  TEXT NOT NULL CHECK (source IN ('slash_command', 'scheduled_task')),
  name    TEXT NOT NULL,
  status  TEXT NOT NULL CHECK (status IN ('success', 'failure', 'no_action')),
  summary TEXT,
  error   TEXT
);

-- helpful indexes for common queries
CREATE INDEX idx_meetings_status_type ON meetings(status, type);
CREATE INDEX idx_meetings_scheduled_at ON meetings(scheduled_at);
CREATE INDEX idx_volunteers_meeting ON volunteers(meeting_id);
CREATE INDEX idx_availability_meeting ON availability(meeting_id);
CREATE INDEX idx_meeting_attendance_meeting ON meeting_attendance(meeting_id);
CREATE INDEX idx_paper_suggestions_meeting ON paper_suggestions(meeting_id);
CREATE INDEX idx_command_log_ran_at ON command_log(ran_at);

COMMIT;
```

- [ ] **Step 2: Verify schema validity (offline syntax check)**

Optional pre-flight if you have Postgres locally:
```bash
psql -d postgres -c "$(cat migrations/001_initial_schema.sql)"  # apply to a scratch DB
psql -d postgres -c "ROLLBACK;"  # undo if not committed
```

If you don't have Postgres locally, skip this step — Task 1.1 will run it against the real Supabase project and verify there.

- [ ] **Step 3: Commit**

```bash
git add migrations/001_initial_schema.sql
git commit -m "feat: initial Supabase schema (members, meetings, papers, etc.)"
```

---

### Task 0.3: Document Supabase + Drive + MCP setup prerequisites

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Append setup section to README**

Replace the "Quick start" section with:

```markdown
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
After running `/wids-bootstrap`, register the 7 scheduled task prompts (output by bootstrap) via the scheduled-tasks MCP. See `scheduled_tasks/README.md`.

## Running

Once prerequisites are met, run `/wids-bootstrap` in Claude Code from this directory.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: setup prerequisites for Supabase, Drive, MCPs"
```

---

## Phase 1 — Bootstrap command

### Task 1.1: Write `/wids-bootstrap` command

**Files:**
- Create: `.claude/commands/wids-bootstrap.md`

- [ ] **Step 1: Write the command file**

```markdown
---
description: One-time setup — verifies prerequisites, seeds members + topics, kicks off cycle 1
---

# /wids-bootstrap

This command walks the operator through one-time setup of the WiDS NYC AI reading group assistant. Run it once. After that, all other `/wids-*` commands assume bootstrap completed.

## Step-by-step

### Step 1 — Verify Supabase connection

Use the Supabase MCP to run:
```sql
SELECT count(*) FROM information_schema.tables
WHERE table_schema='public'
  AND table_name IN ('members','topics','papers','paper_topics','meetings',
                     'volunteers','availability','meeting_attendance',
                     'paper_suggestions','command_log');
```

The result must be `10`. If less, tell the operator to apply `migrations/001_initial_schema.sql` via the Supabase SQL Editor and re-run bootstrap.

### Step 2 — Verify schema is empty

Run:
```sql
SELECT count(*) FROM members;
```

If this returns > 0, halt with: "Bootstrap has already been run. Delete all rows manually if you want to re-bootstrap."

### Step 3 — Get Drive root folder

Ask the operator: "Paste the URL of your `WiDS NYC AI Reading Group` Drive folder."

Validate it looks like a Drive folder URL (`https://drive.google.com/drive/folders/...`). Store the folder ID for later. Do not write to DB yet — Drive folder URL is referenced by per-cycle records, not stored centrally in V1.

### Step 4 — Operator details

Ask: "What's your name and email? (You'll be the operator.)"

Insert the operator row:
```sql
INSERT INTO members (name, email, role, active)
VALUES ('<name>', '<email>', 'operator', true);
```

### Step 5 — Member import

Ask: "Paste members as CSV with columns `name,email,phone,whatsapp` (one per line, no header). Leave phone/whatsapp blank if not known. Send 'done' when finished."

Parse and INSERT each. Skip rows with empty name or email. Skip the operator's email (already inserted). Use UPSERT to avoid duplicates:
```sql
INSERT INTO members (name, email, phone, whatsapp, active, role)
VALUES (...) ON CONFLICT (email) DO NOTHING;
```

Confirm count: "Inserted N members. Plus you as operator. Total: M active members."

### Step 6 — Topic seeding

Display the curated ML genres list:

```
[ ] LLMs / Foundation Models
[ ] RAG / Retrieval
[ ] Agents / Tool Use
[ ] Diffusion / Generative Models
[ ] Reinforcement Learning
[ ] Multimodal Learning
[ ] Computer Vision
[ ] NLP (general)
[ ] Speech / Audio
[ ] Recommendation Systems
[ ] Time Series / Forecasting
[ ] Tabular / Classical ML
[ ] Causal Inference
[ ] Bayesian / Probabilistic Modeling
[ ] Theory / Learning Theory
[ ] Fairness / Ethics / Safety
[ ] Interpretability / Mech Interp
[ ] Evaluation / Benchmarks
[ ] Efficient ML / Quantization
[ ] Graph Neural Networks
[ ] Self-Supervised Learning
[ ] Healthcare / Medical AI
[ ] Robotics
[ ] Climate / Sustainability AI
```

Ask: "Reply with a comma-separated list of the topics you want to track. You can also add custom topics (e.g., 'Mechanistic Interpretability, Custom: Hawkes processes')."

INSERT each with weight=1:
```sql
INSERT INTO topics (name, weight) VALUES ('<topic>', 1)
ON CONFLICT (name) DO NOTHING;
```

### Step 7 — Output scheduled task registration instructions

Print:

```
Bootstrap complete!

Next: register the 7 scheduled background tasks. The prompts are in
`scheduled_tasks/`. For each, register it via the scheduled-tasks MCP
with daily cron and Supabase credentials available as env vars
(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).

  - cycle-keep-alive
  - form-response-chase
  - pre-meeting-reminder
  - meeting-auto-advance
  - leader-nudge
  - post-meeting-thanks
  - calendar-rsvp-sync

Once registered, you can also run `/wids-meeting-start admin` to kick
off cycle 1 manually.
```

### Step 8 — Audit log

```sql
INSERT INTO command_log (source, name, status, summary)
VALUES ('slash_command', '/wids-bootstrap', 'success',
        'Operator + N members + M topics seeded');
```

## Failure handling

Any SQL error → log to `command_log` with `status='failure'` and the error message; halt and surface error to operator. Do not partial-write.
```

- [ ] **Step 2: Manual verification plan**

Document this as the test plan in your head — to be exercised after Supabase + Drive prereqs are set up:
- Run `/wids-bootstrap` in a fresh Supabase project
- Verify exactly one operator row exists
- Verify members count matches CSV input
- Verify topics inserted match selection
- Verify `command_log` has the success row

(Actual exercise happens in Task 5.1's simulate-cycle test once that command exists. For now, just commit the prompt.)

- [ ] **Step 3: Commit**

```bash
git add .claude/commands/wids-bootstrap.md
git commit -m "feat: /wids-bootstrap command for one-time setup"
```

---

## Phase 2 — Meeting lifecycle commands

### Task 2.1: Write `/wids-status` (read-only dashboard, builds first so we can verify state in later tasks)

**Files:**
- Create: `.claude/commands/wids-status.md`

- [ ] **Step 1: Write the command file**

```markdown
---
description: Read-only dashboard of current cycle state
---

# /wids-status

Print a one-screen summary of where the current cycle stands. No writes.

## Step-by-step

### Step 1 — Find the active cycle

Run via Supabase MCP:
```sql
SELECT
  rg.id              AS reading_group_id,
  rg.scheduled_at    AS rg_scheduled,
  rg.status          AS rg_status,
  rg.location        AS rg_location,
  rg.paper_id,
  rg.leader_id,
  rg.packets_sent_at,
  rg.drive_folder_url,
  admin.id           AS admin_id,
  admin.scheduled_at AS admin_scheduled,
  admin.status       AS admin_status,
  admin.form_url     AS admin_form_url
FROM meetings rg
LEFT JOIN meetings admin ON admin.id = rg.planned_by_admin_id
WHERE rg.type = 'reading_group'
  AND rg.status IN ('prep','scheduled')
ORDER BY rg.created_at DESC
LIMIT 1;
```

If no rows: print "No active cycle. Run `/wids-meeting-start admin` to begin." and exit.

### Step 2 — Pull related data

For the active cycle:

```sql
-- volunteer count
SELECT count(*) FROM volunteers WHERE meeting_id = <rg_id>;

-- form response rates (admin form)
SELECT
  (SELECT count(DISTINCT member_id) FROM availability WHERE meeting_id = <admin_id>) AS responded,
  (SELECT count(*) FROM members WHERE active = true) AS total;

-- attendance rollup (if scheduled)
SELECT rsvp_status, count(*) FROM meeting_attendance
WHERE meeting_id IN (<admin_id>, <rg_id>)
GROUP BY rsvp_status;

-- paper info if picked
SELECT title, year, venue FROM papers WHERE id = <paper_id>;

-- leader info if picked
SELECT name FROM members WHERE id = <leader_id>;
```

### Step 3 — Render the dashboard

Format output as:

```
WiDS NYC AI Reading Group — current cycle status
─────────────────────────────────────────────────
Admin meeting (#<admin_id>):
  Status:           <admin_status>
  Scheduled:        <admin_scheduled or "TBD">
  Form responses:   <responded>/<total> members
  Volunteers:       <volunteer_count>

Reading group (#<rg_id>):
  Status:           <rg_status>
  Scheduled:        <rg_scheduled or "TBD">
  Location:         <rg_location or "TBD">
  Leader:           <leader_name or "not yet picked">
  Paper:            "<paper_title>" (<year>, <venue>) or "not yet picked"
  Members' packet:  <"sent <packets_sent_at>" or "not yet drafted">

Attendance: <attending=N declined=N tentative=N no_response=N>

Next action:
  <inferred from status — see below>
```

### Step 4 — Infer next action

Logic:
- If `admin_status='prep'` AND no `admin_form_url`: "Run `/wids-meeting-start admin`"
- If `admin_status='prep'` AND form exists: "Wait for form responses. `/wids-schedule-admin` when ready."
- If `admin_status='scheduled'` AND `admin_scheduled` in future: "Admin meeting on <date>. Then run `/wids-pick-leader`."
- If `admin_status='done'` AND `rg.leader_id IS NULL`: "Run `/wids-pick-leader`."
- If `rg.leader_id` set AND `rg.paper_id IS NULL`: "Leader: run `/wids-find-paper`."
- If `rg.paper_id` set AND `rg.scheduled_at IS NULL`: "Run `/wids-meeting-start reading_group` then `/wids-schedule-reading-group`."
- If `rg.scheduled_at` set AND no guide PDFs in Drive: "Leader: run `/wids-make-guide`."
- If guide PDFs exist AND `packets_sent_at IS NULL`: "Leader: run `/wids-send-packets`."
- Otherwise: "Reading group on <date>. See you there."

### Step 5 — Audit log
```sql
INSERT INTO command_log (source, name, status, summary)
VALUES ('slash_command', '/wids-status', 'success', 'Dashboard rendered');
```
```

- [ ] **Step 2: Commit**

```bash
git add .claude/commands/wids-status.md
git commit -m "feat: /wids-status read-only dashboard"
```

---

### Task 2.2: Write `/wids-meeting-start` command

**Files:**
- Create: `.claude/commands/wids-meeting-start.md`

- [ ] **Step 1: Write the command file**

```markdown
---
description: Open planning for a new admin or reading_group meeting (alternation rule if no arg)
argument-hint: [admin|reading_group]
---

# /wids-meeting-start [type]

Opens planning for a new meeting. With no arg, picks the opposite of the last completed meeting.

## Argument resolution

If `$1` is `admin` or `reading_group`, use it.

If `$1` is missing:
```sql
SELECT type FROM meetings WHERE status='done' ORDER BY scheduled_at DESC LIMIT 1;
```
- Result `reading_group` → use `admin`
- Result `admin` → use `reading_group`
- Empty result → use `admin` (kickoff)

## Branch: type='admin'

### Step A1 — Insert meeting rows

Both admin and reading_group are created in a single transaction:

```sql
BEGIN;
INSERT INTO meetings (type, status)
VALUES ('admin', 'prep')
RETURNING id;
-- capture admin_id

INSERT INTO meetings (type, status, planned_by_admin_id)
VALUES ('reading_group', 'prep', <admin_id>);
COMMIT;
```

### Step A2 — Generate the Form questions

Output to operator (V1 has the operator manually create the Google Form — auto-creation via Forms API is V2):

```
Create a Google Form with these questions:

1. Your name (short answer, required) — must match members table
2. Your email (short answer, required)
3. Availability for next ADMIN meeting (date-time picker, multi-select, required):
   List ~6 candidate evening slots in the next 2 weeks (e.g. Tue/Wed/Thu 6:30-8:00 PM ET).
4. Far-out availability hint for the next READING GROUP (~6 weeks away) (date picker, multi-select, optional):
   List ~6 weekend or evening slots ~5-7 weeks out.
5. Will you volunteer to lead the next reading group? (Yes/No, required)
6. Suggest a paper for next reading group (optional, paragraph) — title + arXiv URL if you have one.

Once created, paste the Form URL.
```

### Step A3 — Store form URL

```sql
UPDATE meetings SET form_url = '<pasted_url>' WHERE id = <admin_id>;
```

### Step A4 — Email the form to active members

Use Gmail MCP. Recipients: `SELECT email FROM members WHERE active=true`. Subject: "WiDS NYC AI Reading Group — next-cycle planning form (please fill by <today + 7 days>)". Body: brief intro + form URL + close-by date.

### Step A5 — Audit log

```sql
INSERT INTO command_log (source, name, status, summary)
VALUES ('slash_command', '/wids-meeting-start',
        'success',
        'Started admin cycle: admin=<admin_id>, reading_group=<rg_id>, form sent to N members');
```

## Branch: type='reading_group'

### Step R1 — Find the existing reading_group row

```sql
SELECT m.id, m.leader_id, m.paper_id
FROM meetings m
WHERE m.type='reading_group' AND m.status='prep'
ORDER BY m.created_at DESC LIMIT 1;
```

If no row found, halt: "No reading_group in prep status. Run `/wids-meeting-start admin` first." If `leader_id IS NULL` or `paper_id IS NULL`, halt: "Reading group has no leader/paper yet. Run `/wids-pick-leader` and `/wids-find-paper` before scheduling."

### Step R2 — Generate the Form questions

```
Create a Google Form with these questions:

1. Your name (short answer, required)
2. Your email (short answer, required)
3. Final availability for the upcoming READING GROUP (date-time picker, multi-select, required):
   List the candidate windows from the admin meeting's discussion.
4. Venue suggestions (paragraph, optional) — coffee shops, lounges, etc.

Once created, paste the Form URL.
```

### Step R3 — Store form URL on reading_group row

```sql
UPDATE meetings SET form_url = '<pasted_url>' WHERE id = <rg_id>;
```

### Step R4 — Email form to active members

Same as A4 but with subject "WiDS NYC AI Reading Group — final scheduling for <month> reading group".

### Step R5 — Audit log

```sql
INSERT INTO command_log (source, name, status, summary)
VALUES ('slash_command', '/wids-meeting-start',
        'success',
        'Started reading_group scheduling: rg=<rg_id>, form sent to N members');
```

## Failure handling

If transaction in step A1 fails or no admin meeting exists for branch R: log failure and halt cleanly.
```

- [ ] **Step 2: Commit**

```bash
git add .claude/commands/wids-meeting-start.md
git commit -m "feat: /wids-meeting-start with type alternation rule"
```

---

### Task 2.3: Write `/wids-schedule-admin` command

**Files:**
- Create: `.claude/commands/wids-schedule-admin.md`

- [ ] **Step 1: Write the command file**

```markdown
---
description: Pick admin meeting date from collected availability, confirm with operator, book Calendar event
---

# /wids-schedule-admin

Two-phase: compute → present → confirm → book.

## Step 1 — Find the admin meeting

```sql
SELECT id FROM meetings
WHERE type='admin' AND status='prep' AND form_url IS NOT NULL
ORDER BY created_at DESC LIMIT 1;
```

If no row, halt: "No admin meeting in prep with a form_url. Run `/wids-meeting-start admin` first."

## Step 2 — Compute the best window

Read availability rows:
```sql
SELECT a.member_id, a.range_start, a.range_end
FROM availability a
WHERE a.meeting_id = <admin_id>;
```

Compute the highest-overlap window:
- For each pair (range_start, range_end) appearing in the data, treat it as a candidate fixed slot of `range_start + 90 minutes` (default admin meeting duration).
- For each candidate slot, count how many distinct member_ids have availability fully covering it.
- Rank by count descending, then by earliness ascending.

In SQL (single query):
```sql
WITH slots AS (
  SELECT DISTINCT range_start AS slot_start,
                  range_start + interval '90 minutes' AS slot_end
  FROM availability WHERE meeting_id = <admin_id>
),
overlaps AS (
  SELECT s.slot_start, s.slot_end,
         count(DISTINCT a.member_id) AS members_available
  FROM slots s
  LEFT JOIN availability a
    ON a.meeting_id = <admin_id>
   AND a.range_start <= s.slot_start
   AND a.range_end   >= s.slot_end
  GROUP BY s.slot_start, s.slot_end
)
SELECT slot_start, slot_end, members_available
FROM overlaps
ORDER BY members_available DESC, slot_start ASC
LIMIT 5;
```

## Step 3 — Present to operator

Show top window + total active members:
```sql
SELECT count(*) FROM members WHERE active=true;  -- total
```

Format:
```
Best window for admin meeting:
  <slot_start> to <slot_end> ET
  <members_available>/<total> active members can attend

Members who can't make it:
  <names of members WITHOUT covering availability>

Reply:
  'go'   to book this slot
  'next' to see the runner-up window
  'skip' to abort
```

If 'next', advance through ranked list.

## Step 4 — On 'go': create Calendar event

Use Calendar MCP to create event:
- Title: "WiDS NYC Reading Group — Admin Meeting"
- Description: "Planning for the next reading group. Form URL: <form_url>"
- Start: slot_start, End: slot_end
- Conferencing: Google Meet (auto-generated)
- Attendees: all active members' emails
- Send invitations: yes

Capture the event ID and Meet link.

## Step 5 — Update DB

```sql
UPDATE meetings
SET scheduled_at = <slot_start>,
    location = 'Online (Meet link in calendar invite)',
    status = 'scheduled'
WHERE id = <admin_id>;

INSERT INTO meeting_attendance (meeting_id, member_id, rsvp_status)
SELECT <admin_id>, id, 'no_response' FROM members WHERE active=true
ON CONFLICT (meeting_id, member_id) DO NOTHING;
```

## Step 6 — Audit log

```sql
INSERT INTO command_log (source, name, status, summary)
VALUES ('slash_command', '/wids-schedule-admin', 'success',
        'Scheduled admin <admin_id> at <slot_start>; <members_available>/<total> attending');
```

## Failure handling

- No availability rows → halt: "No availability collected yet. After members fill out the form, run `/wids-process-form <admin_id>` to ingest responses, then re-run this."
- Calendar event creation fails → no DB update; log failure with the error message.
```

- [ ] **Step 2: Commit**

```bash
git add .claude/commands/wids-schedule-admin.md
git commit -m "feat: /wids-schedule-admin with two-phase confirm gate"
```

---

### Task 2.4: Write `/wids-schedule-reading-group` command

**Files:**
- Create: `.claude/commands/wids-schedule-reading-group.md`

- [ ] **Step 1: Write the command file**

```markdown
---
description: Pick reading_group meeting date from availability, prompt for venue, book Calendar event
---

# /wids-schedule-reading-group

Mirrors `/wids-schedule-admin` but with a venue prompt because reading groups are in-person.

## Step 1 — Find the reading_group meeting

```sql
SELECT id, leader_id, paper_id FROM meetings
WHERE type='reading_group' AND status='prep' AND form_url IS NOT NULL
ORDER BY created_at DESC LIMIT 1;
```

If no row: halt: "No reading_group in prep with form_url. Run `/wids-meeting-start reading_group`."

If `leader_id IS NULL` or `paper_id IS NULL`: halt: "Pick leader and paper first."

## Step 2 — Compute best window

Same query as `/wids-schedule-admin` Step 2 but with 90-minute slots and target meeting_id = <rg_id>. Default duration: 90 minutes (configurable per group).

## Step 3 — Present to operator

```
Best window for reading group:
  <slot_start> to <slot_end> ET
  <members_available>/<total> active members can attend

Members who can't make it:
  <names>

Reply 'go', 'next', or 'skip'.
```

## Step 4 — On 'go': prompt for venue

Prompt: "What venue? (e.g., 'Think Coffee, 4th Ave & 11th St'). Used in the Calendar invite and reminder emails."

Operator pastes venue text.

## Step 5 — Create Calendar event

Use Calendar MCP:
- Title: "WiDS NYC Reading Group — <paper_title (truncated)>"
- Description: "Paper: <paper_title>\nLeader: <leader_name>\nVenue: <venue>\nMembers' packet: <drive_url_for_members_packet (if exists)>"
- Start: slot_start, End: slot_end
- Location: <venue text>
- Attendees: all active members' emails
- Send invitations: yes

## Step 6 — Update DB

```sql
UPDATE meetings
SET scheduled_at = <slot_start>,
    location = '<venue>',
    status = 'scheduled'
WHERE id = <rg_id>;

INSERT INTO meeting_attendance (meeting_id, member_id, rsvp_status)
SELECT <rg_id>, id, 'no_response' FROM members WHERE active=true
ON CONFLICT (meeting_id, member_id) DO NOTHING;
```

## Step 7 — Audit log

```sql
INSERT INTO command_log (source, name, status, summary)
VALUES ('slash_command', '/wids-schedule-reading-group', 'success',
        'Scheduled reading_group <rg_id> at <slot_start> at <venue>');
```

## Failure handling

- No availability rows → halt: "No availability collected yet. After members fill out the form, run `/wids-process-form <rg_id>` to ingest responses, then re-run this."
- Calendar event creation fails → no DB update; log failure with the error message.
```

- [ ] **Step 2: Commit**

```bash
git add .claude/commands/wids-schedule-reading-group.md
git commit -m "feat: /wids-schedule-reading-group with venue prompt"
```

---

### Task 2.5: Write `/wids-pick-leader` command

**Files:**
- Create: `.claude/commands/wids-pick-leader.md`

- [ ] **Step 1: Write the command file**

```markdown
---
description: Pick next reading_group leader via longest-gap algorithm with random tie-break; operator confirms
argument-hint: [pick <member_id>]
---

# /wids-pick-leader [pick <member_id>]

Two phases: present pick → confirm or override.

## Step 1 — Find the upcoming reading_group

```sql
SELECT id FROM meetings
WHERE type='reading_group' AND status='prep' AND leader_id IS NULL
ORDER BY created_at DESC LIMIT 1;
```

If no row: halt: "No reading_group needing a leader. Run `/wids-meeting-start admin` first."

## Step 2 — Run longest-gap algorithm

```sql
WITH last_led AS (
  SELECT m.leader_id AS member_id,
         MAX(m.scheduled_at) AS last_led_at
  FROM meetings m
  WHERE m.type='reading_group' AND m.status='done' AND m.leader_id IS NOT NULL
  GROUP BY m.leader_id
),
eligible AS (
  SELECT v.member_id,
         mem.name,
         COALESCE(ll.last_led_at, '1970-01-01'::timestamptz) AS last_led_at
  FROM volunteers v
  JOIN members mem ON mem.id = v.member_id AND mem.active = true
  LEFT JOIN last_led ll ON ll.member_id = v.member_id
  WHERE v.meeting_id = <rg_id>
),
ranked AS (
  SELECT member_id, name, last_led_at,
         RANK() OVER (ORDER BY last_led_at ASC) AS rnk
  FROM eligible
)
SELECT member_id, name, last_led_at, rnk FROM ranked ORDER BY rnk, random();
```

If empty: halt: "No volunteers for this reading group. Either send the form again or assign manually."

## Step 3 — Pick the winner

The first row of the ranked result (rnk=1) is the algorithmic winner. If multiple rows have rnk=1 (ties), the `ORDER BY random()` already gave one specific tie-broken winner.

## Step 4 — Argument handling

If invoked as `/wids-pick-leader pick <id>`: that's a direct override. Skip presentation, go to step 6 with that member_id.

Otherwise (no args): proceed to step 5 (present + confirm).

## Step 5 — Present pick with reasoning

```
Recommended leader: <winner.name> (member_id=<winner.member_id>)
Reason:
  - <"Never led" if last_led_at = 1970-01-01 else "Last led on <date> (<X> months ago)">
  - <"Tied with: <other tied names>; randomly picked from ties" if applicable>

Other eligible volunteers:
  <for each row with rnk > 1: name (id=<id>) — last led <date or "never">>

Reply:
  'confirm'                — lock in <winner.name>
  'pick <member_id>'       — override with someone else
  'skip'                   — abort
```

Wait for response.

## Step 6 — On confirm or pick: update DB and announce

```sql
UPDATE meetings SET leader_id = <chosen_id> WHERE id = <rg_id>;
```

Generate the announcement text:
```
🎉 The next reading group will be led by <chosen_name>!

Date: <rg.scheduled_at if known else "TBD — see admin meeting outcome">
Paper: <papers.title if known else "TBD — leader will pick">

@<chosen_name> — when you're ready, run `/wids-find-paper` to start
hunting for a paper, then `/wids-make-guide` ~2 weeks before the meeting.
```

Output: "WhatsApp announcement (copy and paste into the group chat):\n\n<announcement>"

## Step 7 — Audit log

```sql
INSERT INTO command_log (source, name, status, summary)
VALUES ('slash_command', '/wids-pick-leader', 'success',
        'Picked leader=<chosen_id> for reading_group=<rg_id>; <action>');
-- action = 'algorithm pick confirmed' or 'override to <name>'
```

## Failure handling

- No volunteers → halt as above.
- DB update fails → log failure, no announcement.
```

- [ ] **Step 2: Commit**

```bash
git add .claude/commands/wids-pick-leader.md
git commit -m "feat: /wids-pick-leader with longest-gap + random tie-break"
```

---

## Phase 3 — Paper and guide commands

### Task 3.1: Write `/wids-find-paper` command

**Files:**
- Create: `.claude/commands/wids-find-paper.md`

- [ ] **Step 1: Write the command file**

```markdown
---
description: Research assistant for the leader to search arXiv or compare candidate papers
argument-hint: search "<query>" | compare <url1> <url2> ... | pick <suggestion_id>
---

# /wids-find-paper

Three sub-modes: `search`, `compare`, `pick`.

## Step 1 — Find the active reading_group

```sql
SELECT id, leader_id FROM meetings
WHERE type='reading_group' AND status='prep' AND leader_id IS NOT NULL
ORDER BY created_at DESC LIMIT 1;
```

If no row: halt: "No reading_group with a leader yet. Run `/wids-pick-leader` first."

## Step 2 — Sub-mode: search

Invocation: `/wids-find-paper search "RAG evaluation"`

### 2a — Read group topics for search bias
```sql
SELECT name FROM topics ORDER BY weight DESC;
```

### 2b — Search arXiv via WebFetch
Construct an arXiv search URL like:
`https://arxiv.org/search/?searchtype=all&query=<encoded_query>&start=0`

Optionally bias with topic names: e.g., `"<query> <topic1> OR <topic2>"`.

WebFetch the search result page. Parse out the top 5 papers (title, authors, abstract, arXiv ID, year).

### 2c — Insert candidates into papers + paper_suggestions

For each candidate:
```sql
INSERT INTO papers (title, url, abstract, authors, venue, year)
VALUES (<title>, <arxiv_url>, <abstract>, ARRAY[<authors>], 'arXiv', <year>)
RETURNING id;
-- capture paper_id

INSERT INTO paper_suggestions (meeting_id, paper_id, suggested_by, source, notes)
VALUES (<rg_id>, <paper_id>, NULL, 'agent', '<background_assessment>');
```

### 2d — Generate background-level assessment

For each candidate, write a 2-3 sentence assessment as the `notes` field. Example:
"Background needed: comfort with variational inference, basics of diffusion models, intro-level information theory. Would feel rough for members new to generative modeling. Accessibility: medium."

(This can be done by a quick Claude analysis of the abstract — no separate skill required.)

### 2e — Present to leader

```
Found <N> candidates:

[#<sugg_id>] <title> (<year>, <venue>)
  Authors: <authors>
  Abstract: <truncated abstract>
  Background needed: <notes>

[#<sugg_id>] ...

Pick one with: `/wids-find-paper pick <suggestion_id>`
Or run again with a refined query.
```

## Step 3 — Sub-mode: compare

Invocation: `/wids-find-paper compare <url1> <url2> ...`

### 3a — Fetch each URL via WebFetch
Extract title, authors, abstract, year, venue.

### 3b — Insert into papers + paper_suggestions (source='leader')
Same as 2c but `source='leader'` and `suggested_by=<leader_id>`.

### 3c — Generate background assessments and side-by-side
Render comparison table:
```
                            Paper A          Paper B          Paper C
Title                       ...              ...              ...
Year/Venue                  ...              ...              ...
Background needed           ...              ...              ...
Discussion potential        ...              ...              ...
```

Then list each as suggestion: "Pick with: `/wids-find-paper pick <id>`"

## Step 4 — Sub-mode: pick

Invocation: `/wids-find-paper pick <suggestion_id>`

### 4a — Validate
```sql
SELECT s.id, s.paper_id, p.title, p.url
FROM paper_suggestions s
JOIN papers p ON p.id = s.paper_id
WHERE s.id = <suggestion_id> AND s.meeting_id = <rg_id>;
```

If no row: halt: "Invalid suggestion ID for this reading group."

### 4b — Update reading_group with chosen paper
```sql
UPDATE meetings SET paper_id = <paper_id> WHERE id = <rg_id>;
```

### 4c — Download paper PDF to Drive

If `papers.url` looks like an arXiv URL, derive the PDF URL (e.g., `https://arxiv.org/abs/2308.07037` → `https://arxiv.org/pdf/2308.07037.pdf`).

Use the Drive MCP to:
1. Create the cycle subfolder if not yet existing: `WiDS NYC AI Reading Group/cycles/<YYYY-MM>-meeting/`
2. Download the PDF (WebFetch the PDF URL) and upload to the cycle subfolder as `paper.pdf`
3. Capture the Drive URL of the uploaded PDF

### 4d — Update papers and meetings

```sql
UPDATE papers SET pdf_drive_url = <drive_url> WHERE id = <paper_id>;
UPDATE meetings SET drive_folder_url = <cycle_folder_url> WHERE id = <rg_id>;
```

### 4e — Audit log
```sql
INSERT INTO command_log (source, name, status, summary)
VALUES ('slash_command', '/wids-find-paper', 'success',
        'Picked paper "<title>" for reading_group <rg_id>');
```

## Failure handling

- arXiv search returns nothing → "No results for query. Try a different phrasing."
- WebFetch on a URL fails (paywall, 404) → skip that one in compare mode; abort search if all fail.
- PDF download fails → set `paper_id` but leave `pdf_drive_url` NULL; warn leader to upload manually.
```

- [ ] **Step 2: Commit**

```bash
git add .claude/commands/wids-find-paper.md
git commit -m "feat: /wids-find-paper with search/compare/pick modes"
```

---

### Task 3.2: Write `/wids-make-guide` command (subagent dispatch)

**Files:**
- Create: `.claude/commands/wids-make-guide.md`

- [ ] **Step 1: Write the command file**

```markdown
---
description: Generate members' packet + leader's packet via 3-stage subagent dispatch
---

# /wids-make-guide

Three stages: stage 1 produces members' packet (single agent), stage 2 fans out N+1 subagents for leader extras, stage 3 merges and renders both PDFs.

## Step 0 — Find the active reading_group

```sql
SELECT m.id AS rg_id, m.paper_id, m.drive_folder_url, m.leader_id,
       p.title, p.pdf_drive_url, p.url
FROM meetings m
JOIN papers p ON p.id = m.paper_id
WHERE m.type='reading_group' AND m.status='prep' AND m.paper_id IS NOT NULL
ORDER BY m.created_at DESC LIMIT 1;
```

If no row: halt: "No reading_group with a paper yet. Run `/wids-find-paper pick <id>` first."

If `pdf_drive_url IS NULL`: halt: "Paper PDF not downloaded. Re-run `/wids-find-paper pick <id>`."

## Step 1 — Members' packet (single agent)

Invoke the operator's custom **`reading-group-guide`** skill on the paper PDF.

Pass to the skill:
- Paper PDF (download from `pdf_drive_url` to a temp local path via Drive MCP, or pass the URL if the skill accepts URLs)
- Output target: structured content (paper summary, section breakdown, key figures, background-level assessment, discussion questions list)

Capture the skill's output. The output MUST include a structured list of discussion questions — without it, stage 2 cannot proceed.

### Failure path
If the skill errors or its output lacks discussion questions:
```sql
UPDATE meetings SET status='guide_failed' WHERE id=<rg_id>;
INSERT INTO command_log (source, name, status, error)
VALUES ('slash_command', '/wids-make-guide', 'failure', '<error>');
```
Halt. Print the error to leader. **No automatic retry.** Leader investigates and re-runs manually when ready.

## Step 2 — Leader extras (parallel subagent dispatch)

Once stage 1 succeeded, fire concurrent subagents via the Agent tool. Use a single message with multiple Agent tool calls so they run in parallel.

### 2a — One timed-agenda subagent

```
subagent_type: general-purpose
description: Build minute-by-minute reading group agenda
prompt: |
  Build a 90-minute reading group agenda for the paper "<title>".
  Use these discussion questions (in order):
  <list>

  Output a minute-by-minute schedule with these sections:
  - 0-5 min: Welcome
  - 5-15 min: Paper context & background
  - 15-X min: Question-by-question discussion (allocate time based on depth)
  - Last 10 min: Wrap-up + connections to other work + next-meeting tease

  Format as a markdown table with columns: Time | Section | What happens.
  Be concrete about what the leader does in each block.
```

### 2b — N per-question facilitation-notes subagents

For each discussion question (cap at 10; if >10, run remaining sequentially after the first 10 finish):

```
subagent_type: general-purpose
description: Facilitation notes for one question
prompt: |
  You're helping a reading group leader prepare to discuss this paper:

  Title: <title>
  Abstract: <abstract>

  Specific question to facilitate:
  "<question_text>"

  Generate facilitation notes covering:
  1. Typical conversation paths (2-3 directions members usually take)
  2. Prompts to deepen the discussion (concrete follow-up questions)
  3. Common misconceptions to surface or correct
  4. When to redirect (signs the discussion has stalled or drifted)
  5. Estimated time to spend (in minutes)

  Output as markdown with these 5 subsections. Be specific and practical.
```

### 2c — Failure handling for stage 2

If any per-question subagent fails (timeout, error), don't halt. Substitute the failed question's section with a stub: "[facilitation notes generation failed — improvise]". Stage 3 continues with whatever succeeded.

If the timed-agenda subagent fails, replace it with a generic 90-min skeleton:
```
0-5: Welcome
5-15: Paper context
15-75: Discussion questions (~10 min per question)
75-85: Wrap-up
85-90: Next-meeting tease
```

## Step 3 — Merge and render

### 3a — Members' packet PDF

Use the Anthropic `pdf` skill (or your custom `reading-group-guide` skill if it returns PDF directly) to render the stage 1 output as `members-packet.pdf`. Layout sections:

1. Paper title, authors, venue, year (cover)
2. Paper summary
3. Section-by-section breakdown
4. Background-level assessment
5. Discussion questions (numbered)
6. Key figures reference table

### 3b — Leader's packet PDF

Render `leaders-packet.pdf` with all of (3a) plus:

1. Timed agenda (after section 1, before paper summary) — output of the timed-agenda subagent
2. Facilitation notes interleaved after each discussion question — outputs of the per-question subagents

### 3c — Upload to Drive

Use Drive MCP to upload both PDFs to the reading_group's cycle subfolder:
- `cycles/<YYYY-MM>-meeting/members-packet.pdf`
- `cycles/<YYYY-MM>-meeting/leaders-packet.pdf`

(The subfolder was created in `/wids-find-paper pick`.)

## Step 4 — Audit log

```sql
INSERT INTO command_log (source, name, status, summary)
VALUES ('slash_command', '/wids-make-guide', 'success',
        'Generated guides for reading_group=<rg_id>; members + leaders packets in <drive_folder_url>');
```

## Step 5 — Notify leader

```
Both packets generated:
  Members' packet: <drive_url>/members-packet.pdf
  Leader's packet: <drive_url>/leaders-packet.pdf

Review the leader's packet first (timed agenda + facilitation notes are
your prep material). When ready, run `/wids-send-packets` to send the
members' packet to the group.
```
```

- [ ] **Step 2: Commit**

```bash
git add .claude/commands/wids-make-guide.md
git commit -m "feat: /wids-make-guide with 3-stage subagent dispatch"
```

---

### Task 3.3: Write `/wids-send-packets` command

**Files:**
- Create: `.claude/commands/wids-send-packets.md`

- [ ] **Step 1: Write the command file**

```markdown
---
description: Create a Gmail draft addressed to active members with members-packet.pdf attached
---

# /wids-send-packets

Run by the leader after `/wids-make-guide`. Creates a Gmail draft for the leader to personalize and send.

## Step 1 — Find active reading_group with packets ready

```sql
SELECT m.id, m.scheduled_at, m.location, m.drive_folder_url,
       p.title, p.url, leader.name AS leader_name, leader.email AS leader_email
FROM meetings m
JOIN papers p ON p.id = m.paper_id
JOIN members leader ON leader.id = m.leader_id
WHERE m.type='reading_group' AND m.status='scheduled' AND m.packets_sent_at IS NULL
ORDER BY m.created_at DESC LIMIT 1;
```

If no row: halt: "No reading group ready for packet send. Make sure `/wids-schedule-reading-group` and `/wids-make-guide` have run."

## Step 2 — Verify members-packet.pdf exists in Drive

Use Drive MCP to look for `<drive_folder_url>/members-packet.pdf`. If not found, halt: "members-packet.pdf not found. Re-run `/wids-make-guide`."

## Step 3 — Pull recipient list

```sql
SELECT email FROM members WHERE active=true;
```

## Step 4 — Compose draft email

Subject: `WiDS NYC Reading Group — <month_year> meeting prep`

Body (template; leader can edit):
```
Hi everyone,

Looking forward to our next reading group on <scheduled_at_pretty> at <location>.

This month's paper:
  "<title>"
  <url>

Attached is the discussion guide. Please skim it before we meet. Don't worry
about understanding every detail — the guide flags what's worth focusing on.

See you there,
<leader_name>
```

## Step 5 — Create Gmail draft

Use Gmail MCP `create_draft` with:
- To: comma-separated recipient list
- Subject: as above
- Body: as above
- Attachment: members-packet.pdf (downloaded from Drive to a temp local path)

Capture the draft ID.

## Step 6 — Notify leader

```
Draft created in Gmail:
  Subject: <subject>
  To: <N> recipients
  Attachment: members-packet.pdf

Open Gmail, review the draft, personalize as desired, and send.
When you've sent it, reply 'sent' here.
```

## Step 7 — On 'sent' reply: update DB

```sql
UPDATE meetings SET packets_sent_at = now() WHERE id = <rg_id>;
INSERT INTO command_log (source, name, status, summary)
VALUES ('slash_command', '/wids-send-packets', 'success',
        'Packet draft created for reading_group=<rg_id>; leader confirmed sent');
```

If leader replies anything other than 'sent' (e.g., 'cancelled'): log as `no_action` and don't update `packets_sent_at`.

## Failure handling

- Gmail draft creation fails → log failure, instruct leader to email manually.
```

- [ ] **Step 2: Commit**

```bash
git add .claude/commands/wids-send-packets.md
git commit -m "feat: /wids-send-packets with Gmail draft creation"
```

---

## Phase 4 — Scheduled background tasks

Each scheduled task is a self-contained markdown prompt registered with the scheduled-tasks MCP. They have their own Supabase/Gmail/Calendar credentials configured at registration time. They run daily by default.

### Task 4.1: Write `cycle-keep-alive` task

**Files:**
- Create: `scheduled_tasks/cycle-keep-alive.md`

- [ ] **Step 1: Write the task file**

```markdown
---
schedule: daily
description: Detect cycles that have stalled and email operator to suggest restart
---

# scheduled_tasks/cycle-keep-alive

Runs daily. Notifies operator if no cycle has been started in 28+ days.

## Step 1 — Check most recent reading_group

```sql
SELECT MAX(scheduled_at) AS last_rg
FROM meetings
WHERE type='reading_group' AND status='done';
```

## Step 2 — Check for in-progress cycle

```sql
SELECT count(*) FROM meetings
WHERE status IN ('prep','scheduled') AND type IN ('admin','reading_group');
```

## Step 3 — Decide

- If `last_rg` is NULL (no completed reading group ever) AND no in-progress cycle:
  - This is the kickoff state. Don't nag — bootstrap should have started cycle 1.
  - Log `no_action`. Exit.
- If `last_rg` >= 28 days ago AND no in-progress cycle:
  - Send email. (Step 4.)
- Otherwise:
  - Log `no_action`. Exit.

## Step 4 — Send nudge email

Recipient: operator (`SELECT email FROM members WHERE role='operator'`)

Subject: "WiDS NYC: time to start the next cycle?"

Body:
```
Hi <operator_name>,

It's been 28+ days since the last reading group on <last_rg date>. No new
cycle is in progress.

If you'd like to start the next one, run `/wids-meeting-start admin` in
Claude Code. Or just reply 'snooze' here and I'll wait another week.
```

## Step 5 — Log

```sql
INSERT INTO command_log (source, name, status, summary)
VALUES ('scheduled_task', 'cycle-keep-alive', 'success', 'Sent nudge to operator');
```

## Idempotency

Tracks last sent timestamp by querying:
```sql
SELECT MAX(ran_at) FROM command_log
WHERE name='cycle-keep-alive' AND status='success' AND summary LIKE '%Sent nudge%';
```
If last successful nudge was <7 days ago, skip (don't re-spam). Log `no_action`.
```

- [ ] **Step 2: Commit**

```bash
git add scheduled_tasks/cycle-keep-alive.md
git commit -m "feat: cycle-keep-alive scheduled task"
```

---

### Task 4.2: Write `form-response-chase` task

**Files:**
- Create: `scheduled_tasks/form-response-chase.md`

- [ ] **Step 1: Write the task file**

```markdown
---
schedule: daily
description: Detect low-response forms and email operator (operator-first, no auto-send to members)
---

# scheduled_tasks/form-response-chase

Runs daily. For any meeting in `status='prep'` with a form_url, computes response rate; if low, alerts the operator.

## Step 1 — Find prep meetings with forms

```sql
SELECT m.id, m.type, m.form_url, m.created_at,
       (SELECT count(DISTINCT a.member_id) FROM availability a WHERE a.meeting_id = m.id) AS responded,
       (SELECT count(*) FROM members WHERE active=true) AS total
FROM meetings m
WHERE m.status='prep'
  AND m.form_url IS NOT NULL
  AND m.created_at < now() - interval '7 days';
```

## Step 2 — For each row, decide

For each meeting:
- response_rate = responded / total
- If response_rate < 0.5 AND last alert email for this meeting was sent >5 days ago (or never):
  - Send alert. (Step 3.)
- Otherwise: skip.

(Idempotency: query `command_log` for prior alerts on this meeting:)
```sql
SELECT MAX(ran_at) FROM command_log
WHERE name='form-response-chase' AND status='success' AND summary LIKE '%meeting=<id>%';
```

## Step 3 — Send alert email

Recipient: operator.

Subject: `WiDS NYC: form for <meeting_type> meeting at <responded>/<total> responses`

Body:
```
The form for <meeting_type> meeting #<id> has been out <days> days.
Response rate: <responded>/<total> active members.

Non-responders:
  <names of active members WITHOUT availability rows for this meeting>

Form URL: <form_url>

Reply:
  'remind'  — I'll email non-responders directly
  'wait'    — leave as-is for now

If you reply 'remind', I'll send a brief reminder to non-responders only.
(Currently V1 — auto-send to members is gated.)
```

(Note: auto-sending the reminder requires a follow-up step where the operator's reply is processed. For V1, the operator can manually run a future `/wids-remind-form` command. If that command doesn't exist yet, just suggest manual email and don't promise auto-action.)

## Step 4 — Log

```sql
INSERT INTO command_log (source, name, status, summary)
VALUES ('scheduled_task', 'form-response-chase', 'success',
        'Sent low-response alert to operator for meeting=<id>: <responded>/<total>');
```
```

- [ ] **Step 2: Commit**

```bash
git add scheduled_tasks/form-response-chase.md
git commit -m "feat: form-response-chase scheduled task (operator-first)"
```

---

### Task 4.3: Write `pre-meeting-reminder` task

**Files:**
- Create: `scheduled_tasks/pre-meeting-reminder.md`

- [ ] **Step 1: Write the task file**

```markdown
---
schedule: daily
description: Email logistics reminder to active members 2 days before any scheduled meeting
---

# scheduled_tasks/pre-meeting-reminder

Runs daily. For any meeting `status='scheduled'` with `scheduled_at` 2 days out, emails active members the logistics.

## Step 1 — Find meetings 2 days out

```sql
SELECT m.id, m.type, m.scheduled_at, m.location, m.paper_id,
       p.title AS paper_title,
       leader.name AS leader_name
FROM meetings m
LEFT JOIN papers p ON p.id = m.paper_id
LEFT JOIN members leader ON leader.id = m.leader_id
WHERE m.status='scheduled'
  AND m.scheduled_at >= now() + interval '2 days'
  AND m.scheduled_at <  now() + interval '3 days';
```

## Step 2 — Check idempotency

For each meeting, check if reminder already sent:
```sql
SELECT count(*) FROM command_log
WHERE name='pre-meeting-reminder'
  AND summary LIKE '%meeting=<id>%'
  AND status='success';
```
If > 0, skip.

## Step 3 — Build recipient list (only no_response RSVPs)

```sql
SELECT mem.email, mem.name
FROM meeting_attendance ma
JOIN members mem ON mem.id = ma.member_id
WHERE ma.meeting_id = <id> AND ma.rsvp_status='no_response' AND mem.active=true;
```

(Members who already RSVP'd attending/declined/tentative don't need a reminder; they have their answer.)

## Step 4 — Compose and send

For admin meeting:
```
Subject: Reminder — WiDS NYC admin meeting <when>

Hi <name>,

Just a heads-up that the admin meeting is on <scheduled_at>. Meet link is in
the calendar invite. We'll pick the next leader and confirm the next paper.

If you can't make it, decline the calendar invite so we know.
```

For reading_group meeting:
```
Subject: Reminder — WiDS NYC reading group <when> at <location>

Hi <name>,

Reminder: we're meeting <scheduled_at> at <location> to discuss
"<paper_title>" (led by <leader_name>).

If you haven't received the discussion guide yet, ask <leader_name>.
```

Send via Gmail MCP.

## Step 5 — Log

```sql
INSERT INTO command_log (source, name, status, summary)
VALUES ('scheduled_task', 'pre-meeting-reminder', 'success',
        'Reminded N members for meeting=<id>');
```
```

- [ ] **Step 2: Commit**

```bash
git add scheduled_tasks/pre-meeting-reminder.md
git commit -m "feat: pre-meeting-reminder scheduled task"
```

---

### Task 4.4: Write `meeting-auto-advance` task

**Files:**
- Create: `scheduled_tasks/meeting-auto-advance.md`

- [ ] **Step 1: Write the task file**

```markdown
---
schedule: daily
description: Mark meetings done 24h after scheduled_at passes
---

# scheduled_tasks/meeting-auto-advance

Runs daily. Trivial bookkeeping.

## Step 1 — Update

```sql
UPDATE meetings
SET status='done'
WHERE status='scheduled'
  AND scheduled_at < now() - interval '24 hours';
```

## Step 2 — Log

```sql
INSERT INTO command_log (source, name, status, summary)
VALUES ('scheduled_task', 'meeting-auto-advance', 'success',
        'Auto-advanced N meetings to done');
```

If 0 rows updated, log status='no_action' instead of 'success'.
```

- [ ] **Step 2: Commit**

```bash
git add scheduled_tasks/meeting-auto-advance.md
git commit -m "feat: meeting-auto-advance scheduled task"
```

---

### Task 4.5: Write `leader-nudge` task

**Files:**
- Create: `scheduled_tasks/leader-nudge.md`

- [ ] **Step 1: Write the task file**

```markdown
---
schedule: daily
description: Email leader directly when paper not picked, guide not drafted, or packets not sent
---

# scheduled_tasks/leader-nudge

Three nudge conditions. Fires at most once per 5 days per leader per condition. CC operator on the third.

## Conditions and queries

### Condition 1: paper not picked
```sql
SELECT m.id, m.leader_id, leader.name, leader.email,
       admin.scheduled_at AS admin_done_at
FROM meetings m
JOIN members leader ON leader.id = m.leader_id
JOIN meetings admin ON admin.id = m.planned_by_admin_id
WHERE m.type='reading_group' AND m.status='prep'
  AND m.paper_id IS NULL
  AND admin.status='done'
  AND admin.scheduled_at < now() - interval '7 days';
```

### Condition 2: guide not drafted
```sql
SELECT m.id, m.leader_id, leader.name, leader.email,
       m.scheduled_at, m.drive_folder_url
FROM meetings m
JOIN members leader ON leader.id = m.leader_id
WHERE m.type='reading_group' AND m.status='scheduled'
  AND m.scheduled_at >= now() + interval '7 days'
  AND m.scheduled_at <  now() + interval '14 days';
```

For each, check Drive folder for `members-packet.pdf` via Drive MCP. If missing → nudge.

### Condition 3: packets not sent
```sql
SELECT m.id, m.leader_id, leader.name, leader.email
FROM meetings m
JOIN members leader ON leader.id = m.leader_id
WHERE m.type='reading_group' AND m.status='scheduled'
  AND m.scheduled_at >= now() + interval '0 days'
  AND m.scheduled_at <  now() + interval '7 days'
  AND m.packets_sent_at IS NULL;
```

## Idempotency check (per condition per leader)

```sql
SELECT MAX(ran_at) FROM command_log
WHERE name='leader-nudge'
  AND summary LIKE '%leader=<leader_id>%condition=<n>%'
  AND status='success';
```
If <5 days, skip.

## Email templates

### Condition 1
```
Subject: WiDS NYC: time to pick a paper

Hi <leader_name>,

It's been a week since the admin meeting and the next reading group is
coming up. When you have a moment, run `/wids-find-paper search "<topic>"`
in Claude Code to start hunting for a paper. Or pop in some URLs you're
considering with `/wids-find-paper compare <url1> <url2>`.

No rush, just a friendly heads up.
```

### Condition 2
```
Subject: WiDS NYC: time to draft the discussion guide

Hi <leader_name>,

Reading group is in <X> days. Run `/wids-make-guide` to generate the
members' packet and your leader's packet (which has the timed agenda
and facilitation notes you'll want to review beforehand).
```

### Condition 3 (CC operator)
```
Subject: WiDS NYC: send the discussion guide to members

Hi <leader_name>,

Reading group is in <X> days and the members' packet hasn't gone out yet.
Run `/wids-send-packets` to create the email draft, then send from Gmail.

(<operator_name> is CC'd on this so they're aware.)
```

## Log

```sql
INSERT INTO command_log (source, name, status, summary)
VALUES ('scheduled_task', 'leader-nudge', 'success',
        'Nudged leader=<leader_id> condition=<n>');
```
```

- [ ] **Step 2: Commit**

```bash
git add scheduled_tasks/leader-nudge.md
git commit -m "feat: leader-nudge scheduled task with 3 conditions"
```

---

### Task 4.6: Write `post-meeting-thanks` task

**Files:**
- Create: `scheduled_tasks/post-meeting-thanks.md`

- [ ] **Step 1: Write the task file**

```markdown
---
schedule: daily
description: Send thank-you note day after each meeting; reading_group needs leader's 1-line addition
---

# scheduled_tasks/post-meeting-thanks

Two paths: reading_group (leader-augmented) vs admin (auto-sent).

## Step 1 — Find recently-completed meetings

```sql
SELECT m.id, m.type, m.scheduled_at, m.paper_id, m.leader_id,
       p.title AS paper_title,
       leader.name AS leader_name, leader.email AS leader_email
FROM meetings m
LEFT JOIN papers p ON p.id = m.paper_id
LEFT JOIN members leader ON leader.id = m.leader_id
WHERE m.status='done'
  AND m.scheduled_at >= now() - interval '36 hours'
  AND m.scheduled_at <  now() - interval '24 hours';
```

(Catches meetings that auto-advanced to done in the past day.)

## Step 2 — Idempotency

For each, check if thanks already sent:
```sql
SELECT count(*) FROM command_log
WHERE name='post-meeting-thanks' AND summary LIKE '%meeting=<id>%' AND status='success';
```
Skip if > 0.

## Step 3a — type='admin': auto-send

Recipients: active members.

Subject: `WiDS NYC: admin meeting recap`

Body (DB-driven):
```
Hi everyone,

Thanks for the admin meeting on <scheduled_at>!

Here's where we landed:
  Next reading group: <upcoming_rg.scheduled_at if known else "date being finalized">
  Leader: <upcoming_rg.leader.name if set else "TBD">
  Paper: <upcoming_rg.paper.title if set else "leader is hunting">

I'll be in touch with reminders as we get closer.
```

Send via Gmail MCP. Log success.

## Step 3b — type='reading_group': leader-augmented

Email the leader first:
```
Subject: WiDS NYC: thank-you note draft (please add 1 line)

Hi <leader_name>,

Quick favor — for the post-meeting thanks email going out today,
add ONE line about something specific from the discussion (e.g.,
"the embedding ablation conversation got really animated"). Reply
with your line and I'll merge it in and send.

Draft so far:
---
Hi everyone,

Thanks for joining last night's reading group on "<paper_title>" led by <leader_name>.

[YOUR 1-LINE ADDITION HERE]

The next reading group is being planned. More soon.
---
```

When leader replies (a separate step in the workflow — V1 may require this to be a manual operator action, since the scheduled task can't easily wait for a reply mid-run), build the final email with the leader's line slotted in and send to active members.

(For V1: if leader doesn't reply within 24h, send the draft as-is with `[discussion was great]` placeholder removed. Log this as `partial`.)

## Step 4 — Log

```sql
INSERT INTO command_log (source, name, status, summary)
VALUES ('scheduled_task', 'post-meeting-thanks', 'success',
        'Sent thanks for meeting=<id> type=<type>');
```
```

- [ ] **Step 2: Commit**

```bash
git add scheduled_tasks/post-meeting-thanks.md
git commit -m "feat: post-meeting-thanks scheduled task"
```

---

### Task 4.7: Write `calendar-rsvp-sync` task

**Files:**
- Create: `scheduled_tasks/calendar-rsvp-sync.md`

- [ ] **Step 1: Write the task file**

```markdown
---
schedule: daily
description: Pull RSVP state and rescheduling from Calendar events into meeting_attendance
---

# scheduled_tasks/calendar-rsvp-sync

Runs daily. Reflects Calendar truth into Supabase.

## Step 1 — Find scheduled meetings

```sql
SELECT id, scheduled_at FROM meetings
WHERE status='scheduled' AND scheduled_at > now() - interval '1 day';
```

## Step 2 — For each meeting, find Calendar event

For V1 we don't store the Calendar event ID separately — we look up by scheduled_at + event title pattern (`WiDS NYC%`).

If your scheduled-tasks runtime supports it, store the event ID on the meeting row in a future schema migration to avoid title matching.

Use Calendar MCP `list_events` filtered by date range and title prefix to find the matching event.

## Step 3 — Sync attendance

For each event:
- For each attendee (member email match):
  - Map their `responseStatus` (`accepted` | `declined` | `tentative` | `needsAction`) to our enum (`attending` | `declined` | `tentative` | `no_response`).
  - UPDATE `meeting_attendance` for that (meeting_id, member_id) pair, also setting `responded_at = now()` if status changed from `no_response`.

```sql
UPDATE meeting_attendance
SET rsvp_status = '<mapped_status>',
    responded_at = COALESCE(responded_at, now())
WHERE meeting_id = <meeting_id> AND member_id = <member_id>
  AND rsvp_status != '<mapped_status>';
```

## Step 4 — Sync rescheduling

If the Calendar event's start time differs from `meetings.scheduled_at`:
```sql
UPDATE meetings SET scheduled_at = <event_start>
WHERE id = <meeting_id>;
```

## Step 5 — Log

```sql
INSERT INTO command_log (source, name, status, summary)
VALUES ('scheduled_task', 'calendar-rsvp-sync', 'success',
        'Synced N RSVPs across M meetings');
```
```

- [ ] **Step 2: Commit**

```bash
git add scheduled_tasks/calendar-rsvp-sync.md
git commit -m "feat: calendar-rsvp-sync scheduled task"
```

---

### Task 4.8: Write `process-form` scheduled task

**Files:**
- Create: `scheduled_tasks/process-form.md`

Form responses don't land in the DB by themselves. This scheduled task pulls the response CSV from Drive (operator keeps it updated by re-exporting from Google Forms periodically) and UPSERTs into `availability`, `volunteers`, and `paper_suggestions`. Runs daily; safely no-ops if there's nothing new.

- [ ] **Step 1: Write the task file**

````markdown
---
schedule: daily
description: Ingest Google Form CSV responses from Drive into availability/volunteers/paper_suggestions
---

# scheduled_tasks/process-form

Runs daily. For every meeting in `status='prep'` with a `form_url`, looks for a response CSV in Drive and processes new rows.

## Step 1 — Find prep meetings with forms

```sql
SELECT m.id, m.type, m.form_url, m.planned_by_admin_id, m.drive_folder_url,
       (SELECT id FROM meetings rg WHERE rg.planned_by_admin_id = m.id LIMIT 1) AS paired_rg_id
FROM meetings m
WHERE m.status='prep' AND m.form_url IS NOT NULL;
```

For each row, follow steps 2–6.

## Step 2 — Locate the CSV in Drive

Convention: operator exports the Form's responses (Form → Responses → ⋮ → Download responses CSV) and uploads to:
- For admin meetings: `<drive_root>/cycles/<cycle_label>/admin-form-responses.csv`
- For reading_group meetings: `<drive_root>/cycles/<cycle_label>/rg-form-responses.csv`

`cycle_label` = `YYYY-MM-meeting`, derived from the reading_group's planned month. Admin meetings live under their *paired* reading_group's cycle subfolder.

If the cycle subfolder doesn't exist (typically because `/wids-find-paper pick` hasn't run yet for the reading_group), skip — the operator can't have uploaded the CSV.

If the CSV file doesn't exist, log `no_action` for this meeting and move on.

## Step 3 — Compute new-rows watermark

```sql
SELECT MAX(ran_at) AS last_run
FROM command_log
WHERE source='scheduled_task' AND name='process-form'
  AND status='success' AND summary LIKE '%meeting=<id>%';
```

Read the CSV's `Timestamp` column (Google Forms includes one). Process only rows newer than `last_run` (all rows if `last_run` is NULL).

## Step 4 — Determine target tables

Based on `m.type`:

- **`admin`:** populates 4 streams of data
  - Admin availability → `availability(meeting_id=<admin_id>, ...)` (Form Q3)
  - Reading_group far-availability → `availability(meeting_id=<paired_rg_id>, ...)` (Form Q4)
  - Volunteers → `volunteers(meeting_id=<paired_rg_id>, ...)` (Form Q5)
  - Paper suggestions → `paper_suggestions(meeting_id=<paired_rg_id>, source='member', suggested_by=<member_id>, ...)` (Form Q6)
- **`reading_group`:** populates 1 stream
  - Availability → `availability(meeting_id=<rg_id>, ...)` (Form Q3)
  - Venue suggestions are not stored in V1; included in summary text only.

## Step 5 — UPSERT each row's data

For each new row:

1. Look up member by email:
   ```sql
   SELECT id FROM members WHERE LOWER(email) = LOWER('<email>');
   ```
   If no match, log warning, skip row.

2. Parse multi-select date-time fields (e.g. `Tue 2026-05-12 7:00 PM ET`); convert to TIMESTAMPTZ, range_end = start + 90 minutes.

3. UPSERT availability (delete-and-reinsert per (meeting_id, member_id) since no UNIQUE constraint):
   ```sql
   DELETE FROM availability WHERE meeting_id = <m_id> AND member_id = <member_id>;
   INSERT INTO availability (meeting_id, member_id, range_start, range_end)
   VALUES (<m_id>, <member_id>, <start>, <end>), ...;
   ```

4. UPSERT volunteers (admin form only):
   ```sql
   INSERT INTO volunteers (meeting_id, member_id)
   VALUES (<paired_rg_id>, <member_id>)
   ON CONFLICT (meeting_id, member_id) DO NOTHING;
   ```

5. UPSERT paper suggestion (admin form only):
   ```sql
   -- Find or create paper by URL
   SELECT id FROM papers WHERE url = '<url>';
   -- If no row: INSERT INTO papers RETURNING id

   INSERT INTO paper_suggestions (meeting_id, paper_id, suggested_by, source, notes)
   VALUES (<paired_rg_id>, <paper_id>, <member_id>, 'member', NULL)
   ON CONFLICT (meeting_id, paper_id) DO NOTHING;
   ```

## Step 6 — Per-meeting log entry

```sql
INSERT INTO command_log (source, name, status, summary)
VALUES ('scheduled_task', 'process-form', 'success',
        'meeting=<id> type=<type> processed=<N> new rows; avail=<K> volunteers=<V> suggestions=<P> skipped=<S>');
```

If no new rows: log `no_action` instead, with `summary='meeting=<id> no new rows since <last_run>'`.

## Failure handling

- CSV malformed → process valid rows, skip bad ones; per-row warnings inside `summary`.
- Drive MCP unavailable → log failure for that meeting with the error; next run retries.
- DB UPSERT error → log failure for that meeting; other meetings continue.
- Member email not in `members` → skip row, increment `skipped` count.

## Operator's role

Periodically (every few days while a form is active) export the Form's responses CSV and upload to the right Drive path. Overwriting is fine. The scheduled task picks up new rows on its next daily run.

V2 enhancement: integrate Google Forms API directly to eliminate the manual export.
````

- [ ] **Step 2: Commit**

```bash
git add scheduled_tasks/process-form.md
git commit -m "feat: process-form scheduled task to ingest Google Form CSV daily"
```

---

### Task 4.9: Write scheduled tasks README (registration instructions)

**Files:**
- Create: `scheduled_tasks/README.md`

- [ ] **Step 1: Write the README**

```markdown
# Scheduled tasks

Each `.md` file in this directory is a standalone prompt to register with the scheduled-tasks MCP. They run daily and are independent — failures of one don't block others.

## Registration

For each file:

1. Open the scheduled-tasks MCP UI (or use its `create_scheduled_task` tool).
2. Create a task with:
   - **Name:** the filename without `.md` (e.g. `cycle-keep-alive`)
   - **Schedule:** daily at a time when API rate limits are calm (e.g., 09:00 ET)
   - **Prompt:** the contents of the .md file
   - **Environment:**
     - `SUPABASE_URL`
     - `SUPABASE_SERVICE_ROLE_KEY`
     - Gmail and Calendar MCPs configured at runtime level
3. Test by running once manually; verify a row appears in `command_log`.

## Order of registration

Doesn't matter — they're independent. But a sensible order is:

1. `meeting-auto-advance` (cheapest; verify infra)
2. `calendar-rsvp-sync`
3. `pre-meeting-reminder`
4. `cycle-keep-alive`
5. `form-response-chase`
6. `leader-nudge`
7. `post-meeting-thanks`

## Observability

Every task writes to `command_log`. Daily check:

```sql
SELECT ran_at, name, status, summary, error
FROM command_log
WHERE source='scheduled_task' AND ran_at > now() - interval '2 days'
ORDER BY ran_at DESC;
```
```

- [ ] **Step 2: Commit**

```bash
git add scheduled_tasks/README.md
git commit -m "docs: scheduled tasks registration instructions"
```

---

## Phase 5 — Testing and simulation

### Task 5.1: Write `/wids-simulate-cycle` command

**Files:**
- Create: `.claude/commands/wids-simulate-cycle.md`

- [ ] **Step 1: Write the command file**

```markdown
---
description: End-to-end simulation of one full 8-week cycle in a separate Supabase project for smoke testing
---

# /wids-simulate-cycle

Walks through the entire workflow with mocked external calls, against a separate Supabase project, to verify everything wires up end-to-end. Doesn't send real emails or create real Calendar events.

## Prerequisites

- A second Supabase project (different from production), with the schema applied. Set its URL/key in env vars `SIM_SUPABASE_URL` and `SIM_SUPABASE_SERVICE_ROLE_KEY`.
- A "dry-run" mode for Gmail/Calendar MCPs OR willingness to use a separate test Gmail account whose sends are noisy but inconsequential.

## Step 1 — Confirm separate project

Print: "This will write 8 fake members + 1 cycle to <SIM_SUPABASE_URL>. Reply 'go' to proceed (or 'use prod' to bail out)."

Halt unless 'go'.

## Step 2 — Seed members (8 fakes + 1 operator)

```sql
INSERT INTO members (name, email, role, active) VALUES
  ('Sim Operator',  'sim-op@example.test',  'operator', true),
  ('Sim Member 1',  'sim1@example.test',    'member',   true),
  ('Sim Member 2',  'sim2@example.test',    'member',   true),
  ('Sim Member 3',  'sim3@example.test',    'member',   true),
  ('Sim Member 4',  'sim4@example.test',    'member',   true),
  ('Sim Member 5',  'sim5@example.test',    'member',   true),
  ('Sim Member 6',  'sim6@example.test',    'member',   true),
  ('Sim Member 7',  'sim7@example.test',    'member',   true),
  ('Sim Member 8',  'sim8@example.test',    'member',   true);
```

## Step 3 — Seed topics

```sql
INSERT INTO topics (name) VALUES
  ('LLMs / Foundation Models'),
  ('RAG / Retrieval'),
  ('Diffusion / Generative Models'),
  ('Causal Inference');
```

## Step 4 — Walk the cycle (with mocks)

For each step below, print "Simulating: <command>" and run the SQL/MCP calls but with mocks for external sends:

1. **`/wids-meeting-start admin`** — creates admin + reading_group rows. Form URL placeholder.
2. **Seed availability directly** (skipping `/wids-process-form` since the simulation doesn't generate a real Google Form). In production, this is where the operator would run `/wids-process-form <admin_id>` after the form has been filled out. Insert 8 rows: 6 members covering Tue 7pm; 2 conflicting:
   ```sql
   INSERT INTO availability (meeting_id, member_id, range_start, range_end) VALUES
     (<admin_id>, 1, '2026-05-12 19:00 ET', '2026-05-12 21:00 ET'),
     (<admin_id>, 2, '2026-05-12 19:00 ET', '2026-05-12 21:00 ET'),
     ...;
   ```
3. **`/wids-schedule-admin`** — verify it picks Tue 7pm (covering window) and confirm with simulated 'go'.
4. **Seed volunteers**:
   ```sql
   INSERT INTO volunteers (meeting_id, member_id) VALUES
     (<rg_id>, 3), (<rg_id>, 5), (<rg_id>, 7);
   ```
5. **`/wids-pick-leader`** — verify longest-gap picks member 3 (never led in this fake history).
6. **`/wids-find-paper search "RAG evaluation"`** — verify candidates are inserted into `papers` and `paper_suggestions`. Pick the first one.
7. **`/wids-meeting-start reading_group`** — verify Form 2 URL stored.
8. **Seed availability for the reading_group**.
9. **`/wids-schedule-reading-group`** — simulate 'go' + venue.
10. **`/wids-make-guide`** — verify both PDFs land in the cycle Drive folder. (If running against real Drive: use a dedicated `WiDS NYC AI Reading Group SIMULATION/` folder.)
11. **`/wids-send-packets`** — verify Gmail draft is created (not sent automatically; manual confirm).

## Step 5 — Verify final state

```sql
SELECT m.id, m.type, m.status, m.scheduled_at, m.location, m.leader_id, m.paper_id
FROM meetings m ORDER BY m.created_at;

SELECT count(*) FROM command_log WHERE ran_at > now() - interval '1 hour';
```

Expected:
- 2 meetings (1 admin scheduled, 1 reading_group scheduled)
- ~10+ command_log entries

## Step 6 — Cleanup option

Print: "Simulation complete. Reply 'cleanup' to wipe simulation rows, or 'keep' to leave for inspection."

On 'cleanup':
```sql
TRUNCATE command_log, paper_suggestions, paper_topics, papers, meeting_attendance, availability, volunteers, meetings, topics, members RESTART IDENTITY CASCADE;
```

## Step 7 — Final log

(Against the SIM project:)
```sql
INSERT INTO command_log (source, name, status, summary)
VALUES ('slash_command', '/wids-simulate-cycle', 'success', 'Full cycle simulation completed');
```
```

- [ ] **Step 2: Commit**

```bash
git add .claude/commands/wids-simulate-cycle.md
git commit -m "feat: /wids-simulate-cycle for end-to-end smoke testing"
```

---

### Task 5.2: Update README with full operator handbook

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Append operator handbook**

Append the following section to `README.md`:

```markdown
## Operator handbook

### What you'll do per cycle (~5 commands, spread over 4 weeks)

1. **Week 4** (after last reading group): `/wids-meeting-start admin` — kicks off planning, sends Form 1.
2. **Week 5**: `/wids-process-form <admin_id>` — ingest the Form 1 CSV (operator manually exports + uploads).
3. **Week 5–6**: `/wids-schedule-admin` — picks the admin meeting date.
4. **Week 6** (during/after the admin meeting):
   - `/wids-pick-leader` — algorithm picks; you confirm or override.
   - `/wids-meeting-start reading_group` — sends Form 2.
5. **Week 7**:
   - `/wids-process-form <rg_id>` — ingest Form 2 CSV.
   - `/wids-schedule-reading-group` — picks the reading group date with venue.
6. **Optional anytime**: `/wids-status` — read-only dashboard showing exactly where you are.

The leader (a different person each cycle) handles `/wids-find-paper`, `/wids-make-guide`, `/wids-send-packets`.

### When something goes wrong

- **DB write failed** → check `command_log` for the `failure` row with the error message.
- **Form responses too low** → `form-response-chase` will email you. Reply with what to do, or just nag your members on WhatsApp.
- **Leader has gone silent** → `leader-nudge` will email them. CC's you on the third nudge (packets-not-sent). At that point, step in.
- **Calendar event got rescheduled by someone** → `calendar-rsvp-sync` syncs it back to the DB nightly.
- **Guide generation failed** → `meetings.status='guide_failed'`. Leader investigates, re-runs `/wids-make-guide` manually.

### Rolling backups

Supabase free tier includes daily backups (7 days retention). For heavier insurance, periodically run:
```sql
COPY (SELECT * FROM members) TO STDOUT CSV HEADER;
COPY (SELECT * FROM meetings) TO STDOUT CSV HEADER;
-- ... etc per table
```
and stash the dumps in your Drive folder.

### Going on vacation

Cycle pauses during operator absence — `cycle-keep-alive`, `form-response-chase`, and `leader-nudge` (third condition) emails queue up for your return. V2 will support a backup operator.

### V2 candidates

See `docs/superpowers/specs/2026-05-03-wids-nyc-reading-group-design.md` for full list. Top candidates:
- WhatsApp integration (Twilio)
- Auto-generated meeting minutes from transcript
- Member-facing dashboard / web UI
- Zotero / arxiv-sanity integration
- Backup operator support
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: full operator handbook"
```

---

## Final verification

After all tasks complete, run through this checklist before declaring done:

- [ ] All 11 slash commands exist in `.claude/commands/`: `bootstrap, meeting-start, process-form, schedule-admin, schedule-reading-group, pick-leader, find-paper, make-guide, send-packets, status, simulate-cycle`.
- [ ] All 7 scheduled task prompts exist in `scheduled_tasks/`: `cycle-keep-alive, form-response-chase, pre-meeting-reminder, meeting-auto-advance, leader-nudge, post-meeting-thanks, calendar-rsvp-sync`.
- [ ] `migrations/001_initial_schema.sql` exists and creates all 10 tables.
- [ ] `README.md` covers prerequisites, quick start, operator handbook.
- [ ] `git log --oneline` shows ~25 focused commits, one per task.
- [ ] (When prerequisites are real) Run `/wids-simulate-cycle` end-to-end successfully.
