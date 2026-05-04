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

### Step A2 — Email members about the new availability request

As of migration 002, availability is collected via the portal at `${PORTAL_URL}/availability`. The portal automatically surfaces any meeting in `status='prep'` to members — no Form to create.

Send a notification email so members know to visit the portal. Use Gmail MCP. Recipients: `SELECT email FROM members WHERE active=true`. Subject: "WiDS NYC AI Reading Group — next-cycle planning (please submit availability by <today + 7 days>)". Body: brief intro + `${PORTAL_URL}/availability` + close-by date.

> **Note on volunteers and paper suggestions:** The pre-portal Google Form also collected volunteer interest and paper suggestions for the next reading group. In the portal world these are gathered live during the admin meeting itself; the operator records them post-meeting via `INSERT`s into `volunteers` and `paper_suggestions`. Future portal pages may take over this collection.

### Step A3 — Audit log

```sql
INSERT INTO command_log (source, name, status, summary)
VALUES ('slash_command', '/wids-meeting-start',
        'success',
        'Started admin cycle: admin=<admin_id>, reading_group=<rg_id>, portal link sent to N members');
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

### Step R2 — Email members about the new availability request

The portal at `${PORTAL_URL}/availability` already surfaces this reading_group meeting (any meeting in `status='prep'`). Members visit, see the candidate windows from the admin discussion, and submit availability directly.

Send a notification email. Same shape as Step A2 but with subject "WiDS NYC AI Reading Group — final scheduling for <month> reading group". Body: brief intro + `${PORTAL_URL}/availability` + close-by date.

> **Venue suggestions** — previously a free-text Form field — are now solicited at the admin meeting itself or in email reply. The operator pastes the chosen venue when prompted by `/wids-schedule-reading-group`.

### Step R3 — Audit log

```sql
INSERT INTO command_log (source, name, status, summary)
VALUES ('slash_command', '/wids-meeting-start',
        'success',
        'Started reading_group scheduling: rg=<rg_id>, portal link sent to N members');
```

## Failure handling

If transaction in step A1 fails or no admin meeting exists for branch R: log failure and halt cleanly.
