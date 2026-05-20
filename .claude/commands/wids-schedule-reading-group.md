---
description: Pick reading_group meeting date from availability, prompt for venue, book Calendar event
---

# /wids-schedule-reading-group

Mirrors `/wids-schedule-admin` but with a venue prompt because reading groups are in-person.

## Step 1 — Find the reading_group meeting

```sql
-- planned_by_admin_id IS NOT NULL selects the cycle's canonical
-- reading_group and excludes member-proposed placeholders from
-- proposePaper, which are also type='reading_group' status='prep'
-- but never carry planned_by_admin_id.
SELECT id, leader_id, paper_id FROM meetings
WHERE type='reading_group' AND status='prep'
  AND planned_by_admin_id IS NOT NULL
ORDER BY created_at DESC LIMIT 1;
```

If no row: halt: "No reading_group in prep. Run `/wids-meeting-start reading_group`."

If `leader_id IS NULL` or `paper_id IS NULL`: halt: "Pick leader and paper first."

## Step 2 — Compute best window

Same query as `/wids-schedule-admin` Step 2 but with target meeting_id = <rg_id>. Default duration: 90 minutes.

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

- No availability rows → halt: "No availability collected yet. Members submit via the portal at `${PORTAL_URL}/availability`. Wait for responses or run `availability-chase` to nudge non-responders."
- Calendar event creation fails → no DB update; log failure with the error message.
