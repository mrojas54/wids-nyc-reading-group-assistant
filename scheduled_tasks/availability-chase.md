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

(Cooldown — find the most recent successful operator alert for THIS meeting.
This is a 5-day cooldown, **not** once-ever: the alert re-fires while the
meeting stays under-responded. So it keys on an exact structured
`metadata->>'meeting_id'` match (robust — no `summary LIKE` substring scan) and
keeps the `MAX(ran_at)` window. It deliberately does **not** use
`idempotency_key`, which would make the alert once-ever.)
```sql
SELECT MAX(ran_at) FROM command_log
WHERE name = 'availability-chase'
  AND status = 'success'
  AND metadata->>'kind' = 'operator_alert'
  AND metadata->>'meeting_id' = '<id>';
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
INSERT INTO command_log (source, name, status, summary, metadata)
VALUES ('scheduled_task', 'availability-chase', 'success',
        'Sent low-response alert to operator for meeting=<id>: <responded>/<total>',
        jsonb_build_object('kind', 'operator_alert', 'meeting_id', <id>,
                           'responded', <responded>, 'total', <total>));
```
(No `idempotency_key` here — the cooldown above intentionally permits a repeat
alert after 5 days. The `meeting_id`/`kind` live in `metadata` so the Step-2
cooldown query can find this row by an exact match.)

## Step 5 — Operator 'remind' follow-up (member-facing send)

Triggered when the operator replies `remind` (with optional `subject="..."`
override) to the alert email from Step 3. Splits active members into two
buckets by submission status and sends a different template to each
(mirrors the same split-send pattern as
`scheduled_tasks/pre-meeting-reminder.md` Steps 4a/4b).

- **Submitters** — active members WITH an `availability` row for this
  meeting → `assets/emails/template/rsvp-confirmation.{html,txt}`
  (Step 5e: full thank-you with paper card, haiku, accomplishments list,
  and Michelle & Claudia signoff). The lede does NOT reference a
  scheduled date, so this template works pre-scheduling as well as
  post-scheduling.
- **Non-submitters** — active members WITHOUT an `availability` row →
  `assets/emails/template/availability-reminder.{html,txt}` (Step 5c:
  the existing nudge with the magenta CTA).

Both sends use the operator's Gmail via the Gmail MCP, multipart with
the rendered HTML + plain-text bodies.

### 5a — Resolve subject

Default subject: `We need you now more than ever — to have dinner with us`

If the operator's reply included `subject="<text>"`, use that instead.
Acceptable alternates the operator may type back if they want a different
register:
- `Don't miss the deadline for the next salon`
- `Your availability for the next reading group`
- `The Round Table needs a date — when can you make it?`

### 5b — Resolve per-cycle merge data

The two buckets share the same meeting/paper merge data; only the
recipient query differs. Run both recipient queries in the same
transaction so submitter/non-submitter sets are disjoint and complete.

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

-- Non-submitters (reminder bucket — Step 5c). One email per row.
-- members.name is a single column; split on space for first_name.
SELECT mb.id,
       mb.email,
       split_part(mb.name, ' ', 1) AS first_name
FROM members mb
WHERE mb.active = true
  AND NOT EXISTS (
        SELECT 1 FROM availability a
        WHERE a.meeting_id = <meeting_id> AND a.member_id = mb.id);

-- Submitters (thank-you bucket — Step 5e). One email per row.
SELECT mb.id,
       mb.email,
       split_part(mb.name, ' ', 1) AS first_name
FROM members mb
WHERE mb.active = true
  AND EXISTS (
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
- `quote.text` / `quote.by` / `quote.role` — a rotating women-in-STEM quote resolved via `scripts/quotes.py`: set `date_key` = whole days since 1970-01-01 UTC for the send date, then `quote_tokens(select_quote(load_bundle(), date_key))`. Optional with a built-in fallback (seed Grace Hopper quote), so an empty/missing pool never blocks a send. Used by BOTH buckets (reminder 5c, thank-you 5e).

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

### 5c — Render + send the REMINDER per non-submitter

For each non-submitter row:

1. Read `assets/emails/template/availability-reminder.html` and
   `assets/emails/template/availability-reminder.txt`.
1a. Resolve the **paper / paper_pending block pair** before anything else —
   the same call in both bodies, so they cannot disagree:

   ```python
   from scripts.render_email_previews import resolve_blocks
   has_paper = meeting["paper_id"] is not None
   body = resolve_blocks(body, ext, {"paper": has_paper, "paper_pending": not has_paper})
   ```

   `paper` is the card, the "Skim the paper first" link and the Paper Pal
   PS; `paper_pending` is the "Paper Pal coming soon" card and PS that ship
   in their place while the leader is still choosing (a reading_group in
   prep with `paper_id IS NULL`). In the pending state **skip every
   `paper.*` token and `links.companionPreview`** — the block references
   none of them, and `render_pair()` refuses to ship a body with a marker
   left in it. Preview both states with
   `uv run python -m scripts.render_email_previews`: the pending one is
   written to `availability-reminder--paper-pending_rendered.{html,txt}`.
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
   | `{{ quote.text }}` | rotating pool via `scripts/quotes.py` (Step 5b) | optional — fallback Grace Hopper |
   | `{{ quote.by }}` | author name from the same selection | optional |
   | `{{ quote.role }}` | author role from the same selection | optional |

   In the `paper_pending` state only the non-paper rows above are resolved:
   `recipient.firstName`, `stats.*`, `deadline.soft`, `links.availability`,
   `links.portalBase`, `operator.displayName`, `quote.*` (plus the `cta.*`
   skeleton tokens). Run the meeting/paper query in Step 5b anyway — it is
   what tells you which state you are in.

   Tokens removed in v2 (do NOT use): `paper.arxivId`, `paper.arxivUrl`,
   `paper.slug`. Their roles are now subsumed by `paper.citation` /
   `paper.citationText` (citation), `paper.url` (canonical URL), and
   `paper.companion_url` (companion preview path).

3. Idempotency check — skip this recipient if a prior reminder for this
   `meeting × member` is already logged. Keys on the exact `idempotency_key`
   written in step 5 (no brittle `summary LIKE` scan). The
   `command_log_idempotency_key_unique` index is the race backstop: if two runs
   overlap, the second step-5 INSERT trips a unique violation (SQLSTATE 23505) —
   treat that as "already sent" and move on.

   ```sql
   SELECT 1 FROM command_log
   WHERE idempotency_key = 'availability-chase:meeting=<meeting_id>:member=<member_id>'
   LIMIT 1;
   ```

4. Create a **Gmail draft** per member via the Gmail MCP `create_draft`.
   Single recipient per draft (no bcc fan-out — each member gets a
   personalised body). Include **both** the rendered HTML body and the
   rendered plain-text body so clients that strip HTML still read correctly
   (handoff acceptance criterion #2).

   **You cannot send it. The operator has to.** The Gmail MCP exposes no send
   tool of any kind — see `.claude/commands/wids-add-member.md` Step 6 for the
   full capability limit. An earlier version of this step read "Send via Gmail
   MCP", which was unfollowable as written.

   **The connector strips the mark and every other image at draft creation**
   (verified 2026-09-02 — `docs/runbooks/email-client-behavior.md`). It also
   drops `<style>`, `<svg>`, classes and Outlook conditionals, and rewrites
   hrefs through `google.com/url`. The table layout, inline styles and copy
   survive, so the draft is still the designed email minus its images. Tell
   the operator in the Step 5d summary that the mark is absent, so they can
   paste the PNG into the compose window before sending if they want it.

5. Log:

   ```sql
   INSERT INTO command_log (source, name, status, summary, idempotency_key, metadata)
   VALUES ('scheduled_task', 'availability-chase', 'success',
           format('Sent reminder meeting=%s member=%s to=%s',
                  <meeting_id>, <member_id>, $wids$<email>$wids$),
           format('availability-chase:meeting=%s:member=%s',
                  <meeting_id>, <member_id>),
           jsonb_build_object('kind', 'member_reminder', 'meeting_id', <meeting_id>,
                              'member_id', <member_id>, 'email', $wids$<email>$wids$));
   ```

### 5d — Confirm back to operator

After both per-recipient loops finish (Step 5c reminders, Step 5e
thank-yous), send a single summary email to the operator:
`Sent <R> reminders + <T> thank-yous for <meeting_type> meeting #<id>`
plus the two recipient first-name lists, separated. No HTML — plain
text is fine for this confirmation.

### 5e — Render + send the THANK-YOU per submitter

For each submitter row:

1. Read `assets/emails/template/rsvp-confirmation.html` and
   `assets/emails/template/rsvp-confirmation.txt`.
2. Substitute every `{{ token }}` with the resolved value from Step 5b.
   The rsvp-confirmation template uses these tokens:

   | Token | Source | Used in | Required? |
   |---|---|---|---|
   | `{{ recipient.firstName }}` | per-recipient | both | ✓ |
   | `{{ paper.title }}` | `papers.title` | both | ✓ |
   | `{{ paper.authorsShort }}` | derived (Step 5b) | both | ✓ |
   | `{{ paper.companionUrl }}` | `<portalBase><paper.companion_url>` | both | ✓ |
   | `{{ links.calendar }}` | meeting ICS URL (or `<portalBase>/events/<id>/cal.ics` placeholder if not scheduled yet) | both | ✓ |
   | `{{ links.rsvpManage }}` | `<portalBase>/me/rsvps` | both | ✓ |
   | `{{ links.portalBase }}` | static | both | ✓ |
   | `{{ haiku.line1 }}` / `{{ haiku.line2 }}` / `{{ haiku.line3 }}` | rotated pool (see template README) | both | optional — fall back to haiku[0] |
   | `{{ quote.text }}` / `{{ quote.by }}` / `{{ quote.role }}` | rotating pool via `scripts/quotes.py` (Step 5b) | both | optional — fallback Grace Hopper |

   Tokens NOT used by rsvp-confirmation (do not need to resolve for this
   bucket): `event.dateLine` (removed — lede is date-agnostic),
   `paper.citation` / `paper.citationText`, `paper.url`, `paper.location`,
   `paper.duration`, `paper.companionDropDay`, `paper.metaLine`,
   `links.availability`, `links.companionPreview`, `operator.displayName`,
   `stats.*`, `deadline.soft`.

3. Idempotency check — skip this recipient if a prior thank-you for this
   `meeting × member` is already logged. Keys on the exact `idempotency_key`
   written in step 5 (no brittle `summary LIKE` scan). The
   `command_log_idempotency_key_unique` index is the race backstop: if two runs
   overlap, the second step-5 INSERT trips a unique violation (SQLSTATE 23505) —
   treat that as "already sent" and move on. The `:thanks:` segment keeps this
   key disjoint from the reminder key (`availability-chase:meeting=…:member=…`)
   so a member who flips buckets between runs is tracked once per bucket, never
   deduped across both.

   ```sql
   SELECT 1 FROM command_log
   WHERE idempotency_key = 'availability-chase:thanks:meeting=<meeting_id>:member=<member_id>'
   LIMIT 1;
   ```

4. Create a **Gmail draft** via the Gmail MCP `create_draft` — multipart
   (HTML + plain-text), single recipient per draft. The operator sends it;
   the MCP has no send tool. Default subject: `You're in — thanks for the
   RSVP`. The
   operator's `subject="..."` override from Step 3 applies ONLY to the
   reminder bucket (Step 5c); the thank-you keeps its fixed subject so
   submitters don't get re-pinged with reminder-style urgency wording.

5. Log:

   ```sql
   INSERT INTO command_log (source, name, status, summary, idempotency_key, metadata)
   VALUES ('scheduled_task', 'availability-chase', 'success',
           format('Sent thanks meeting=%s member=%s to=%s',
                  <meeting_id>, <member_id>, $wids$<email>$wids$),
           format('availability-chase:thanks:meeting=%s:member=%s',
                  <meeting_id>, <member_id>),
           jsonb_build_object('kind', 'member_thanks', 'meeting_id', <meeting_id>,
                              'member_id', <member_id>, 'email', $wids$<email>$wids$));
   ```
