---
schedule: daily
description: Detect low availability-response rates and email operator (operator-first, no auto-send to members)
---

# scheduled_tasks/availability-chase

Runs daily. For any meeting in `status='prep'` more than 7 days old, computes availability-response rate; if low, alerts the operator. Renamed from `form-response-chase` with migration 002 — availability is now collected via the portal at `https://wids-nyc-reading-group-assistant.vercel.app/availability`, not Google Forms.

## Step 1 — Find prep meetings needing chase

```sql
SELECT m.id, m.type, m.created_at,
       (SELECT count(DISTINCT a.member_id) FROM availability a WHERE a.meeting_id = m.id) AS responded,
       (SELECT count(*) FROM members WHERE active=true) AS total
FROM meetings m
WHERE m.status='prep'
  AND m.created_at < now() - interval '7 days';
```

## Step 2 — For each row, decide

For each meeting:
- response_rate = responded / total
- If response_rate < 0.5 AND last alert email for this meeting was sent >5 days ago (or never):
  - Send alert. (Step 3.)
- Otherwise: skip.

(Idempotency: query `command_log` for prior alerts on this meeting:)
```sql
SELECT MAX(ran_at) FROM command_log
WHERE name='availability-chase' AND status='success' AND summary LIKE '%meeting=<id>%';
```

## Step 3 — Send alert email

Recipient: operator.

Subject: `WiDS NYC: availability for <meeting_type> meeting at <responded>/<total> responses`

Body:
```
The portal availability page for <meeting_type> meeting #<id> has been open <days> days.
Response rate: <responded>/<total> active members.

Non-responders:
  <names of active members WITHOUT availability rows for this meeting>

Portal link: https://wids-nyc-reading-group-assistant.vercel.app/availability

Reply:
  'remind'                — I'll email non-responders with the designed reminder template
  'remind subject="..."'  — same, but override the subject line for this send
  'wait'                  — leave as-is for now

If you reply 'remind', I'll send the Availability Reminder email (see
assets/emails/template/availability-reminder.html) to non-responders only.
```

## Step 4 — Log

```sql
INSERT INTO command_log (source, name, status, summary)
VALUES ('scheduled_task', 'availability-chase', 'success',
        'Sent low-response alert to operator for meeting=<id>: <responded>/<total>');
```

## Step 5 — Operator 'remind' follow-up (member-facing send)

Triggered when the operator replies `remind` (with optional `subject="..."`
override) to the alert email from Step 3. Sends the Availability Reminder
email — designed via the Claude Design handoff — to every active member
without an `availability` row for the meeting. Sends from the operator's
Gmail via the Gmail MCP.

### 5a — Resolve subject

Default subject: `We need you now more than ever — to have dinner with us`

If the operator's reply included `subject="<text>"`, use that instead.
Acceptable alternates the operator may type back if they want a different
register:
- `Don't miss the deadline for the next salon`
- `Your availability for the next reading group`
- `The Round Table needs a date — when can you make it?`

### 5b — Resolve per-cycle merge data

```sql
-- meeting + paper (one row)
SELECT m.id            AS meeting_id,
       m.type          AS meeting_type,
       p.title         AS paper_title,
       p.authors_short AS paper_authors_short,
       p.arxiv_id      AS paper_arxiv_id,
       p.location      AS paper_location,
       p.duration      AS paper_duration,
       p.companion_drop_day AS paper_companion_drop_day,
       p.slug          AS paper_slug
FROM meetings m
LEFT JOIN papers p ON p.meeting_id = m.id
WHERE m.id = <meeting_id>;

-- stats (one row)
SELECT (SELECT count(DISTINCT a.member_id) FROM availability a WHERE a.meeting_id = <meeting_id>) AS submitted_count,
       (SELECT count(*) FROM members WHERE active = true)                                          AS total_members;

-- non-responders (N rows; one email per row)
SELECT mb.id, mb.email, mb.first_name
FROM members mb
WHERE mb.active = true
  AND NOT EXISTS (
        SELECT 1 FROM availability a
        WHERE a.meeting_id = <meeting_id> AND a.member_id = mb.id);
```

Static / config values:
- `operator.displayName` — operator's display name (currently `Madeline Rojas`).
- `links.portalBase` — `https://wids-nyc-reading-group-assistant.vercel.app`
- `links.availability` — `<portalBase>/availability`
- `links.companionPreview` — `<portalBase>/papers/<paper.slug>` (if `paper.slug` is null, drop the PS link by replacing `<a …>Preview link</a>` with the literal text `Preview link coming soon` before send).
- `paper.arxivUrl` — `https://arxiv.org/abs/<paper.arxivId>`
- `deadline.soft` — derived: the upcoming Sunday evening relative to send date (e.g. `Sunday evening`).
- `stats.submittedCountWord` — `stats.submittedCount` spelled out in English title-case (`One`, `Two`, …, `Ten`, then fallback to the digit string for >10). Used in the bold `<strong>… of us</strong>` line.

### 5c — Render + send per recipient

For each non-responder row:

1. Read `assets/emails/template/availability-reminder.html` and
   `assets/emails/template/availability-reminder.txt`.
2. Substitute every `{{ token }}` with the resolved value. Tokens:

   | Token | Source |
   |---|---|
   | `{{ recipient.firstName }}` | members.first_name (this row) |
   | `{{ paper.title }}` | papers.title |
   | `{{ paper.authorsShort }}` | papers.authors_short |
   | `{{ paper.arxivId }}` | papers.arxiv_id |
   | `{{ paper.arxivUrl }}` | derived from arxiv_id |
   | `{{ paper.location }}` | papers.location |
   | `{{ paper.duration }}` | papers.duration |
   | `{{ paper.companionDropDay }}` | papers.companion_drop_day |
   | `{{ stats.submittedCount }}` | int |
   | `{{ stats.submittedCountWord }}` | derived word form |
   | `{{ stats.totalMembers }}` | int |
   | `{{ deadline.soft }}` | derived |
   | `{{ links.availability }}` | static |
   | `{{ links.companionPreview }}` | derived |
   | `{{ links.portalBase }}` | static |
   | `{{ operator.displayName }}` | static / config |

3. Idempotency check — skip this recipient if a prior reminder for this
   `meeting × member` is already logged:

   ```sql
   SELECT 1 FROM command_log
   WHERE name = 'availability-chase'
     AND status = 'success'
     AND summary LIKE '%reminder meeting=<meeting_id> member=<member_id>%'
   LIMIT 1;
   ```

4. Send via Gmail MCP. Single recipient per send (no bcc fan-out — each
   member gets a personalised body). Include **both** the rendered HTML
   body and the rendered plain-text body so clients that strip HTML still
   read correctly (handoff acceptance criterion #2).

5. Log:

   ```sql
   INSERT INTO command_log (source, name, status, summary)
   VALUES ('scheduled_task', 'availability-chase', 'success',
           'Sent reminder meeting=<meeting_id> member=<member_id> to=<email>');
   ```

### 5d — Confirm back to operator

After the per-recipient loop finishes, send a single summary email to the
operator: `Sent reminders to <N> non-responders for <meeting_type> meeting #<id>`
plus the list of recipient first names. No HTML — plain text is fine for
this confirmation.
