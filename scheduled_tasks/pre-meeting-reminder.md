---
schedule: daily
description: Email logistics reminder to active members 2 days before any scheduled meeting
---

# scheduled_tasks/pre-meeting-reminder

Runs daily. For any meeting `status='scheduled'` with `scheduled_at` 2 days out, emails active members the logistics.

See [`docs/pre-meeting-reminder-flow.md`](../docs/pre-meeting-reminder-flow.md)
for the current live send path, idempotency notes, and the deferred cutover
checklist for `assets/emails/template/pre-meeting-reminder.{html,txt}`.

## Step 1 — Find meetings 2 days out

```sql
SELECT m.id, m.type, m.scheduled_at, m.location, m.paper_id,
       p.title AS paper_title,
       p.authors AS paper_authors,
       p.companion_url AS paper_companion_url,
       leader.name AS leader_name
FROM meetings m
LEFT JOIN papers p ON p.id = m.paper_id
LEFT JOIN members leader ON leader.id = m.leader_id
WHERE m.status='scheduled'
  AND m.scheduled_at >= now() + interval '2 days'
  AND m.scheduled_at <  now() + interval '3 days';
```

## Step 2 — Check idempotency

For each meeting, check if the reminder was already sent — keyed on the exact
`idempotency_key` written in Step 5 (no brittle `summary LIKE` scan):
```sql
SELECT 1 FROM command_log
WHERE idempotency_key = 'pre-meeting-reminder:meeting=<id>'
LIMIT 1;
```
If a row exists, skip. The `command_log_idempotency_key_unique` index is the
race backstop: if two runs overlap, the second Step-5 INSERT trips a unique
violation (SQLSTATE 23505) — treat that as already-sent.

## Step 3 — Build recipient list (split by RSVP status)

Active members who RSVP'd **attending** get the templated thank-you
(`assets/emails/template/rsvp-confirmation.{html,txt}`). Everyone else who
hasn't already declined gets the plain reminder. Declined members are
skipped entirely — they already gave their answer.

```sql
SELECT mem.email, mem.name, ma.rsvp_status
FROM meeting_attendance ma
JOIN members mem ON mem.id = ma.member_id
WHERE ma.meeting_id = <id>
  AND mem.active = true
  AND ma.rsvp_status IN ('attending', 'tentative', 'no_response');
```

Partition the result:
- **Thank-you bucket:** `rsvp_status = 'attending'` → Step 4a
- **Reminder bucket:** `rsvp_status IN ('tentative', 'no_response')` → Step 4b

## Step 4a — Send RSVP thank-you (attending bucket)

Reading-group meetings only — skip this branch for admin meetings (use the
plain reminder for those regardless of RSVP status).

Render `assets/emails/template/rsvp-confirmation.html` (and the matching
`.txt` as the multipart alternative). Required tokens — refuse to send if
any are unresolved:

| Token | Source |
|---|---|
| `recipient.firstName` | `members.name` (first token) |
| `links.calendar` | `meetings.calendar_ics_url` or portal event URL |
| `paper.title` | `papers.title` |
| `paper.authorsShort` | derived from `papers.authors[]` (see availability-chase.md Step 5b) |
| `paper.companionUrl` | `<portalBase><paper_companion_url>` (for example, `<portalBase>/papers/2`; refuse or omit if null) |
| `links.rsvpManage` | `<portal>/me/rsvps` |
| `links.portalBase` | `https://planner.widsnyc.org` (or env override) |

Rotated tokens: `haiku.line1/2/3` still follow the haiku pool in this
template's README. `quote.text` / `quote.by` / `quote.role` are resolved from
the women-in-STEM pool via `scripts/quotes.py` — set `date_key` = whole days
since 1970-01-01 UTC for the send date, then
`quote_tokens(select_quote(load_bundle(), date_key))`. Optional with a built-in
fallback (seed Grace Hopper quote).

Subject: `You're in — thanks for the RSVP`

Send via Gmail MCP.

## Step 4b — Send plain reminder (tentative + no_response bucket, and all admin meetings)

Resolve a rotating quote the same way as Step 4a (`scripts/quotes.py`, `date_key`
= whole days since 1970-01-01 UTC for the send date) and append it as the two
plain-text lines shown at the end of each body. If the pool is empty the
built-in fallback is used, so the lines always render.

For admin meeting:
```
Subject: Reminder — WiDS NYC admin meeting <when>

Hi <name>,

Just a heads-up that the admin meeting is on <scheduled_at>. Meet link is in
the calendar invite. We'll pick the next leader and confirm the next paper.

If you can't make it, decline the calendar invite so we know.

— "<quote.text>" — <quote.by>, <quote.role>
```

For reading_group meeting:
```
Subject: Reminder — WiDS NYC reading group <when> at <location>

Hi <name>,

Reminder: we're meeting <scheduled_at> at <location> to discuss
"<paper_title>" (led by <leader_name>).

If you haven't received the discussion guide yet, ask <leader_name>.

— "<quote.text>" — <quote.by>, <quote.role>
```

Send via Gmail MCP.

## Step 5 — Log

```sql
INSERT INTO command_log (source, name, status, summary, idempotency_key, metadata)
VALUES ('scheduled_task', 'pre-meeting-reminder', 'success',
        'meeting=<id>: thanked <T> RSVPers, reminded <R> pending',
        'pre-meeting-reminder:meeting=<id>',
        jsonb_build_object('meeting_id', <id>, 'thanked', <T>, 'reminded', <R>));
```
