---
description: "[DEPRECATED — superseded by Paper Pal] Create a Gmail draft with members-packet.pdf attached."
---

# /wids-send-packets — DEPRECATED

> **Superseded by Paper Pal.** Packets aren't mailed anymore. The pre-meeting reminder email now links members to `/papers/<id>` (the live Paper Pal surface) instead of attaching a PDF. The leader's responsibility is to make sure the companion is generated (one click on `/new` in the portal) before the reminder fires.
>
> This command is kept for rollback. The legacy implementation below is preserved unchanged.

---

# /wids-send-packets

Run by the leader after `/wids-make-guide`. Creates a Gmail draft for the leader to personalize and send.

## Step 1 — Find active reading_group with packets ready

```sql
SELECT m.id, m.scheduled_at, m.location, m.drive_folder_url,
       p.title, p.url, p.companion_url, leader.name AS leader_name, leader.email AS leader_email
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

<if companion_url IS NOT NULL>
Read the paper companion: ${PORTAL_URL}<companion_url>
</if>

See you there,
<leader_name>
```

If `papers.companion_url IS NULL`, omit the companion line entirely (don't render an empty placeholder).

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
