# Blackout dates — design

**Date:** 2026-07-12
**Status:** Approved (pending spec review)
**Branch:** `claude/blackout-dates-aug-sept-b15fee`

## Goal

Keep meetings out of operator-defined "blackout" windows, enforced at **two points**:

1. **Scheduling** — the scheduler never proposes a candidate slot inside a blackout.
2. **Availability submission** — members can't submit availability inside a blackout: the
   portal calendar disables those dates, and the server action rejects any that slip through.

Two windows are needed for 2026:

| Window | Range (America/New_York) | Meaning |
|---|---|---|
| Summer gap | **Aug 21 → Sep 7, 2026** (inclusive) | Original request |
| July break | **Jul 12 → Jul 31, 2026** (inclusive) | "block today til August 1 too" |

Net bookable gap between the two windows: **Aug 1 – Aug 20, 2026**.

## Decisions (from brainstorming)

- **Recurrence:** 2026 only. Stored as concrete dated ranges, not recurring rules.
- **Enforcement:** Hard block — blacked-out slots never appear as candidate slots.
- **Scope:** Both meeting types (`admin` and `reading_group`).
- **Boundary semantics:** Half-open intervals `[range_start, range_end)`.
  - "to Sep 7" → inclusive of Sep 7 → `range_end = 2026-09-08 00:00 ET`.
  - "til August 1" → block lifts *on* Aug 1 → last blocked day is Jul 31 →
    `range_end = 2026-08-01 00:00 ET`. **Assumption flag:** if Aug 1 itself should
    be blocked, change this `range_end` to `2026-08-02 00:00 ET`.

## Why this approach

The scheduler is already data-driven: meeting dates are chosen by a single SQL query
that ranks candidate slots read from the `availability` table
([wids-schedule-admin.md](../../../.claude/commands/wids-schedule-admin.md) Step 2).
A blackout is therefore modeled as **data the query filters against**, not logic
hardcoded into the query. Adding a future break becomes one `INSERT`; removing one
is a `DELETE` — no code edit.

Alternatives rejected:

- **Hardcode the window(s) in the SQL** — dates would live in command markdown, not be
  reusable, and require editing markdown to change/remove. Fights the data-driven pattern.
- **Generic `config` key-value table** — over-general for one concept (YAGNI). A typed
  table also enforces `range_end > range_start` at the DB level.

## Data model

New migration `021_blackout_periods.sql` (number to be confirmed against remote branches
before finalizing — see Migration note):

```sql
CREATE TABLE blackout_periods (
  id          SERIAL PRIMARY KEY,
  range_start TIMESTAMPTZ NOT NULL,
  range_end   TIMESTAMPTZ NOT NULL,   -- half-open: [range_start, range_end)
  reason      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (range_end > range_start)
);
```

Conventions match `availability` (SERIAL PK, `TIMESTAMPTZ`, `CHECK (range_end > range_start)`).

**RLS:** The database's out-of-band `ensure_rls` event trigger auto-enables RLS on every
new `public` table. `blackout_periods` is operator config. Every reader is server-side —
the scheduler (Supabase MCP, service role) and the two portal readers (the availability page
and `submitAvailability`, both via `createSupabaseServiceClient()`) — so **no browser-facing
policies are added**; the table follows the same service-role-only exception `command_log`
uses. The browser never reads it directly (the page passes disabled dates down as props).
A comment in the migration documents this.

## Seed rows

Same migration inserts both windows:

```sql
INSERT INTO blackout_periods (range_start, range_end, reason) VALUES
  ('2026-07-12 00:00 America/New_York',
   '2026-08-01 00:00 America/New_York',   -- exclusive → Jul 31 last blocked, Aug 1 bookable
   'Summer break part 1 (Jul 12 – Jul 31, 2026)'),
  ('2026-08-21 00:00 America/New_York',
   '2026-09-08 00:00 America/New_York',   -- exclusive → Sep 7 last blocked, Sep 8 bookable
   'Summer break part 2 (Aug 21 – Sep 7, 2026)');
```

## Enforcement

The `slots` CTE in [wids-schedule-admin.md](../../../.claude/commands/wids-schedule-admin.md)
Step 2 gains a `NOT EXISTS` filter so any candidate slot overlapping *any* blackout period
is dropped before ranking:

```sql
WITH slots AS (
  SELECT DISTINCT av.range_start AS slot_start,
                  av.range_start + interval '90 minutes' AS slot_end
  FROM availability av
  WHERE av.meeting_id = <id>
    AND NOT EXISTS (
      SELECT 1 FROM blackout_periods bp
      WHERE av.range_start < bp.range_end
        AND av.range_start + interval '90 minutes' > bp.range_start
    )
),
overlaps AS ( ... unchanged ... )
SELECT ... unchanged ...
```

**Alias required:** `availability` must be aliased (`av`) and the correlated column
qualified as `av.range_start`. `blackout_periods` also has a `range_start` column, so an
*unqualified* `range_start` inside the subquery would bind to `blackout_periods` (innermost
scope) and drop every slot whenever any blackout row exists. The existing `overlaps` CTE
already aliases availability as `a`; `av` avoids clashing with it.

Overlap test: a slot `[av.range_start, av.range_start + 90min)` is blocked iff it overlaps a
blackout `[bp.range_start, bp.range_end)`, i.e.
`av.range_start < bp.range_end AND av.range_start + interval '90 minutes' > bp.range_start`.
A slot starting Sep 7 23:30 (ending Sep 8 01:00) is still blocked because its start is in range.

**Both meeting types covered by one edit:**
[wids-schedule-reading-group.md](../../../.claude/commands/wids-schedule-reading-group.md)
Step 2 explicitly reuses admin's Step 2 query, so the filter applies to reading groups too.
A one-line pointer will be added there noting the shared blackout filter, so the coupling
is visible and not accidentally broken.

## Availability submission guard (portal)

Members must not be able to submit availability inside a blackout window. Enforced at two
layers, both reading `blackout_periods` **server-side via the service-role client** (no RLS
policy needed):

**Calendar (client UX).** [web/app/availability/page.tsx](../../../web/app/availability/page.tsx)
(server component) fetches blackout periods via `createSupabaseServiceClient()`, computes the
set of blacked-out NY calendar dates, and passes it to `AvailabilityForm` → the month calendar,
which renders those days disabled/unselectable. The form's date list is already pruned to
today→end-of-next-month; blacked-out days within that range are simply greyed out.

**Server action (authoritative backstop).** In `submitAvailability`
([web/app/availability/actions.ts:9](../../../web/app/availability/actions.ts)), after the
member is resolved and **before the existing rows are deleted** (currently line 23), fetch
blackout periods (service client) and reject the submit if any selected day's 6–9 PM ET slot
overlaps a blackout. Ordering matters: checking before the delete means a rejected submit
leaves the member's prior availability intact. The rejection returns a clear error naming the
offending date(s), surfaced by the form.

**Shared overlap helper.** Both layers call one helper (new `web/lib/blackout.ts`,
`blackedOutDays(days, periods)`) that reuses the existing `nyDayAtHour(day, hour)` slot
construction, so the client-disable set and the server-reject decision can never diverge. The
test matches the scheduler's: a day's slot `[nyDayAtHour(day,18), nyDayAtHour(day,21))` is
blocked iff `slotStart < bp.range_end AND slotEnd > bp.range_start`.

## Failure handling / edge cases

- **All availability inside a blackout** → filtered query returns zero rows. Add a distinct
  halt message to both schedule commands:
  *"All submitted availability falls within a blackout window. No bookable slot — collect
  availability outside the blackout, or clear the relevant `blackout_periods` row."*
  This is separate from the existing "No availability collected yet" halt (which fires when
  there are no `availability` rows at all).

## Testing

New `tests/blackout_periods_test.sql`, following the existing `*_test.sql` pattern
(`tests/papers_pdfs_bucket_rls_test.sql`, `tests/pick_topic_tagging_test.sql`):

1. Seed a meeting, a set of `availability` rows with `range_start`s both inside and outside
   the blackout windows, and the two `blackout_periods` rows.
2. Run the filtered `slots` query.
3. Assert: no returned `slot_start` falls inside either blackout window; every out-of-window
   availability slot is still present.
4. Assert the `CHECK (range_end > range_start)` constraint rejects an inverted range.

**Submission guard** — unit-test the shared helper `blackedOutDays(days, periods)` in the web
app's test setup: a date inside a blackout is returned as blocked, a date in the Aug 1–20 gap
is not, and a date whose slot straddles a blackout boundary is blocked. If the web app has a
server-action test harness, add a `submitAvailability` test asserting a blacked-out submit
throws **and leaves existing rows intact** (delete-after-check ordering); otherwise the helper
unit test plus manual verification via the preview covers it. (Test harness to be confirmed
when writing the plan.)

## Non-goals

- **Manual Google-Calendar reschedules** (`scheduled_tasks/calendar-rsvp-sync.md`) are
  operator overrides that mirror a human's manual choice — they are **not** blocked.
  The blackout governs what the scheduler *proposes*, not what the operator manually books.
- **A database trigger** on `availability` is out of scope — the portal server action is the
  only write path, so submission is guarded there (calendar + server action), not at the DB
  level. Simulation/CLI scripts that write availability directly are unaffected.
- **Recurring/annual blackouts** are out of scope (decision: 2026 only).

## Migration note

Migrations are hand-applied in numeric order; filenames define order (there is no
migration-tracking table). Before finalizing the `021` filename, verify no remote branch has
already claimed `021` (`git ls-remote` / `gh api`), per repo convention and prior
mis-numbering incidents.

## Files touched

Scheduler side:
- `migrations/021_blackout_periods.sql` — new (table + RLS comment + 2 seed rows)
- `.claude/commands/wids-schedule-admin.md` — `slots` CTE filter + zero-slot halt message
- `.claude/commands/wids-schedule-reading-group.md` — one-line shared-filter pointer + zero-slot halt message
- `tests/blackout_periods_test.sql` — new
- `migrations/README.md` — add `021` row to the migration table

Portal side (availability submission guard):
- `web/lib/blackout.ts` — new shared `blackedOutDays(days, periods)` helper (reuses `nyDayAtHour`)
- `web/app/availability/actions.ts` — read blackout periods (service client) + reject overlapping submit, before the delete
- `web/app/availability/page.tsx` — fetch blacked-out dates (service client), pass to the form
- `web/app/availability/AvailabilityForm.tsx` — accept disabled-dates prop, forward to the month calendar
- the month calendar component (path TBD when writing the plan) — render disabled days unselectable
- web-app test for `blackedOutDays` (+ `submitAvailability` if a server-action harness exists)
