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
  rg.packets_sent_at,
  rg.drive_folder_url,
  admin.id           AS admin_id,
  admin.scheduled_at AS admin_scheduled,
  admin.status       AS admin_status
FROM meetings rg
LEFT JOIN meetings admin ON admin.id = rg.planned_by_admin_id
WHERE rg.type = 'reading_group'
  AND rg.status IN ('prep','scheduled')
ORDER BY rg.created_at DESC
LIMIT 1;
```

If no rows: print "No active cycle. Run `/wids-meeting-start admin` to begin." and exit.

## Step 2 — Pull related data

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
SELECT title, year, venue, companion_url FROM papers WHERE id = <paper_id>;

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
  Form responses:   <responded>/<total> members
  Volunteers:       <volunteer_count>

Reading group (#<rg_id>):
  Status:           <rg_status>
  Scheduled:        <rg_scheduled or "TBD">
  Location:         <rg_location or "TBD">
  Leader:           <leader_name or "not yet picked">
  Paper:            "<paper_title>" (<year>, <venue>) or "not yet picked"
  Companion:        <"published — ${PORTAL_URL}<companion_url>" or "not yet generated"> (read from `papers.companion_url IS NOT NULL` for the active paper)
  Members' packet:  <"sent <packets_sent_at>" or "not yet drafted">

Attendance: <attending=N declined=N tentative=N no_response=N>

Next action:
  <inferred from status — see below>
```

## Step 4 — Infer next action

Logic:
- If `admin_status='prep'`: "Wait for availability responses via portal at `${PORTAL_URL}/availability`. `/wids-schedule-admin` when ready."
- If `admin_status='scheduled'` AND `admin_scheduled` in future: "Admin meeting on <date>. Then run `/wids-pick-leader`."
- If `admin_status='done'` AND `rg.leader_id IS NULL`: "Run `/wids-pick-leader`."
- If `rg.leader_id` set AND `rg.paper_id IS NULL`: "Leader: run `/wids-find-paper`."
- If `rg.paper_id` set AND `rg.scheduled_at IS NULL`: "Run `/wids-meeting-start reading_group` then `/wids-schedule-reading-group`."
- If `rg.scheduled_at` set AND no guide PDFs in Drive: "Leader: run `/wids-make-guide`."
- If guide PDFs exist AND `packets_sent_at IS NULL`: "Leader: run `/wids-send-packets`."
- Otherwise: "Reading group on <date>. See you there."

## Step 5 — Audit log
```sql
INSERT INTO command_log (source, name, status, summary)
VALUES ('slash_command', '/wids-status', 'success', 'Dashboard rendered');
```
