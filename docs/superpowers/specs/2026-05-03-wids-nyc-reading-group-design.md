# WiDS NYC AI Reading Group Assistant — Design

**Date:** 2026-05-03
**Status:** Design (pre-implementation)

## Overview

A semi-autonomous workflow for running the WiDS NYC AI reading group. The group meets monthly, alternating between in-person reading group meetings and online admin/planning meetings — a two-month cycle from one reading group to the next.

The system has two surfaces:

1. **Claude Code slash commands** — the operator's console for kicking off cycles, scheduling, picking leaders, drafting guides, and sending packets.
2. **Scheduled background tasks** (via Anthropic's scheduled-tasks MCP) — autonomous nudges, reminders, and bookkeeping that run on cron without operator intervention.

Members never interact with Claude. They communicate via WhatsApp (social channel — agent never touches), receive email and calendar invites for structured workflow, and fill out Google Forms for availability/volunteer/paper-suggestion intake.

State lives in two places:
- **Supabase Postgres** for the relational registry (members, meetings, papers, etc.) — gives us referential integrity.
- **Google Drive** for artifacts (paper PDFs, generated discussion guides, form exports) — human-browsable archive.

## Architectural choice

Hybrid: Claude Code commands + scheduled background tasks. Considered alternatives:
- **Pure slash commands:** rejected because it puts all the burden on the operator to remember timing.
- **Pure orchestrator + subagents:** rejected because most of the workflow is sequential — parallelism is rare. Subagents are used only inside `/wids-make-guide` where they save real wall-clock.
- **State-machine driven:** rejected as over-engineered. Reading groups don't fail in interesting ways; lightweight `meetings.status` checks at the start of each command are sufficient.

The chosen design is slash commands + scheduled tasks, with selective subagent dispatch only inside `/wids-make-guide`.

## Data model

### Supabase schema

```sql
-- members of the reading group
members(
  id        SERIAL PRIMARY KEY,
  name      TEXT NOT NULL,
  email     TEXT NOT NULL UNIQUE,
  phone     TEXT,                          -- E.164, e.g. "+12125551234"
  whatsapp  TEXT,                          -- NULL = don't ping on WhatsApp
  active    BOOLEAN NOT NULL DEFAULT true, -- false = on leave; excluded from picks/forms
  role      TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'operator')),
  joined_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX one_operator ON members(role) WHERE role='operator';

-- ML topic interests (used by /wids-find-paper to bias arXiv search)
topics(
  id     SERIAL PRIMARY KEY,
  name   TEXT UNIQUE,
  weight INT DEFAULT 1
);

-- every paper that's been suggested, considered, or read
papers(
  id            SERIAL PRIMARY KEY,
  title         TEXT NOT NULL,
  url           TEXT,
  abstract      TEXT,
  authors       TEXT[],
  venue         TEXT,                      -- "NeurIPS 2024", "arXiv", "ICLR"
  year          INT,
  pdf_drive_url TEXT,
  added_at      TIMESTAMPTZ DEFAULT now()
);

-- many-to-many: papers ↔ topics
paper_topics(
  paper_id INT REFERENCES papers(id) ON DELETE CASCADE,
  topic_id INT REFERENCES topics(id) ON DELETE CASCADE,
  PRIMARY KEY (paper_id, topic_id)
);

-- one row per meeting (admin OR reading_group)
meetings(
  id                  SERIAL PRIMARY KEY,
  type                TEXT CHECK (type IN ('admin', 'reading_group')),
  status              TEXT,                 -- prep|scheduled|done|cancelled|guide_failed
  scheduled_at        TIMESTAMPTZ,          -- date+time
  location            TEXT,                 -- "Think Coffee, 4th Ave & 11th St" or "Online (Meet)"
  planned_by_admin_id INT REFERENCES meetings(id),  -- reading_group → admin that planned it
                                                     -- NULL only for kickoff/very first reading_group
  leader_id           INT REFERENCES members(id),    -- reading_group only
  paper_id            INT REFERENCES papers(id),     -- reading_group only
  form_url            TEXT,                          -- intake Form (Form 1 on admin rows, Form 2 on reading_group rows)
  drive_folder_url    TEXT,                          -- reading_group only (paper.pdf, guide.pdf)
  packets_sent_at     TIMESTAMPTZ,                   -- reading_group only; set by /wids-send-packets
  created_at          TIMESTAMPTZ DEFAULT now()
);

-- volunteer signups for leading a future reading_group
volunteers(
  id           SERIAL PRIMARY KEY,
  meeting_id   INT REFERENCES meetings(id),     -- the reading_group they're volunteering for
  member_id    INT REFERENCES members(id),
  submitted_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(meeting_id, member_id)
);

-- pre-scheduling availability windows from the Form
availability(
  id          SERIAL PRIMARY KEY,
  meeting_id  INT REFERENCES meetings(id),
  member_id   INT REFERENCES members(id),
  range_start TIMESTAMPTZ NOT NULL,
  range_end   TIMESTAMPTZ NOT NULL,
  CHECK (range_end > range_start)
);

-- post-scheduling RSVP for the locked-in date
meeting_attendance(
  id           SERIAL PRIMARY KEY,
  meeting_id   INT REFERENCES meetings(id) ON DELETE CASCADE,
  member_id    INT REFERENCES members(id),
  rsvp_status  TEXT CHECK (rsvp_status IN ('attending','declined','tentative','no_response'))
                 DEFAULT 'no_response',
  responded_at TIMESTAMPTZ,
  notes        TEXT,
  UNIQUE(meeting_id, member_id)
);

-- papers proposed for a specific reading_group
paper_suggestions(
  id            SERIAL PRIMARY KEY,
  meeting_id    INT REFERENCES meetings(id),       -- which reading_group it's suggested for
  paper_id      INT REFERENCES papers(id),
  suggested_by  INT REFERENCES members(id),        -- NULL when source='agent'
  source        TEXT CHECK (source IN ('member','agent','leader')),
  notes         TEXT,                              -- background-level assessment, leader notes
  suggested_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(meeting_id, paper_id)
);

-- audit log for slash commands and scheduled tasks
command_log(
  id         SERIAL PRIMARY KEY,
  ran_at     TIMESTAMPTZ DEFAULT now(),
  source     TEXT,                                  -- 'slash_command' | 'scheduled_task'
  name       TEXT,                                  -- e.g. '/wids-pick-leader' or 'leader-nudge'
  status     TEXT,                                  -- 'success' | 'failure' | 'no_action'
  summary    TEXT,
  error      TEXT
);
```

**Distinction between availability/attendance/volunteers** (each is a distinct workflow stage):
- `members.active` — long-term roster status ("on parental leave 6 months")
- `availability` — pre-scheduling input ("here are dates I could do")
- `meeting_attendance` — post-scheduling RSVP ("for the locked-in date, am I coming?")
- `volunteers` — "I want to lead the next reading_group"

### Drive layout

```
WiDS NYC AI Reading Group/
└── cycles/
    └── 2026-06-meeting/
        ├── paper.pdf
        ├── members-packet.pdf
        ├── leaders-packet.pdf
        └── form-responses.csv
```

`meetings.drive_folder_url` (on reading_group rows) points at the right subfolder.

## Slash commands

All commands are run by the operator or the current leader in Claude Code. They read/write Supabase + Drive via MCPs (Supabase, Drive, Gmail, Calendar). Members never run them.

### `/wids-bootstrap` (one-time setup)

Walks the operator through:
1. Supabase project creation; pastes URL + service key; runs schema migration.
2. Drive root folder URL; stores folder ID.
3. Member import (CSV or interactive). One row marked `role='operator'`.
4. Topic seeding from a curated ML genres menu (LLMs/Foundation Models, RAG/Retrieval, Agents/Tool Use, Diffusion/Generative, RL, Multimodal, CV, NLP, Speech/Audio, RecSys, Time Series, Tabular ML, Causal Inference, Bayesian, Theory, Fairness/Ethics, Interpretability, Evaluation, Efficient ML, GNNs, Self-Supervised, Healthcare AI, Robotics, Climate AI). Multi-select; custom additions allowed.
5. Outputs the prompt definitions for the 7 scheduled tasks for the operator to register via the scheduled-tasks MCP.
6. Auto-invokes `/wids-meeting-start admin` to kick off cycle #1.

### `/wids-meeting-start [type]`

Opens planning for a new meeting.

- `admin`: creates the admin row (`status='prep'`, no `scheduled_at`) AND creates the future reading_group row (`status='prep'`, `planned_by_admin_id`=admin.id, `leader_id`=NULL, `paper_id`=NULL). Generates Form 1 (availability for admin meeting + far-out availability for reading_group + volunteer-to-lead checkbox + optional paper suggestion). Stores `form_url` on admin row. Emails form link to active members.
- `reading_group`: finds the existing reading_group row (created when its admin was started). Generates Form 2 (tighter availability for reading_group date + venue suggestions). Stores `form_url` on reading_group row. Emails form link to active members.
- No arg: queries last completed meeting. If `reading_group` → run `admin`. If `admin` → run `reading_group`. If none → run `admin` (kickoff).

### `/wids-schedule-admin`

Two-phase:
1. Reads `availability` rows for the admin meeting; computes the highest-overlap window. **Presents to operator** with attendee count and missed members. Operator replies `go`, `next` (next-best window), or `skip`.
2. On `go`: creates Calendar event with Meet link, sends invites, populates `meetings.scheduled_at`, `meetings.location='Online (Meet link in invite)'`, `meetings.status='scheduled'`. Inserts `meeting_attendance` rows (one per active member, `rsvp_status='no_response'`).

### `/wids-pick-leader`

Two-phase:
1. Reads volunteers for the upcoming reading_group + meetings history (where they led). Runs longest-gap algorithm: filter to active volunteers; for each, find their most recent reading_group as leader; rank by gap (or never-led). Tie-break with random pick from the longest-gap-tied set. **Presents the pick with reasoning** (who else was eligible, when they last led).
2. On `confirm`: UPDATEs `reading_group.leader_id`, generates a WhatsApp announcement string for the operator to copy. On `pick <id>`: same, but with the override.

### `/wids-find-paper`

Research assistant for the leader. Two modes:

- `/wids-find-paper search "<query>"` — searches arXiv (via WebFetch) using the query + group's `topics` as bias. Returns 3–5 candidates with title, authors, abstract, year, venue.
- `/wids-find-paper compare <url1> <url2> ...` — leader supplies URLs. Fetches metadata; builds a side-by-side.

For each candidate, surfaces a **background-level assessment** ("comfort with X required; familiarity with Y helpful; accessibility: medium"). Inserts each candidate into `papers` and `paper_suggestions(source='agent')`. Leader picks one → command UPDATEs `reading_group.paper_id`, downloads the PDF to Drive, populates `papers.pdf_drive_url`.

### `/wids-make-guide`

Generates two PDFs (members' packet, leader's packet) using subagent dispatch. See *Subagent dispatch* section below.

### `/wids-schedule-reading-group`

Same two-phase pattern as `/wids-schedule-admin` but for the reading_group meeting:
1. Reads `availability` rows for the reading_group; computes the highest-overlap window. Presents to operator.
2. On `go`: prompts the leader for a physical venue, creates Calendar event, sends invites, populates `meetings.scheduled_at`, `meetings.location`, `meetings.status='scheduled'`. Inserts `meeting_attendance` rows (one per active member, `rsvp_status='no_response'`).

### `/wids-send-packets`

Run by the leader after `/wids-make-guide` completes. Creates a Gmail draft addressed to all active members, with `members-packet.pdf` attached (leader's packet stays local). Leader reviews/personalizes, sends from Gmail. On send, command stamps `meetings.packets_sent_at`.

### `/wids-status`

Read-only dashboard. No writes. Prints current cycle's state (admin meeting status, form response rate, volunteers, paper, guide, attendance rollup) and a "next action" hint inferred from `meetings.status`.

## Subagent dispatch in `/wids-make-guide`

Three stages. The middle stage is the only place in the system that uses parallelism, because per-question facilitation notes are independent and small enough to fan out.

### Stage 1 — Members' packet (single agent)

Run the operator's custom **`reading-group-guide`** skill on the paper PDF. Output: structured members' packet content (paper summary, section breakdown, key figures, background-level assessment, **discussion questions list** — the critical handoff for stage 2).

If stage 1 fails, command halts. `meetings.status='guide_failed'`. Surface the error to the leader. **No automatic retry** — leader investigates and re-runs manually when ready.

### Stage 2 — Leader extras (N+1 parallel subagents)

Once questions exist, fire concurrent subagents via the Agent tool:

- **1 timed-agenda subagent** — takes questions + paper summary + meeting duration (default 90 min); produces a minute-by-minute schedule.
- **N per-question facilitation-notes subagents** — one subagent per discussion question; produces facilitation notes (typical conversation paths, prompts to deepen, common misconceptions, when to redirect, estimated time).

If 6 questions → 7 subagents in parallel. Cap fan-out at 10 concurrent subagents; remainder run sequentially.

If a per-question subagent fails: skip that question's notes, mark with a `[notes generation failed — improvise]` stub in the leader's packet. Don't halt the run. Stage 3 failures (or stage 1 failures) halt the whole command per above.

### Stage 3 — Merge and render

No more LLM calls. Build:
- `members-packet.pdf` — stage 1 output, unchanged.
- `leaders-packet.pdf` — stage 1 output + timed agenda (front) + facilitation notes (interleaved after each question).

Both saved to the cycle's Drive folder.

## Scheduled background tasks

Run by Anthropic's scheduled-tasks MCP, daily by default. Each is a self-contained prompt with Supabase + Gmail + Calendar access. None can invoke Claude Code slash commands directly; they either act via MCPs or email the operator with a suggested next step.

| Task | Purpose | Action |
|------|---------|--------|
| `cycle-keep-alive` | Detect stalled cycles | If last reading_group was 28+ days ago AND no in-progress cycle → email operator suggesting `/wids-meeting-start admin`. No auto-start. |
| `form-response-chase` | Surface low-response forms | If form has been out >7 days AND <50% response rate → email operator with non-responder list. Operator triggers any reminder send. |
| `pre-meeting-reminder` | Logistics reminders | 2 days before any `status='scheduled'` meeting → email active members logistics (date, time, location, Meet link). No guide attachment (leader handles separately). |
| `meeting-auto-advance` | Status bookkeeping | Mark meetings `status='done'` 24h after `scheduled_at` passes. |
| `leader-nudge` | Keep leader on-track | Direct emails to leader: paper not picked >7d after admin; guide not drafted <14d before reading_group; packets not sent <7d before reading_group. Each nudge fires at most once per 5 days. CC operator on the third. |
| `post-meeting-thanks` | Post-meeting recap/thanks | Day after meeting flips to done. **Reading_group:** drafts thank-you, emails leader for a 1-line personal addition, sends to members. **Admin:** drafts recap, sends directly (no leader handoff). |
| `calendar-rsvp-sync` | Pull RSVP state | Polls Calendar event attendees; updates `meeting_attendance.rsvp_status` and `responded_at`. Also pulls back `scheduled_at` if event was manually rescheduled. |

## Two-month cycle timeline

Weeks counted from the previous reading_group. Bold = manual operator/leader action; italics = automatic.

| Week | Action | Who |
|------|--------|-----|
| 0 | Reading group meeting happens | — |
| 0+1d | *post-meeting-thanks* drafts thanks; leader adds personal line; sent | scheduled → leader → scheduled |
| 1 | (rest week) | — |
| 2 | *cycle-keep-alive* may fire if 28d passed | scheduled |
| 4 | **`/wids-meeting-start admin`** — creates admin + reading_group rows, sends Form 1 | operator |
| 5 | *form-response-chase* may email operator about laggers | scheduled |
| 5–6 | **`/wids-schedule-admin`** — picks date, books Calendar | operator |
| 6 | Admin meeting happens | — |
| 6 | **`/wids-pick-leader`** — runs algorithm, announces | operator |
| 6+1d | *post-meeting-thanks* (admin) — auto-sent, no leader handoff | scheduled |
| 6 | **`/wids-find-paper`** — leader searches/compares | leader |
| 6 + a few days | Leader picks paper → command updates `paper_id`, downloads PDF | leader |
| 6 | **`/wids-meeting-start reading_group`** — sends Form 2 | operator |
| 7 | **`/wids-schedule-reading-group`** — picks date, books Calendar | operator |
| 7 | **`/wids-make-guide`** — stage 1 + stage 2 fan-out + stage 3 → both PDFs | leader |
| 7–8 | *leader-nudge* may ping if guide not drafted | scheduled |
| 8 | **`/wids-send-packets`** — leader emails members' packet | leader |
| 8 | *pre-meeting-reminder* sends logistics 2 days before | scheduled |
| 8 | Reading group meeting happens — restart at week 0 | — |

Operator load: ~5 commands per cycle, concentrated in weeks 4, 6, and 7. Leader load: ~3 commands, weeks 6–8. Member load: 2 forms + the meeting itself.

## Bootstrap, edge cases, testing

### Edge cases

| Case | Handling |
|------|----------|
| Member leaves group | Operator sets `members.active=false`. Past records preserved (FKs intact). Future picks/forms exclude them. |
| Leader becomes unavailable mid-cycle | Operator re-runs `/wids-pick-leader pick <new_id>`. Old leader's volunteer record stays so they aren't penalized in next round's longest-gap. |
| Form re-sent or filled twice | UPSERT (`INSERT ... ON CONFLICT DO UPDATE`) on `UNIQUE(meeting_id, member_id)` constraints. No duplicates. |
| Paper changes after guide drafted | Leader sets new `paper_id`, re-runs `/wids-make-guide`. PDFs regenerate; old ones overwritten (Drive history preserves prior versions). |
| Calendar event manually rescheduled | `calendar-rsvp-sync` pulls updated `scheduled_at` back to the meeting row. Calendar = source of truth for time; DB for everything else. |
| Operator on vacation | Scheduled tasks needing operator ack queue up emails. Cycle pauses. Resume on return. (Backup operator support is V2.) |
| Member added mid-cycle | Operator inserts row in `members`. No retroactive availability/attendance for in-flight meetings; manual insert if they want in. |
| Two simultaneous cycles | Not supported in V1. |
| Subagent stage 2 failure (per-question) | Skip that question's notes, stub message in leader's packet. Don't halt. |
| Stage 1 or stage 3 failure in `/wids-make-guide` | Halt. `status='guide_failed'`. No retry until leader requests. |
| DB write fails mid-command | All multi-statement command logic in a Postgres transaction; rollback on failure. |

### Testing strategy

Three layers (since we can't wait two months for a real cycle):

1. **Unit-style tests per slash command.** Test Supabase project, fixture data, dry-run mode (env var) suppresses real emails/Calendar writes. Specific tests:
   - Leadership: seed history with various patterns; verify longest-gap + tie-break.
   - Scheduling: seed availability ranges; verify chosen window matches human intuition.
   - Guide generation: run on known short paper; eyeball outputs.
2. **Time-warp simulation.** Each scheduled task accepts `--simulate-date=YYYY-MM-DD`; compress 8-week cycle into an afternoon.
3. **Dry-run end-to-end.** A `/wids-simulate-cycle` command seeds 8 fake members in a separate Supabase project, walks the full cycle with mocked external calls.

Production observability: every slash command and scheduled task writes a row to `command_log` (timestamp, name, status, summary, error). First place to look when something seems off.

## Out of scope (V2 candidates)

- WhatsApp integration (Twilio or WhatsApp Business API)
- Auto-generated meeting minutes from transcript
- Member-facing dashboard / web UI
- Zotero / arxiv-sanity integration
- Backup operator / multi-operator support
