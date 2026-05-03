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
