---
schedule: weekly
description: Nudge operator only if nothing is on the books AND no meetup in 3+ months
---

# scheduled_tasks/cycle-keep-alive

Runs weekly (Mon). Notifies the operator only when the group is genuinely
dormant: nothing on the books **and** no meetup — reading group or admin — in
3+ months.

The bar is deliberately high. A month or two of quiet is a normal summer, not a
stall, and a nudge that fires every 28 days trains the operator to ignore it.
Both gates must pass before an email goes out.

> **Note (migration 002):** This task is operator-facing only — it nudges the operator to restart a stalled cycle and never emails members. Member-facing availability collection moved from Google Forms to the portal at `https://wids-nyc-reading-group-assistant.vercel.app/availability` (see `availability-chase` for that path); this task is unaffected by the cutover.

## Step 1 — When did the group last actually meet

An admin meeting counts as a meetup: the group convened, so it isn't dormant.

```sql
SELECT MAX(scheduled_at) FILTER (WHERE type IN ('reading_group','admin')) AS last_meetup,
       MAX(scheduled_at) FILTER (WHERE type = 'reading_group')            AS last_rg
FROM meetings WHERE status='done';
```

## Step 2 — Is anything on the books?

A `prep` row with no `scheduled_at` that has sat untouched for 21+ days is
**stalled, not in flight** — it must not suppress the nudge, or a cycle that
died at the planning stage silences this task forever.

```sql
SELECT count(*) AS on_the_books FROM meetings
WHERE type IN ('admin','reading_group')
  AND (status='scheduled'
       OR (status='prep' AND (scheduled_at IS NOT NULL
                              OR created_at > now() - interval '21 days')));
```

## Step 3 — Decide (nudge only if BOTH gates pass)

- `last_meetup` IS NULL AND `on_the_books` = 0 → kickoff state, don't nag.
  Log `no_action` with `reason='kickoff'`. Exit.
- `on_the_books` > 0 → log `no_action` with `reason='on_the_books_nonzero'`. Exit.
- `last_meetup` >= `now() - interval '3 months'` → log `no_action` with
  `reason='met_within_3_months'`. Exit.
- `on_the_books` = 0 AND `last_meetup` < `now() - interval '3 months'` →
  continue to Step 3.5.

## Step 3.5 — Idempotency (checks weekly, nudges at most every 28 days)

```sql
SELECT MAX(ran_at) FROM command_log
WHERE name='cycle-keep-alive' AND status='success' AND summary LIKE '%Sent nudge%';
```

If that is newer than `now() - interval '28 days'`, log `no_action` with
`reason='nudge_within_28_days'` and exit.

## Step 4 — Send nudge email

Recipient: operator (`SELECT name, email FROM members WHERE role='operator'`)

Subject: "WiDS NYC: time to start the next cycle?"

Body:
```
Hi <operator_name>,

The last WiDS NYC meetup was on <last_meetup date>, about <N> months ago, and
there's nothing on the calendar right now.

If you'd like to start the next cycle, run `/wids-meeting-start admin` in
Claude Code. No reply needed — if you're just taking a break, ignore this and
I'll check again in four weeks.
```

Do **not** promise a reply-based snooze. Nothing reads replies to this address;
the 28-day cap in Step 3.5 *is* the snooze.

## Step 5 — Log

```sql
INSERT INTO command_log (source, name, status, summary, metadata)
VALUES ('scheduled_task', 'cycle-keep-alive', 'success', '<summary>',
        jsonb_build_object('last_meetup', <last_meetup>, 'months_since_last_meetup', <n>,
                           'on_the_books', <count>, 'decision', '<nudged|no_action>',
                           'reason', '<kickoff|on_the_books_nonzero|met_within_3_months|nudge_within_28_days>',
                           'emails_sent', <0|1>));
```

Every `no_action` exit in Step 3 and Step 3.5 logs the same shape with
`status='no_action'`, `decision='no_action'`, `emails_sent=0`, and the `reason`
naming which gate bailed.

`metadata` is `jsonb NOT NULL DEFAULT '{}'::jsonb` (migration 020) — omitting it
writes an empty object instead of failing, which costs the operator the ability
to see *why* a run took no action.
