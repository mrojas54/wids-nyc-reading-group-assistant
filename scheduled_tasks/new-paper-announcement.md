---
schedule: manual
description: Draft the court/queens new-paper announcement (paper card + AI prerequisites) as per-member Gmail drafts for operator review
---

# scheduled_tasks/new-paper-announcement

**Operator-triggered**, not a daily cron. Run this once a new reading-group
cycle's paper and leader are locked in. It fills the newest paper's card fields
and drafts the editable **"Recommended pre-requisites"**, then creates a Gmail
**draft** per active member for the operator to review and send. It **never
auto-sends**.

The AI drafting happens in *this* prompt (Step 3) — the Python generator only
reads the DB and renders the template, so there is no `anthropic` dependency on
the script side. See
[`docs/superpowers/specs/2026-07-13-reading-group-email-and-prerequisites-design.md`](../docs/superpowers/specs/2026-07-13-reading-group-email-and-prerequisites-design.md)
for the design and [`docs/runbooks/transactional-emails.md`](../docs/runbooks/transactional-emails.md)
for the template→consumer map.

**Environment.** In addition to the Supabase + Gmail MCPs, this task needs
`SUPABASE_DB_URL` (a libpq/Postgres connection string) in the environment — the
generator connects directly with psycopg. That is **not** the same as
`SUPABASE_URL`; set both. Migrations must be applied through `022`
(`papers.prerequisites`) and `020` (`command_log.idempotency_key`).

## Step 1 — Gather the newest paper's generation contract

```sh
uv run python -m scripts.generate_prerequisites --mode gather
```

This selects the newest paper — the most recent `meetings` row with a
`paper_id`, falling back to `papers` ordered by `added_at DESC` — and prints a
JSON contract: `{paper_id, title, abstract, authors, url, instructions}`. Read
`paper_id` from it for the steps below.

If the command exits non-zero with "no papers in the database", there is nothing
to announce: log `no_action` (Step 7) and stop.

## Step 2 — Check idempotency

The announcement is generated **once per paper**. Check the exact
`idempotency_key` written in Step 7 (no brittle `summary LIKE` scan):

```sql
SELECT 1 FROM command_log
WHERE idempotency_key = 'new-paper-announcement:paper=<paper_id>'
LIMIT 1;
```

If a row exists, the drafts were already generated for this paper — skip. The
`command_log_idempotency_key_unique` index is the race backstop: if two runs
overlap, the second Step-7 INSERT trips a unique violation (SQLSTATE 23505) —
treat that as already-done.

## Step 3 — Draft the generated fields with Claude

First, **preserve any operator edits** — do not redraft a bundle the operator
may already have revised:

```sql
SELECT prerequisites FROM papers WHERE id = <paper_id>;
```

If `prerequisites IS NOT NULL`, skip this step and Step 4 and go to Step 5 using
the stored bundle. Otherwise, follow the contract's `instructions.guidance` and
draft exactly this shape (**exactly 3 items**):

```json
{
  "short_title": "<=12-word rewrite of the title for the intro line",
  "summary": "one sentence (<=30 words) completing 'she'll steer the discussion on <short_title> — <summary>'",
  "lede": "one line framing the prerequisites",
  "items": ["concept/skill to review (<=20 words)", "…", "…"]
}
```

## Step 4 — Persist the draft bundle

Persist via the Supabase MCP `execute_sql`, adding the metadata fields
(`status`, `model`, `generated_at`):

```sql
UPDATE papers
SET prerequisites = jsonb_build_object(
  'lede', '<lede>',
  'items', jsonb_build_array('<item 1>', '<item 2>', '<item 3>'),
  'summary', '<summary>',
  'short_title', '<short_title>',
  'status', 'draft',
  'model', 'claude-opus-4-8',
  'generated_at', now()
)
WHERE id = <paper_id>;
```

`status` stays `'draft'`: the operator can edit this row (or the Gmail draft)
before sending, and a later run won't overwrite it (Step 3 guard). `render` mode
reads back `lede`, `items`, `summary`, and `short_title`; `authors_short` is
**derived at render time** from `papers.authors`, so it is not persisted here.

## Step 5 — Build the recipient list + per-send tokens

```sql
SELECT id, name, email FROM members WHERE active = true;
```

The per-send tokens are **operator-supplied** and constant across members except
`recipient.firstName`. `paper.*`, `prereqs.*`, and `quote.*` are filled by the
render script — do **not** supply them here.

| Token | Source |
|---|---|
| `recipient.firstName` | `members.name` (first token) — varies per member |
| `lead.name` | current cycle leader (`meetings.leader_id` → `members.name`) |
| `lead.initial` | first initial of `lead.name` |
| `lead.blurb` | operator one-liner on the new co-lead (no DB field) |
| `signoff.names` | operator + lead, e.g. `Michelle & Claudia` |
| `links.availability` | `<portalBase>/availability` |
| `links.rsvpManage` | `<portalBase>/me/rsvps` |

## Step 6 — Render + create a Gmail draft per member

For each active member, pipe that member's per-send tokens as JSON into render
mode:

```sh
echo '{"recipient.firstName":"<first>","lead.name":"<lead>","lead.initial":"<X>","lead.blurb":"<blurb>","signoff.names":"<signoff>","links.availability":"<portalBase>/availability","links.rsvpManage":"<portalBase>/me/rsvps"}' \
  | uv run python -m scripts.generate_prerequisites --mode render
```

It emits `{"paper_id", "html", "text"}` with every `{{ token }}` resolved, and
**errors (exit 1) if any token is unresolved** — never create a draft from a
partial render. Create a Gmail **draft** (never auto-send) to that member:

- **Subject:** a court-voice line, e.g. `A new queen reigns this month — <short_title>`
- **HTML body:** the `html` field
- **Plain-text alternative:** the `text` field

## Step 7 — Log

```sql
INSERT INTO command_log (source, name, status, summary, idempotency_key, metadata)
VALUES ('scheduled_task', 'new-paper-announcement', 'success',
        'paper=<paper_id>: drafted <N> member announcements',
        'new-paper-announcement:paper=<paper_id>',
        jsonb_build_object('paper_id', <paper_id>, 'drafts', <N>, 'status', 'draft'));
```

If Step 1 found no paper, log `no_action` instead — no `idempotency_key`:

```sql
INSERT INTO command_log (source, name, status, summary)
VALUES ('scheduled_task', 'new-paper-announcement', 'no_action', 'no papers to announce');
```
