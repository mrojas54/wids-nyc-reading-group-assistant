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
