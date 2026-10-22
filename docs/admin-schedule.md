# /admin/schedule — scheduling the next reading group

The operator's view of the availability poll: a month calendar where each
candidate evening shows how many members are free, a hero card for the next
paper, and a details card that books the meeting. Built from the Claude
Design canvas "Schedule the next meeting" (Sep 2026) against the WiDS NYC
design system.

## Who sees it

Operator or admin only (`requireOperatorRole`, `canScheduleMeeting`). Leaders
pick papers; the date, venue and invite are the operator's call. Members are
redirected to the dashboard. The dashboard shows a "Schedule the next
meeting" link to those roles while a reading group is in prep.

## What it reads

Everything through the service client (`lib/schedule/loadPoll.ts`), because
`availability` is select-own under RLS and `members.active` sits outside the
authenticated column grant:

- The cycle's canonical `reading_group` meeting in `prep` with
  `planned_by_admin_id IS NOT NULL` — the same row `/wids-schedule-reading-group`
  Step 1 lands on, never a member's proposePaper placeholder.
- Its leader and paper (title, authors, year, url, whether a Paper Pal exists).
- The active roster, and every `availability` row for the meeting collapsed to
  its New York day.
- `blackout_periods`, so a marked evening that has since been blacked out is
  dropped from the poll.
- The last booked reading group's `location`, as the default venue.

The poll model (`lib/schedule/poll.ts`) is pure: one `CandidateDay` per marked
evening carries the free count, the free and not-free name lists and the
leader's status, so the cell, the details card and the heads-up note cannot
disagree. The leader is a member like any other — her answer is in the counts.

## Rules drawn from the design

- Heat tiers are absolute: 3 or fewer (paper), 4 to 5 (sage-50), 6
  (sage-100), 7 or more (sage-200). Counts on tinted cells use `fg-2`;
  `fg-3` fails 4.5:1 on the tints.
- Tint is reserved for evenings the leader can make. When she answered but
  did not mark an evening, the cell is paper with a dashed `paper-400` border
  and a third line "<Leader> not free". If she has not answered, nothing is
  dashed and the details card says so.
- The page opens on the most-free evening the leader can make, earliest on a
  tie (`bestCandidate`).
- Cells are real buttons with `aria-pressed` and a full label:
  `Thu, Oct 15: 7 of 8 free, Maya who leads is not free, selected`.
- Days outside the poll are plain, non-interactive and `aria-hidden`.

## What "Schedule and send invite" does

`scheduleMeeting` in `app/admin/schedule/actions.ts` makes the same row
changes as `/wids-schedule-reading-group` Step 6: `scheduled_at`, `location`,
`status='scheduled'` (guarded on `status='prep'` so a double submit is a
no-op), then a `no_response` attendance row per active member. It then calls
`createCalendarEventAndSendInvites` in `lib/schedule/invites.ts`.

**That function is a stub.** The portal has no Google Calendar client and no
email sender; today both go through the Calendar and Gmail MCPs from the
slash command. The stub returns `sent: false`, the action logs a
`needs_action` row (amber in `/admin/logs`), and the success banner tells the
operator the invite still has to go out. The row does not get
`calendar_event_id` / `calendar_html_link` until the stub is replaced — the
generated `database.types.ts` predates migration 028, so that write belongs
to the change that regenerates the types.

"Send reminder" is likewise a request, not a send: it logs a `needs_action`
row (one per meeting per day) for the availability-chase task's `remind`
mode. "Save draft" keeps the pencilled date, time and venue in this browser's
localStorage until the meeting is booked.

## Poll window and close date

The calendar pages over every month members could pick in: the day the poll
opened through the end of the following month (what `/availability` shows),
stretched to cover any later evening a late answerer marked. The "Availability
closes" date is the meeting's `created_at` plus seven days, the deadline
`/wids-meeting-start` writes into the announcement email; it is derived, not
stored.

## Tests

- `lib/schedule/__tests__/poll.test.ts` — tiering, the leader-busy rule,
  free/not-free lists agreeing with counts, the default-evening derivation,
  poll window, aria labels. Uses the design's sample poll as its fixture.
- `lib/schedule/__tests__/format.test.ts` — day keys, time parsing, labels.
- `app/admin/schedule/__tests__/SchedulePage.test.tsx` — the rendered cells,
  selection, the details card, month paging, scheduling and the empty state.
