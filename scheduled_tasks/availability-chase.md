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
-- meeting + paper (one row). FK direction: meetings.paper_id → papers.id.
SELECT m.id              AS meeting_id,
       m.type            AS meeting_type,
       m.location        AS meeting_location,
       p.id              AS paper_id,
       p.title           AS paper_title,
       p.authors         AS paper_authors,        -- text[] of full names
       p.venue           AS paper_venue,
       p.year            AS paper_year,
       p.url             AS paper_url,            -- arXiv abs URL OR DOI URL OR journal landing page
       p.s2_paper_id     AS paper_s2_paper_id,    -- e.g. "DOI:10.3390/math13101551" or "ARXIV:2026.04812"
       p.companion_url   AS paper_companion_url   -- e.g. "/papers/2"
FROM meetings m
LEFT JOIN papers p ON p.id = m.paper_id
WHERE m.id = <meeting_id>;

-- stats (one row)
SELECT (SELECT count(DISTINCT a.member_id) FROM availability a WHERE a.meeting_id = <meeting_id>) AS submitted_count,
       (SELECT count(*) FROM members WHERE active = true)                                          AS total_members;

-- non-responders (N rows; one email per row). members.name is a single
-- column; split on space for first_name.
SELECT mb.id,
       mb.email,
       split_part(mb.name, ' ', 1) AS first_name
FROM members mb
WHERE mb.active = true
  AND NOT EXISTS (
        SELECT 1 FROM availability a
        WHERE a.meeting_id = <meeting_id> AND a.member_id = mb.id);
```

Static / config values:
- `operator.displayName` — operator's display name (currently `Michelle Rojas`).
- `links.portalBase` — `https://wids-nyc-reading-group-assistant.vercel.app`
- `links.availability` — `<portalBase>/availability`
- `links.companionPreview` — `<portalBase><paper.companion_url>` (e.g. `<portalBase>/papers/2`). If `paper.companion_url` is null, drop the PS preview link by replacing `<a …>Preview link</a>` in the HTML body with the literal text `Preview link coming soon`, and replace the `{{ links.companionPreview }}` line in the `.txt` body with the literal text `(preview link coming soon)`.
- `deadline.soft` — derived: the upcoming Sunday evening relative to send date (e.g. `Sunday evening`).
- `stats.submittedCountWord` — `stats.submittedCount` spelled out in English title-case (`One`, `Two`, …, `Nine`, then fallback to the digit string for ≥10). Used in the bold `<strong>… of us</strong>` line.

Derived values (v2 composition rules — renderer-side, not in DB):
- `paper.authorsShort` — first 1–3 surnames from `papers.authors`, joined with `, ` and `&`. ≥4 → first surname + ` et al.`. Examples: `Zhao, Guo & Wang` · `Chen et al.`
- `paper.citation` — HTML-safe single string with optional inline `<em>`. Composed by:
  ```text
  IF papers.s2_paper_id starts with "ARXIV:":
      citation = "arXiv " + substring after "ARXIV:"
  ELSE IF papers.venue IS NOT NULL:
      citation = "in <em>" + escape(papers.venue) + "</em> (" + papers.year + ")"
  ELSE:
      citation = "(" + papers.year + ")"
  ```
  Substituted **raw** into the HTML template (no escaping) so the `<em>` renders.
- `paper.citationText` — same composition as `paper.citation` but with `<em>…</em>` stripped (plain text for the `.txt` body). Examples: `arXiv 2026.04812` · `in Mathematics (2025)` · `(2025)`.
- `paper.url` — value of `papers.url` as-is. (Note: in the v1 contract this was `paper.arxivUrl` and assumed arXiv; v2 drops that assumption.)
- `paper.location` — value of `meetings.location` as-is. **Optional.** If null, renderer must strip the `<td>` between `<!-- BEGIN-OPTIONAL-CHIP: location -->` and `<!-- END-OPTIONAL-CHIP -->` in the HTML template before substitution. No placeholder.
- `paper.duration` — `papers` has no `duration` column yet. Static fallback: `~90 min`.
- `paper.companionDropDay` — `papers` has no `companion_drop_day` column yet. Static fallback: `Wed`.
- `paper.metaLine` — plain-text meta line for the `.txt` body, composed by joining the optional/fallback values with ` · `. Skip the location piece if null. Examples:
  - location present: `Brooklyn, TBD · ~90 min · Paper Pal drops Wed`
  - location null:    `~90 min · Paper Pal drops Wed`

### 5c — Render + send per recipient

For each non-responder row:

1. Read `assets/emails/template/availability-reminder.html` and
   `assets/emails/template/availability-reminder.txt`.
2. Substitute every `{{ token }}` with the resolved value (v2 contract).
   Tokens used in both `.html` and `.txt` unless noted. "(v2 / composed)"
   tokens are NOT raw DB columns — see "Derived values" in Step 5b for
   composition rules.

   | Token | Source | Notes |
   |---|---|---|
   | `{{ recipient.firstName }}` | `split_part(members.name, ' ', 1)` | per-recipient |
   | `{{ paper.title }}` | `papers.title` | |
   | `{{ paper.authorsShort }}` | derived from `papers.authors[]` | v2 / composed |
   | `{{ paper.citation }}` | derived (s2_paper_id / venue / year) | v2 / composed · HTML-safe · **substitute raw** (no escaping — may contain `<em>`) · `.html` only |
   | `{{ paper.citationText }}` | derived (same as `paper.citation`, `<em>` stripped) | v2 / composed · `.txt` only |
   | `{{ paper.url }}` | `papers.url` | replaces v1's `paper.arxivUrl` |
   | `{{ paper.location }}` | `meetings.location` | **optional** — if null, renderer strips the `<td>` wrapped in `<!-- BEGIN-OPTIONAL-CHIP: location -->` / `<!-- END-OPTIONAL-CHIP -->` before substitution; `.html` only |
   | `{{ paper.duration }}` | static `~90 min` | column not yet in schema · `.html` only |
   | `{{ paper.companionDropDay }}` | static `Wed` | column not yet in schema · `.html` only |
   | `{{ paper.metaLine }}` | derived join of location/duration/companion-drop with ` · ` | v2 / composed · `.txt` only |
   | `{{ stats.submittedCount }}` | int from stats query | |
   | `{{ stats.submittedCountWord }}` | derived (`One`–`Nine`, then digits) | |
   | `{{ stats.totalMembers }}` | int from stats query | |
   | `{{ deadline.soft }}` | derived (next Sunday evening) | |
   | `{{ links.availability }}` | static `<portalBase>/availability` | |
   | `{{ links.companionPreview }}` | `<portalBase><paper.companion_url>` | falls back to literal `Preview link coming soon` if `paper.companion_url` is null |
   | `{{ links.portalBase }}` | static | |
   | `{{ operator.displayName }}` | static / config | |

   Tokens removed in v2 (do NOT use): `paper.arxivId`, `paper.arxivUrl`,
   `paper.slug`. Their roles are now subsumed by `paper.citation` /
   `paper.citationText` (citation), `paper.url` (canonical URL), and
   `paper.companion_url` (companion preview path).

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
