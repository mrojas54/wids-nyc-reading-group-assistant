---
description: Read-only dashboard of current cycle state
---

# /wids-status

Print a one-screen summary of where the current cycle stands. No writes.

## Step 1 — Find the active cycle

Run via Supabase MCP:
```sql
SELECT
  rg.id              AS reading_group_id,
  rg.scheduled_at    AS rg_scheduled,
  rg.status          AS rg_status,
  rg.location        AS rg_location,
  rg.paper_id,
  rg.leader_id,
  rg.drive_folder_url,
  pc.generated_at    AS paper_pal_generated_at,
  admin.id           AS admin_id,
  admin.scheduled_at AS admin_scheduled,
  admin.status       AS admin_status
FROM meetings rg
LEFT JOIN meetings admin ON admin.id = rg.planned_by_admin_id
LEFT JOIN paper_companions pc ON pc.paper_id = rg.paper_id
WHERE rg.type = 'reading_group'
  AND rg.status IN ('prep','scheduled')
ORDER BY rg.created_at DESC
LIMIT 1;
```

`meetings.packets_sent_at` was dropped in migration `024` (PDF-packet flow
deprecated). Paper Pal readiness is `paper_companions.generated_at` via
`paper_id` — see `migrations/024_drop_packets_sent_at.sql`.

If no rows: print "No active cycle. Run `/wids-meeting-start admin` to begin." and exit.

## Step 2 — Pull related data

For the active cycle:

```sql
-- volunteer count
SELECT count(*) FROM volunteers WHERE meeting_id = <rg_id>;

-- availability response rate for the admin meeting
SELECT
  (SELECT count(DISTINCT member_id) FROM availability WHERE meeting_id = <admin_id>) AS responded,
  (SELECT count(*) FROM members WHERE active = true) AS total;

-- attendance rollup (if scheduled)
SELECT rsvp_status, count(*) FROM meeting_attendance
WHERE meeting_id IN (<admin_id>, <rg_id>)
GROUP BY rsvp_status;

-- paper info if picked
SELECT title, year, venue, companion_url FROM papers WHERE id = <paper_id>;

-- Paper Pal companion (source of truth; preferred over papers.companion_url)
SELECT generated_at, (payload IS NOT NULL) AS has_payload
FROM paper_companions WHERE paper_id = <paper_id>;

-- leader info if picked
SELECT name FROM members WHERE id = <leader_id>;
```

## Step 3 — Render the dashboard

Format output as:

```
WiDS NYC AI Reading Group — current cycle status
─────────────────────────────────────────────────
Admin meeting (#<admin_id>):
  Status:           <admin_status>
  Scheduled:        <admin_scheduled or "TBD">
  Availability:     <responded>/<total> members
  Volunteers:       <volunteer_count>

Reading group (#<rg_id>):
  Status:           <rg_status>
  Scheduled:        <rg_scheduled or "TBD">
  Location:         <rg_location or "TBD">
  Leader:           <leader_name or "not yet picked">
  Paper:            "<paper_title>" (<year>, <venue>) or "not yet picked"
  Companion:        <"ready at ${PORTAL_URL}/papers/<paper_id> (generated <paper_pal_generated_at>)"
                    or "not yet generated">

Attendance: <attending=N declined=N tentative=N no_response=N>

Next action:
  <inferred from status — see below>
```

Prefer `paper_companions.payload` / `generated_at` for the Companion line.
Fall back to `papers.companion_url` only when no `paper_companions` row exists.

## Step 4 — Infer next action

Logic (first match wins, in order):

- If `admin_status='prep'`: "Wait for availability responses via portal at `${PORTAL_URL}/availability`. `/wids-schedule-admin` when ready."
- If `admin_status='scheduled'` AND `admin_scheduled` in future: "Admin meeting on <date>. Then run `/wids-pick-leader`."
- If `rg.leader_id IS NULL`: "Run `/wids-pick-leader`." *(catches any post-admin or admin-less state where the leader still hasn't been chosen)*
- If `rg.paper_id IS NULL`: "Leader: run `/wids-find-paper`."
- If `rg.scheduled_at IS NULL`: "Run `/wids-meeting-start reading_group` then `/wids-schedule-reading-group`."
- If `rg.scheduled_at` set AND `paper_pal_generated_at IS NULL` (no
  `paper_companions` row for the paper): "Leader: open `/new?paperId=<paper_id>`
  and generate the Paper Pal companion before the pre-meeting reminder."
- Otherwise: "Reading group on <date>. See you there."

Do **not** nudge `/wids-make-guide` or `/wids-send-packets` — both are deprecated
and superseded by Paper Pal (`docs/paper-pal-portal.md`).

Earlier bullets short-circuit later ones — e.g. if `admin_status='prep'` the first bullet fires regardless of leader/paper state, which is correct because the operator shouldn't pick a leader until the admin meeting has happened.

## Step 5 — Audit log
```sql
INSERT INTO command_log (source, name, status, summary)
VALUES ('slash_command', '/wids-status', 'success', 'Dashboard rendered');
```
