---
schedule: daily
description: Draft logistics reminders to active members for any meeting inside the next 3 days
---

# scheduled_tasks/pre-meeting-reminder

Runs daily. For any meeting `status='scheduled'` inside the next 3 days, drafts
the logistics email to active members and hands the send to the operator.

See [`docs/pre-meeting-reminder-flow.md`](../docs/pre-meeting-reminder-flow.md)
for the current live path, idempotency notes, and the deferred cutover
checklist for `assets/emails/template/pre-meeting-reminder.{html,txt}`.

## Delivery model — read this before Step 4

**This task drafts. It does not send. The operator sends.**

The Gmail MCP exposes `create_draft`, `update_draft`, `list_drafts`,
`get_message`, `get_thread`, `search_threads`, and the label tools — and **no
send tool of any kind**. That is a hard capability limit, not a safety pause.
`.claude/commands/wids-add-member.md` Step 6 states it correctly, and
`availability-chase` Step 5c is the reference implementation this task mirrors.

Until 2026-08-12 this spec said "Send via Gmail MCP" in Steps 4a and 4b. That
instruction was unfollowable, and the cost was not theoretical:

> On 2026-08-11 the run for meeting 37 matched the window, rendered all 8
> emails correctly, and could only create drafts. It logged `status='failure'`
> with `emails_sent=0` **and still claimed the meeting's idempotency key**. By
> the next run the meeting had dropped below the old 48-hour window floor, so
> it could never re-enter the window, and the claimed key would have skipped it
> anyway. 8 members were never reminded about a meeting 2 days out. The drafts
> sat unsent in the operator's mailbox.

So: **a created draft is a successful outcome for this task**, logged
`status='success'` with `delivery_mode='draft'`. The run is not finished when
the drafts exist — it is finished after Step 6 tells a human to send them.

Three rules follow, and they are what keep the failure above from repeating:

1. **Never log `status='failure'` merely because nothing was sent.** Nothing is
   ever sent by this task. Reserve `failure` for a genuine error: the venue
   gate holding a send, `create_draft` erroring, a required token unresolved.
2. **Never claim an idempotency key for work that did not happen.** A key is
   claimed per recipient, only after that recipient's draft is confirmed
   created. Every other outcome writes a **keyless** row so the next daily run
   retries. See Step 2.
3. **A held or failed meeting must still be reachable tomorrow.** That is why
   Step 1 has no lower window bound — see the note there.

## Step 1 — Find meetings inside the next 3 days

```sql
SELECT m.id, m.type, m.scheduled_at, m.location, m.paper_id,
       m.calendar_event_id, m.calendar_html_link,
       p.title AS paper_title,
       p.authors AS paper_authors,
       p.companion_url AS paper_companion_url,
       leader.name AS leader_name
FROM meetings m
LEFT JOIN papers p ON p.id = m.paper_id
LEFT JOIN members leader ON leader.id = m.leader_id
WHERE m.status='scheduled'
  AND m.scheduled_at >  now()
  AND m.scheduled_at <  now() + interval '3 days';
```

`calendar_event_id` / `calendar_html_link` arrive with migration 028. If the
columns do not exist yet, drop them from the select list and use the fallback
described in Step 4a.

**There is deliberately no `>= now() + interval '2 days'` floor.** The old
window was `[2 days, 3 days)`, which gave every meeting exactly **one** run
inside the window — one chance, no retry. A meeting that entered the window
during a run that failed, was skipped, or fired off its usual time could never
re-enter it. That is precisely how meeting 37 was lost: a 04:47Z run caught it
at 65.7h, and by the 02:39Z run the next day it was 43.9h out and permanently
below the floor.

Dropping the floor does not change the happy path — a meeting is still first
caught on the same run it always was, 2 to 3 days out, because that is the
first day it falls under the 3-day ceiling. What it adds is that a meeting
missed at 65h is caught again at 41h, and again at 17h. **A late reminder beats
no reminder**, and per-recipient idempotency (Step 2) is what stops the retry
from becoming a duplicate.

## Step 1b — Venue freshness gate

`meeting.location` is rendered straight into the reminder subject and body
(Step 4b below, and `{{ meeting.location }}` in
`assets/emails/template/pre-meeting-reminder.{html,txt}`). If the row is stale,
this task is what puts the wrong address in a member's inbox — that is exactly
what nearly happened on 2026-08-11 for meeting 37. `calendar-rsvp-sync` Step 4b
detects venue drift daily, but detection alone does not stop a send, so
re-check here, live, immediately before building any recipient list.

Skip this step for admin meetings (no venue) and for meetings with
`location IS NULL` on both sides.

Find the meeting's Calendar event the same way `calendar-rsvp-sync` Step 2
does — by `calendar_event_id` when it is set, falling back to the
`list_events` date-range + `WiDS NYC%` title search for pre-028 rows — then run
the same comparison `calendar-rsvp-sync` Step 4b runs. Do not normalize the
strings by hand — both tasks must reach the same verdict, or a venue one calls
in-sync and the other calls drift holds every reminder forever:

```python
from scripts.venue_keys import classify

result = classify(meeting_location, calendar_location)
```

`result.classification` of `in_sync` or `cosmetic` → proceed. Google rewrites
the venue *name* whenever the operator edits the event, so a name-only
difference on an unchanged street address is expected and is not a reason to
hold a send.

**`material` or `material_db_newer`, or no matching Calendar event was found →
do not draft for this meeting.** Do not write to `meetings` either; resolving
the disagreement is the operator's call. Log and move on to the next meeting —
other meetings in this run are unaffected:

```sql
INSERT INTO command_log (source, name, status, summary, metadata)
VALUES ('scheduled_task', 'pre-meeting-reminder', 'failure',
        'meeting=<id>: reminder held — venue mismatch, DB "<db_location>" vs Calendar "<calendar_location>"',
        jsonb_build_object(
          'event',             'venue_drift',
          'classification',    '<result.classification or "event_not_found">',
          'meeting_id',        <id>,
          'calendar_event_id', '<event_id or null>',
          'db_location',       '<db_location>',
          'calendar_location', '<calendar_location or null>',
          'send_held',         true,
          'recipients_held',   <count that would have been drafted>
        ));
```

`material_db_newer` holds the send too, even though it means the database is
the newer write. `calendar-rsvp-sync` suppresses its *alert* in that case,
having assumed the operator resolved it — but the invite the attendees are
holding still says something else, and emailing a venue that contradicts it is the
confusion this gate exists to prevent. Holding here is the backstop for
exactly the case the sync decided to stay quiet about.

Write **no** `idempotency_key` on this row, and write no per-recipient rows for
this meeting — nothing was drafted, so every recipient must stay eligible for
the next daily run once the venue is resolved. This is rule 2 of the delivery
model, and Step 1's open-ended window is what makes that next run actually
reach this meeting.

Then draft the operator an email (`SELECT email, name FROM members WHERE
role='operator'`) with subject `WiDS NYC: reminder held for meeting <id> —
venue mismatch`, quoting both values, the `<count>` of members waiting, the
meeting date, and the note that the reminder re-drafts automatically on the next
daily run once the two sides agree. Fold this draft into the Step 6 handoff so
the operator gets one notification, not two. Resolution steps are in
[`docs/venue-drift.md`](../docs/venue-drift.md).

## Step 2 — Check idempotency (per recipient, not per meeting)

Keys are **per recipient**, mirroring `availability-chase` Step 5c. The old
meeting-level key `pre-meeting-reminder:meeting=<id>` was all-or-nothing: one
recipient failing marked the whole meeting done, and — because the failure path
claimed it too — a meeting that was never drafted at all could be marked done
forever. Per-recipient keys mean a partial run retries exactly the recipients it
missed, with no duplicate drafts for the ones it reached.

Two disjoint key shapes, one per bucket, so a member who flips RSVP status
between runs is tracked once per bucket and never deduped across both:

```text
pre-meeting-reminder:meeting=<id>:member=<member_id>          -- plain reminder (Step 4b)
pre-meeting-reminder:thanks:meeting=<id>:member=<member_id>   -- RSVP thank-you (Step 4a)
```

**Legacy meeting-level guard — check this first.** Rows written before
2026-08-12 carry the old meeting-level key. Treat its presence as "this meeting
was already handled under the old scheme" and skip the meeting entirely:

```sql
SELECT 1 FROM command_log
WHERE idempotency_key = 'pre-meeting-reminder:meeting=<id>'
LIMIT 1;
```

Without this guard, meeting 37 — whose 8 drafts already exist — would be
re-drafted under the new per-recipient keys, putting 16 drafts in the operator's
mailbox. Remove this guard after 2026-09-30, by which time no meeting predating
the cutover can still be in a 3-day window.

Then, for each recipient in Step 3, skip that recipient if their bucket's key
already exists:

```sql
SELECT 1 FROM command_log
WHERE idempotency_key = '<the bucket key above>'
LIMIT 1;
```

If every recipient for a meeting is already keyed, skip the meeting — do not
write a row for it. The `command_log_idempotency_key_unique` index is the race
backstop: if two runs overlap, the second Step-5 INSERT trips a unique
violation (SQLSTATE 23505) — treat that as already-drafted, not as an error.

## Step 3 — Build recipient list (split by RSVP status)

Active members who RSVP'd **attending** get the templated thank-you
(`assets/emails/template/rsvp-confirmation.{html,txt}`). Everyone else who
hasn't already declined gets the plain reminder. Declined members are
skipped entirely — they already gave their answer.

```sql
SELECT mem.id AS member_id, mem.email, mem.name, ma.rsvp_status
FROM meeting_attendance ma
JOIN members mem ON mem.id = ma.member_id
WHERE ma.meeting_id = <id>
  AND mem.active = true
  AND ma.rsvp_status IN ('attending', 'tentative', 'no_response');
```

Partition the result:
- **Thank-you bucket:** `rsvp_status = 'attending'` → Step 4a
- **Reminder bucket:** `rsvp_status IN ('tentative', 'no_response')` → Step 4b

## Step 4a — Draft RSVP thank-you (attending bucket)

Reading-group meetings only — skip this branch for admin meetings (use the
plain reminder for those regardless of RSVP status).

Render `assets/emails/template/rsvp-confirmation.html` (and the matching
`.txt` as the multipart alternative). Required tokens — do not create the draft
if any are unresolved:

| Token | Source |
|---|---|
| `recipient.firstName` | `members.name` (first token) |
| `links.calendar` | `meetings.calendar_html_link` (see below) |
| `paper.title` | `papers.title` |
| `paper.authorsShort` | derived from `papers.authors[]` (see availability-chase.md Step 5b) |
| `paper.companionUrl` | `<portalBase><paper_companion_url>` (for example, `<portalBase>/papers/2`; refuse or omit if null) |
| `links.rsvpManage` | `<portal>/me/rsvps` |
| `links.portalBase` | `https://planner.widsnyc.org` (or env override) |

**`links.calendar`:** read `meetings.calendar_html_link`, written at booking
time by `/wids-schedule-reading-group` (migration 028). Earlier versions of this
table named `meetings.calendar_ics_url`, **a column that has never existed in
this schema** — the token had no source at all. For pre-028 rows the column is
NULL and not backfillable; resolve the event via the Step 1b fallback search and
use its `htmlLink`. If it still cannot be resolved, do **not** draft this
template with a broken link — downgrade that recipient to the Step 4b plain
reminder and count them in `calendar_link_unresolved` in Step 5.

Rotated tokens: `haiku.line1/2/3` still follow the haiku pool in this
template's README. `quote.text` / `quote.by` / `quote.role` are resolved from
the women-in-STEM pool via `scripts/quotes.py` — set `date_key` = whole days
since 1970-01-01 UTC for the send date, then
`quote_tokens(select_quote(load_bundle(), date_key))`. Optional with a built-in
fallback (seed Grace Hopper quote).

Subject: `You're in — thanks for the RSVP`

Create a **Gmail draft** per recipient via `create_draft` — multipart (both the
rendered HTML and plain-text bodies), single recipient per draft, no bcc
fan-out. **You cannot send it. The operator has to** — see the delivery model
above. Do not tell the operator to reply `send`; that offer cannot be honoured.

Record each draft's returned id — Step 6 needs it.

## Step 4b — Draft plain reminder (tentative + no_response bucket, and all admin meetings)

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

Read it with Paper Pal: <portalBase><paper_companion_url>

— "<quote.text>" — <quote.by>, <quote.role>
```

Omit the Paper Pal line if `companion_url IS NULL`. The old copy said to ask the
leader for a "discussion guide" — that flow is deprecated (superseded by Paper
Pal); link the companion instead.

Create a **Gmail draft** per recipient via `create_draft`, single recipient per
draft. Same capability limit as 4a: the operator sends. Record each draft id.

## Step 5 — Log, one row per drafted recipient

`command_log.metadata` is `jsonb NOT NULL DEFAULT '{}'::jsonb` (migration
`020_command_log_enrichment.sql:33`) — an insert omitting it succeeds and stores
`{}`. **Supply it anyway on every path**: the default is a well-formed empty
object, not the context a future run or the `/admin/logs` triage page needs. An
earlier version of this spec claimed the column had NO DEFAULT and that omitting
it FAILS; that was wrong on both counts.

One row per recipient, written **only after that recipient's draft is confirmed
created**, carrying that recipient's bucket key:

```sql
INSERT INTO command_log (source, name, status, summary, idempotency_key, metadata)
VALUES ('scheduled_task', 'pre-meeting-reminder', 'success',
        'Drafted <bucket> meeting=<id> member=<member_id> to=<email>',
        '<the bucket key from Step 2>',
        jsonb_build_object('kind', '<reminder|thanks>', 'meeting_id', <id>,
                           'member_id', <member_id>, 'email', '<email>',
                           'delivery_mode', 'draft',
                           'gmail_draft_id', '<draft_id>',
                           'operator_action_required', true));
```

`delivery_mode='draft'` is the field that makes this row honest: it records that
a message was composed and queued for a human, not delivered.
`operator_action_required` is greppable — `/admin/logs` filters on `metadata`
(see [`docs/admin-logs.md`](../docs/admin-logs.md)) — so pending sends can be
listed without opening Gmail.

If `create_draft` errors for a recipient, write a **keyless** `failure` row for
that recipient and continue with the rest. No key means tomorrow's run retries
that recipient and only that recipient.

If no meetings qualify, log ONE `no_action` row, `idempotency_key` NULL (no
meeting to key on):

```sql
INSERT INTO command_log (source, name, status, summary, metadata)
VALUES ('scheduled_task', 'pre-meeting-reminder', 'no_action',
        'No meetings inside the next 3 days',
        jsonb_build_object('window_matches', 0, 'drafts_created', 0,
                           'reason', 'no_meetings_in_window'));
```

## Step 6 — Hand the send off to the operator

**The run is not done when the drafts exist.** Drafts nobody is told about are
what turned meeting 37 into 8 members who never heard from us. This step is the
difference between "the task succeeded" and "the members were reminded".

After all per-recipient loops finish, create **one** summary draft to the
operator (`SELECT email, name FROM members WHERE role='operator'`). Plain text
is fine.

```
Subject: WiDS NYC: <N> reminder drafts ready to send — meeting #<id>, <when>

<N> drafts are sitting in your Drafts folder for the <type> meeting on
<scheduled_at>. They are not sent. Open each one and send it.

Send by: <scheduled_at minus 24h> so people still have a day's notice.

Thank-yous (<T>):
  <first name> — <email> — draft <draft_id>
  ...

Reminders (<R>):
  <first name> — <email> — draft <draft_id>
  ...

<If Step 1b held any meeting, list it here with the venue mismatch and what to
resolve — one notification, not two.>
```

Then state the same thing in the run's own output, so an operator reading the
task log rather than their mailbox sees it too: the count, the meeting, the
deadline, and that the drafts are unsent.

**Known limitation, worth fixing next:** this notification is itself a draft in
the operator's own mailbox, which is a weak channel for "you must act" — and
because these rows log `status='success'`, `/admin/logs` renders them as `info`
(green), not as something demanding attention. The clean fix is a migration
widening the `command_log.status` CHECK — today `('success','failure',
'no_action')` from `001_initial_schema.sql:101` — to add `needs_action`, mapped
to `warn` in the logs UI's severity derivation. Until then,
`metadata.operator_action_required` is the filterable signal.

The permanent fix for the whole class of problem is a real send path: a Gmail
MCP with send scope, or an SMTP/Resend sender invoked directly by this task.
Both need the operator to authorize new scopes — Composio's Gmail toolkit is
catalogued but **not linked** (`composio connections list` shows only
`discord`, `eventbrite`, `firecrawl`, `github`, `supabase`), so
`GMAIL_SEND_EMAIL` is not reachable today. Resend is already a project
dependency for auth email
([`docs/runbooks/smtp-auth-setup.md`](../docs/runbooks/smtp-auth-setup.md)) and
is the shortest path if the operator wants automated sending.
