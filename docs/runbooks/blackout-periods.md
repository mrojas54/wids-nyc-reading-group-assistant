# Blackout periods runbook

Blackout periods are operator-defined date ranges in which the group takes a
break: **no meeting may be scheduled and no member may submit availability**
inside a window. They live in the `blackout_periods` table and are enforced at
two independent points — the scheduler and the availability portal — so a
window you add is honored everywhere without a redeploy.

## Codepaths covered

| Codepath | Role |
|---|---|
| `migrations/021_blackout_periods.sql` | Creates the `blackout_periods` table and seeds the two 2026 summer-break windows. |
| `web/lib/blackout.ts` | Shared overlap helper (`isDayBlackedOut`, `blackedOutDays`, type `BlackoutPeriod`) — the single source of truth for "is this day blocked?". |
| `.claude/commands/wids-schedule-admin.md` | Scheduler Step 2 filters candidate slots with a `NOT EXISTS (… blackout_periods …)` clause. |
| `.claude/commands/wids-schedule-reading-group.md` | Inherits the same filter (reuses the admin Step-2 query). |
| `web/app/availability/page.tsx` | Server component; fetches windows via the service client and passes them to the form. |
| `web/app/availability/AvailabilityForm.tsx` → `web/components/MonthCalendar.tsx` | Greys out (disables) blacked-out days in the calendar so members cannot select them. |
| `web/app/availability/actions.ts` (`submitAvailability`) | Authoritative server-side rejection of any submitted day inside a window. |
| `tests/blackout_periods_test.sql` | psql fixture test for the scheduler filter + the `CHECK` constraint. |
| `web/lib/__tests__/blackout.test.ts`, `web/components/__tests__/MonthCalendar.blackout.test.tsx` | Unit + render coverage for the helper and the greyed calendar. |

## The one rule that bites: `range_end` is exclusive

Windows are stored as a **half-open interval `[range_start, range_end)` in
`America/New_York`**. The start is included; the end is **not**. A day is
blocked when its meeting slot overlaps the window under the test
`slot_start < range_end AND slot_end > range_start`.

Practically: **to block through the end of a day, set `range_end` to midnight
of the *next* day.** To block Aug 21 – Sep 7 inclusive, the window ends at
`2026-09-08 00:00`, not `2026-09-07`.

Always write the timezone into the literal (`'2026-09-08 00:00 America/New_York'`).
A bare timestamp is interpreted in the database session's timezone and will be
off by the UTC offset — during EDT that silently shifts every boundary by four
hours.

## Current windows (seeded by migration 021)

| id | Blocks (inclusive, ET) | `range_start` | `range_end` (exclusive) | reason |
|---|---|---|---|---|
| 1 | Jul 12 – Jul 31, 2026 | `2026-07-12 00:00 America/New_York` | `2026-08-01 00:00 America/New_York` | Summer break part 1 (Jul 12 – Jul 31, 2026) |
| 2 | Aug 21 – Sep 7, 2026 | `2026-08-21 00:00 America/New_York` | `2026-09-08 00:00 America/New_York` | Summer break part 2 (Aug 21 – Sep 7, 2026) |

The gap **Aug 1 – Aug 20, 2026 is bookable**. `id` values are assigned by the
`SERIAL` sequence; confirm them with the view query below before editing.

## Where changes take effect

No deploy or restart is needed — both enforcement points read the table live:

- **Scheduler** reads `blackout_periods` on every `/wids-schedule-admin` and
  `/wids-schedule-reading-group` run.
- **Portal** reads it on every render of `/availability` (greyed calendar) and
  on every `submitAvailability` call (server-side rejection).

So an inserted window greys the calendar on the member's next page load and is
rejected by the server action immediately.

## Managing windows

`blackout_periods` is **service-role-only**: the `ensure_rls` event trigger
enables RLS and the table intentionally has **no policies**, so the anon and
authenticated (browser) keys cannot see it — exactly like `command_log`. Manage
it from a privileged context only:

- the **Supabase SQL Editor** (runs as the table owner, bypasses RLS), or
- the **Supabase MCP** `execute_sql` / `apply_migration` tools (service role).

There is no operator UI and no slash command — window changes are direct SQL.

### View current windows

```sql
SELECT id,
       range_start AT TIME ZONE 'America/New_York' AS starts_et,
       range_end   AT TIME ZONE 'America/New_York' AS ends_et_exclusive,
       reason
FROM blackout_periods
ORDER BY range_start;
```

### Add a window

```sql
INSERT INTO blackout_periods (range_start, range_end, reason) VALUES
  ('2026-12-24 00:00 America/New_York',
   '2026-12-27 00:00 America/New_York',   -- exclusive → blocks Dec 24, 25, 26
   'Winter holiday 2026');
```

The `CHECK (range_end > range_start)` constraint rejects an inverted or
zero-length range. Overlapping windows are allowed and simply union — the
overlap test only asks whether *any* window covers a slot.

### Extend or shorten a window

Look up the `id` with the view query first, then update the boundary:

```sql
UPDATE blackout_periods
SET range_end = '2026-09-15 00:00 America/New_York'   -- now blocks through Sep 14
WHERE id = 2;
```

### Remove a window

Deleting a window immediately re-opens those dates for scheduling and
submission.

```sql
DELETE FROM blackout_periods WHERE id = 2;
```

Always include the `WHERE` clause. A `DELETE` with no `WHERE` clears **every**
window and is a destructive operation — never run it to remove a single row.

## What members and operators see

- **Member, calendar:** blacked-out days render greyed and unclickable at
  `/availability`; they cannot be added to a submission. Days already selected
  before a window was added are dropped from the initial selection, so the
  "N days selected" count matches what is actually selectable.
- **Member, direct submission:** even a crafted request that bypasses the
  calendar is rejected by `submitAvailability` with
  `These dates fall in a blackout window and can't be selected: <dates>`, and a
  `command_log` `failure` row is written (`name='submitAvailability'`).
- **Operator, scheduler:** blacked-out slots never appear as candidate windows.
  If *every* submitted slot falls inside a window, the schedule command halts
  with: "All submitted availability falls within a blackout window. No bookable
  slot — collect availability outside the blackout, or clear the relevant
  `blackout_periods` row."

## Enforcement is fail-closed where it counts

The greyed calendar is a **convenience layer**: `page.tsx` degrades gracefully
(`?? []`) if the display-only read fails, so a transient read error shows an
ungreyed calendar rather than a broken page. The **authority** is the
`submitAvailability` server action, which **fails closed** — if it cannot read
`blackout_periods`, it rejects the submission rather than letting a blacked-out
day through. Do not "harden" the page read into a throw to match; the asymmetry
is intentional.

## Troubleshooting

| Symptom | Check |
|---|---|
| A date one day past the intended end is still blocked | `range_end` is exclusive — you likely set it a day too late. To block through Sep 7, end at `Sep 8 00:00`. |
| Boundary is off by ~4 hours | The literal omitted `America/New_York` and was read in another timezone. Re-insert with the timezone in the string. |
| Calendar not greyed but scheduler still skips slots | Display-only page read likely failed (graceful `?? []`); the server action and scheduler still enforce. Check `command_log` / Supabase logs for the read error. |
| Member reports a submission rejected unexpectedly | Confirm the date really is inside a window with the view query; the server action rejects on overlap, not on exact-day equality. |
| Scheduler halts with "All submitted availability falls within a blackout window" | Expected when every submitted slot is inside a window. Collect availability outside the window, or remove/shorten the window. |
| `new row … violates check constraint` on insert | `range_end` must be strictly greater than `range_start`. |

## Local verification

Scheduler filter + `CHECK` constraint (uses far-future 2099 fixtures, wraps in a
transaction, and rolls back — no data persists):

```sh
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f tests/blackout_periods_test.sql
```

Expected final line: `blackout_periods_test: PASS`.

Portal helper + greyed calendar (from `web/`):

```sh
npm test -- blackout
```

Covers `lib/__tests__/blackout.test.ts` (overlap + boundary days) and
`components/__tests__/MonthCalendar.blackout.test.tsx` (a day inside a window
renders disabled; a bookable gap day does not).
