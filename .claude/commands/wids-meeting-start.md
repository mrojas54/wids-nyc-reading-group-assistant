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

Remind operator to periodically export the form's responses CSV and upload to:
`<drive_root>/cycles/<cycle_label>/admin-form-responses.csv` — the `process-form` scheduled task picks them up daily.

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

Remind operator to export responses to:
`<drive_root>/cycles/<cycle_label>/rg-form-responses.csv`

### Step R5 — Audit log

```sql
INSERT INTO command_log (source, name, status, summary)
VALUES ('slash_command', '/wids-meeting-start',
        'success',
        'Started reading_group scheduling: rg=<rg_id>, form sent to N members');
```

## Failure handling

If transaction in step A1 fails or no admin meeting exists for branch R: log failure and halt cleanly.
