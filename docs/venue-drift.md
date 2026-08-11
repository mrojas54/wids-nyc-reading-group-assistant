# Venue drift: Calendar `location` vs `meetings.location`

Canonical reference for how the Google Calendar event's `location` is compared
against `meetings.location`, what the comparison is allowed to write, and how
the operator resolves a disagreement.

Implementation: [`scripts/venue_keys.py`](../scripts/venue_keys.py), tested by
[`tests/venue_keys_test.py`](../tests/venue_keys_test.py).

Consumers, both of which call `classify()` rather than normalizing by hand:

- [`scheduled_tasks/calendar-rsvp-sync.md`](../scheduled_tasks/calendar-rsvp-sync.md)
  Step 4b — the daily detector.
- [`scheduled_tasks/pre-meeting-reminder.md`](../scheduled_tasks/pre-meeting-reminder.md)
  Step 1b — the pre-send gate, the last thing standing between a stale venue
  and a member's inbox.

One tested function rather than a recipe each task re-derives at runtime: the
two must agree on every pair of strings, because a venue the sync calls in-sync
and the gate calls drift would hold every reminder forever.

This file is the long form — worked examples, rationale, and the resolution
workflow.

## The incident this exists for

2026-08-10T22:10:11Z, the operator changed meeting 37's venue on Google
Calendar (event `kpkh9gfid19m5kbm4bf4tlgdus`) from Jack's Wife Freda to Prince
Tea House. `calendar-rsvp-sync` had run at 21:57:50Z and every later run
ignored the change — it only ever reconciled RSVPs and `scheduled_at`.
`meetings.location` sat stale at `Jack's Wife Freda - Soho, 226 Lafayette St,
New York, NY 10012` while the invite all 9 attendees held said Prince Tea
House. The `pre-meeting-reminder` run on 2026-08-11 caught it only because that
run happened to cross-check the calendar by hand; without that, 4 members get
an email naming the wrong restaurant. The row was corrected manually.

Two separate defects, fixed separately:

1. Nothing detected the drift → `calendar-rsvp-sync` Step 4b.
2. Nothing stopped the bad send once drift existed → `pre-meeting-reminder`
   Step 1b.

## Why the strings never match literally

Both sides start life as the same string: `/wids-schedule-reading-group` Step 4
prompts the operator for free-text venue and writes it to *both*
`meetings.location` and the Calendar event's Location field. They diverge later,
and they diverge in a specific way.

The house convention in the database is

```
<Name> - <Neighborhood>, <Street>, <City>, <State> <Zip>
Prince Tea House - Ktown, 324 5th Ave, New York, NY 10001
```

When the operator edits the venue in Google Calendar's UI, they pick a place
from autocomplete and Google replaces the text with its own place record:

```
Prince Tea House Ktown | Dessert Spot at Fifth Ave, 324 5th Ave, New York, NY 10001, USA
```

Same venue, same street address, four differences: a `|` tagline, no ` - `
before the neighborhood, a trailing `, USA`, and a place name Google chose. A
literal `!=` fires on all of that. So the comparison normalizes, and it
normalizes the two halves separately, because they carry different weight.

## Building the keys

From one location string, build a **name key** and an **address key**.

1. Trim; collapse runs of whitespace to a single space.
2. Split on `,`; trim each field; drop empty fields; drop a trailing field of
   `USA`, `US`, or `United States`.
3. **name key** — field 0, truncated at the first `|` if present; lowercased;
   every character outside `[a-z0-9 ]` removed (this is what disposes of `-`,
   `–`, `'`, `.`); whitespace collapsed.
4. **address key** — the remaining fields joined with a single space;
   lowercased; punctuation stripped the same way; then per token:
   `avenue→ave`, `street→st`, `road→rd`, `boulevard→blvd`, `drive→dr`,
   `lane→ln`, `court→ct`, `place→pl`, `square→sq`, `terrace→ter`,
   `highway→hwy`, `parkway→pkwy`, `suite→ste`, `floor→fl`, `apartment→apt`,
   `north→n`, `south→s`, `east→e`, `west→w`; whitespace collapsed.

Unit designators are canonicalized, not dropped. A `Suite 200` on one side and
nothing on the other therefore reads as `material` and surfaces. That is a
false alarm the operator dismisses in a second; the alternative — dropping the
token and its number — mangles addresses to avoid a harmless prompt.

Both sides run through the same map, so the map is judged on consistency, not
postal fidelity: it only has to land `Avenue` and `Ave` in the same place.

Worked on the incident:

| Source | name key | address key |
|---|---|---|
| Calendar `Prince Tea House Ktown \| Dessert Spot at Fifth Ave, 324 5th Ave, New York, NY 10001, USA` | `prince tea house ktown` | `324 5th ave new york ny 10001` |
| DB, corrected `Prince Tea House - Ktown, 324 5th Ave, New York, NY 10001` | `prince tea house ktown` | `324 5th ave new york ny 10001` |
| DB, as it actually stood `Jack's Wife Freda - Soho, 226 Lafayette St, New York, NY 10012` | `jacks wife freda soho` | `226 lafayette st new york ny 10012` |

The corrected row matches on both keys. The stale row differs on both. That is
the signal.

## Classification

The **address key is the one that decides**. It is what determines where a
member physically goes, and unlike the venue name it is machine-comparable.
The name key only distinguishes "same place, Google spelled it differently"
from "same place, and we agree" — it never escalates on its own.

| `meetings.location` | Calendar `location` | address keys | name keys | class | action |
|---|---|---|---|---|---|
| empty | empty | — | — | `no_location` | nothing |
| empty | present | — | — | `backfill` | write the tidied Calendar value (single row) |
| present | empty | — | — | `calendar_missing` | never blank the database; log, do not alert |
| present | present | equal | equal | `in_sync` | nothing |
| present | present | equal | differ | `cosmetic` | no write, no alert, count it |
| present | present | differ | any | `material` | **hold the write, alert the operator** |

Fallback: if either address key comes out empty — a bare venue name with no
street address, e.g. a location that is just `Think Coffee` — the address
comparison is meaningless. Compare the two full normalized strings instead and
classify any difference as `material`. Fail toward surfacing.

## Why `material` does not auto-write

Three reasons, in order of weight.

**The correct value is not derivable.** Turning `Prince Tea House Ktown |
Dessert Spot at Fifth Ave, …, USA` into `Prince Tea House - Ktown, …` requires
knowing that "Ktown" is the neighborhood and belongs after a dash. Nothing in
Google's string says so; a rule that guessed would be guessing about the field
that gets pasted into a member-facing email. Writing Google's raw string
instead is worse — the `| Dessert Spot at Fifth Ave` tagline and the `, USA`
would render straight into the reminder.

**The database is sometimes right.** The operator may have corrected the
database on purpose and left the calendar alone, or the calendar may have been
edited by mistake. An automatic overwrite in the direction Calendar → database
assumes the calendar always wins, and it does not.

**The repo rule.** `CLAUDE.md` (untracked, repo root) requires explicit operator
confirmation for any `UPDATE` touching more than one row of `meetings`. Every
write described here is `WHERE id = <meeting_id>` and therefore one row by
construction, so the letter of the rule is satisfied — but the rule exists
because an agent silently rewrote member-facing data on a contextual signal.
Holding a venue overwrite for a human is that rule's spirit.

`backfill` is the one exception, and only because there is nothing to clobber:
a scheduled reading group with `location IS NULL` renders the reminder as "at
" regardless, so any real value is an improvement. Even then the write is
guarded (`AND location IS NULL`) and the tidied string is flagged
`house_style: false` in metadata so the operator can restyle it later.

## Which side is newer

Migration 026 adds `meetings.updated_at`, maintained by a `BEFORE UPDATE`
trigger. Before 026 is applied there is no timestamp on the meetings row at
all — `created_at` only — so the sync skips this section and treats every
`material` drift as alertable.

The comparison against the Calendar event's `updated` field is **asymmetric**:

- `meetings.updated_at > event.updated` — **strong**. The row was written after
  Google last recorded *any* change to the event, so the database is the newer
  write. Classify `material_db_newer`: still no write, and no alert either, on
  the assumption the operator already resolved this and chose the database
  value. Record it in metadata.
- `event.updated > meetings.updated_at` — **weak, and never sufficient on its
  own**. Google bumps `updated` on any event mutation, an attendee RSVP
  included, so a newer event timestamp does not establish that the *location*
  was edited on Calendar. This direction must never authorize a write.

The downgrade silences the *alert*, not the *gate*. `pre-meeting-reminder`
Step 1b holds the send on `material_db_newer` as well: the database may be the
newer write, but the invite the attendees are holding still says something
else, and mailing a venue that contradicts it is the confusion this whole
mechanism exists to prevent. The sync going quiet is precisely why the gate has
to stay loud.

## Resolving a drift

The alert email carries both values and the exact statement. The operator picks
a side:

**Calendar is right** — accept it, restyled to the house convention by hand:

```sql
UPDATE meetings
SET location = 'Prince Tea House - Ktown, 324 5th Ave, New York, NY 10001'
WHERE id = 37;
-- expect: UPDATE 1
```

**Database is right** — edit the Google Calendar event's Location back. Do not
touch the row. Attendees see the correction in their invite, which is the point.

Either way the next `calendar-rsvp-sync` run reclassifies as `in_sync` (or
`cosmetic`) and the `pre-meeting-reminder` gate opens.

## There is no drift queue

Deliberately. An unresolved drift is not stored as state anywhere — it is
recomputed from Calendar plus the database on every run, by both consumers.

The alternative, a `venue_drift` table holding open items, would need its own
RLS policies the moment it is created (the out-of-band `ensure_rls` event
trigger auto-enables RLS on every new `public` table, and a table with no
policies is invisible to the browser — see
[`migrations/README.md`](../migrations/README.md)), plus a resolution path to
close rows, plus a way to handle a row someone forgot to close. Recomputing is
cheaper and cannot go stale: if the operator fixes either side, the drift is
simply gone on the next pass, with nothing to reconcile.

`command_log` rows are the audit trail, not the queue. This query shows what
has been flagged, historically:

```sql
SELECT ran_at, summary, metadata
FROM command_log
WHERE name IN ('calendar-rsvp-sync', 'pre-meeting-reminder')
  AND metadata->>'event' = 'venue_drift'
ORDER BY ran_at DESC;
```

A row appearing here does **not** mean the drift is still open — re-run the
comparison to know that. `calendar-rsvp-sync` alerts at most once per distinct
calendar value per meeting (the `idempotency_key` carries the calendar address
key), so a drift the operator leaves unresolved does not re-mail daily; the
`pre-meeting-reminder` gate is what guarantees it cannot ship silently.
