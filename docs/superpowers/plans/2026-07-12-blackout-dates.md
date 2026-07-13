# Blackout Dates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the scheduler from proposing meeting slots inside two 2026 blackout windows, and stop members from submitting availability inside them.

**Architecture:** A new `blackout_periods` table holds date ranges. The scheduler's candidate-slot query gains a `NOT EXISTS` filter against it. The availability portal reads it server-side (service-role client) to grey out blacked-out calendar dates and to reject overlapping submissions. One shared overlap rule is used everywhere.

**Tech Stack:** Postgres (Supabase), SQL-in-markdown slash commands, Next.js 16 / React 19 (App Router, server actions), Vitest.

## Global Constraints

- **Timezone:** all instants are `TIMESTAMPTZ`; blackout windows are half-open `[range_start, range_end)` in `America/New_York`.
- **Windows (2026 only):** `2026-07-12 00:00 ET → 2026-08-01 00:00 ET` (Jul 31 last blocked, Aug 1 bookable) and `2026-08-21 00:00 ET → 2026-09-08 00:00 ET` (Sep 7 last blocked, Sep 8 bookable). Bookable gap between them: Aug 1–20.
- **Overlap rule (single source of truth):** a 90-minute slot `[s, s+90m)` is blocked iff `s < bp.range_end AND s + 90m > bp.range_start`. The web helper mirrors this exactly with `s = nyDayAtHour(day,18)`, `e = nyDayAtHour(day,21)`.
- **RLS:** the DB's `ensure_rls` event trigger auto-enables RLS on new tables. `blackout_periods` gets **no browser policies** (service-role-only, like `command_log`); every reader is server-side.
- **Migrations:** hand-applied in numeric order; filenames define order. Verify the next number against the remote before finalizing (Task 1, Step 1).
- **Web commands run from `web/`:** `npm test` (vitest), `npm run typecheck`, `npm run lint`.

---

### Task 1: `blackout_periods` table + seed rows

**Files:**
- Create: `migrations/021_blackout_periods.sql`
- Modify: `migrations/README.md` (add the `021` table row)

**Interfaces:**
- Produces: table `blackout_periods(id serial pk, range_start timestamptz, range_end timestamptz, reason text, created_at timestamptz, CHECK(range_end > range_start))`, pre-seeded with the two 2026 windows. Consumed by Tasks 2, 4, 5.

- [ ] **Step 1: Confirm `021` is a free migration number**

```bash
git fetch origin
git ls-tree -r --name-only origin/main -- migrations | grep -E '/021_' && echo "TAKEN — bump to next free number and update all 021 references in this plan" || echo "021 free on origin/main"
gh pr list --state open 2>/dev/null | grep -i migration || echo "no open migration PRs to reconcile"
```
Expected: `021 free on origin/main`. If TAKEN, use the next free number everywhere below.

- [ ] **Step 2: Write the migration**

Create `migrations/021_blackout_periods.sql`:

```sql
-- migrations/021_blackout_periods.sql
-- Operator-defined blackout windows: date ranges in which no meeting may be
-- scheduled and no member may submit availability. Half-open [range_start,
-- range_end) in America/New_York.
--
-- RLS note: the out-of-band `ensure_rls` event trigger auto-enables RLS on
-- this table. We intentionally add NO policies — every reader is server-side
-- (the scheduler via the Supabase service role, and the availability portal
-- via createSupabaseServiceClient()). This mirrors the command_log exception:
-- service-role-only, never read by the browser.

BEGIN;

CREATE TABLE blackout_periods (
  id          SERIAL PRIMARY KEY,
  range_start TIMESTAMPTZ NOT NULL,
  range_end   TIMESTAMPTZ NOT NULL,   -- half-open: [range_start, range_end)
  reason      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (range_end > range_start)
);

INSERT INTO blackout_periods (range_start, range_end, reason) VALUES
  ('2026-07-12 00:00 America/New_York',
   '2026-08-01 00:00 America/New_York',   -- exclusive → Jul 31 last blocked, Aug 1 bookable
   'Summer break part 1 (Jul 12 – Jul 31, 2026)'),
  ('2026-08-21 00:00 America/New_York',
   '2026-09-08 00:00 America/New_York',   -- exclusive → Sep 7 last blocked, Sep 8 bookable
   'Summer break part 2 (Aug 21 – Sep 7, 2026)');

COMMIT;
```

- [ ] **Step 3: Apply the migration**

Apply via the Supabase MCP `apply_migration` tool (name `021_blackout_periods`, the SQL above) or paste into the Supabase SQL Editor. This project has no local DB; migrations go to the remote.

- [ ] **Step 4: Verify the table and seed rows**

Run (Supabase MCP `execute_sql` or SQL editor):

```sql
SELECT reason, range_start, range_end FROM blackout_periods ORDER BY range_start;
```
Expected: exactly 2 rows — "…part 1…" (`2026-07-12 04:00:00+00 … 2026-08-01 04:00:00+00`) and "…part 2…" (`2026-08-21 04:00:00+00 … 2026-09-08 04:00:00+00`). (04:00Z = 00:00 EDT.)

- [ ] **Step 5: Regenerate the Supabase TypeScript types**

The web app's typed client (`createClient<Database>`) is generated from the schema, so the new
table must be added to `web/lib/database.types.ts` or Tasks 4–5 fail `npm run typecheck`.
Regenerate via the Supabase MCP `generate_typescript_types` tool (or
`supabase gen types typescript --project-id <project-id>`) and overwrite `web/lib/database.types.ts`.

Verify the new table is present:

```bash
grep -n "blackout_periods" web/lib/database.types.ts   # expect matches under Tables
```
Review the diff — it should add only `blackout_periods`. If it also rewrites unrelated tables,
the committed types had pre-existing drift; note it and keep only the `blackout_periods` addition
plus any trivially-correct drift, or raise the drift separately rather than smuggling it in here.

- [ ] **Step 6: Document the migration**

In `migrations/README.md`, add a row to the migration table after the `020` row:

```markdown
| `021_blackout_periods.sql` | Creates the `blackout_periods` table (half-open `[range_start, range_end)` windows) and seeds the two 2026 summer-break windows. Service-role-only (no RLS policies), read by the scheduler and the availability portal. |
```

- [ ] **Step 7: Commit**

```bash
git add migrations/021_blackout_periods.sql migrations/README.md web/lib/database.types.ts
git commit -m "Add blackout_periods table and seed 2026 windows"
```

---

### Task 2: Scheduler skips blackout windows

**Files:**
- Create: `tests/blackout_periods_test.sql`
- Modify: `.claude/commands/wids-schedule-admin.md` (Step 2 `slots` CTE; failure handling)
- Modify: `.claude/commands/wids-schedule-reading-group.md` (Step 2 pointer; failure handling)

**Interfaces:**
- Consumes: `blackout_periods` (Task 1).
- Produces: candidate-slot SQL that never returns a slot overlapping a blackout window; both schedule commands share it.

- [ ] **Step 1: Write the SQL test**

Create `tests/blackout_periods_test.sql`:

```sql
-- tests/blackout_periods_test.sql
--
-- Tests the blackout filter added to /wids-schedule-admin Step 2 (and reused
-- by /wids-schedule-reading-group). Asserts: a candidate slot whose start is
-- inside a blackout window is excluded, a slot outside all windows survives,
-- and the CHECK(range_end > range_start) constraint rejects inverted ranges.
--
-- Run via (ON_ERROR_STOP so a RAISE aborts psql instead of falsely reaching PASS):
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f tests/blackout_periods_test.sql
--
-- Uses far-future 2099 fixtures so it is independent of the real 2026 seed
-- rows. Single transaction, ROLLBACK at the end — no fixture data persists.

BEGIN;

-- ---- Fixtures ----
INSERT INTO members (id, name, email, active) VALUES
  (90600, 'Blackout Test A', 'blackout-a@test.invalid', true),
  (90601, 'Blackout Test B', 'blackout-b@test.invalid', true);

INSERT INTO meetings (id, type, status) VALUES
  (90500, 'admin', 'prep');

-- Member A offers a slot INSIDE the test blackout; Member B offers one OUTSIDE.
INSERT INTO availability (meeting_id, member_id, range_start, range_end) VALUES
  (90500, 90600, '2099-08-25 18:00 America/New_York', '2099-08-25 21:00 America/New_York'),
  (90500, 90601, '2099-08-10 18:00 America/New_York', '2099-08-10 21:00 America/New_York');

INSERT INTO blackout_periods (range_start, range_end, reason) VALUES
  ('2099-08-21 00:00 America/New_York', '2099-09-08 00:00 America/New_York', 'test window');

-- ---- Assertions: the exact filtered slots query from the schedule commands ----
DO $$
DECLARE
  blacked int;
  clear   int;
BEGIN
  SELECT count(*) INTO blacked FROM (
    SELECT DISTINCT av.range_start AS slot_start
    FROM availability av
    WHERE av.meeting_id = 90500
      AND NOT EXISTS (
        SELECT 1 FROM blackout_periods bp
        WHERE av.range_start < bp.range_end
          AND av.range_start + interval '90 minutes' > bp.range_start
      )
  ) s WHERE s.slot_start = TIMESTAMPTZ '2099-08-25 18:00 America/New_York';
  IF blacked <> 0 THEN
    RAISE EXCEPTION 'blacked-out slot 2099-08-25 should be excluded, found %', blacked;
  END IF;

  SELECT count(*) INTO clear FROM (
    SELECT DISTINCT av.range_start AS slot_start
    FROM availability av
    WHERE av.meeting_id = 90500
      AND NOT EXISTS (
        SELECT 1 FROM blackout_periods bp
        WHERE av.range_start < bp.range_end
          AND av.range_start + interval '90 minutes' > bp.range_start
      )
  ) s WHERE s.slot_start = TIMESTAMPTZ '2099-08-10 18:00 America/New_York';
  IF clear <> 1 THEN
    RAISE EXCEPTION 'clear slot 2099-08-10 should be present, found %', clear;
  END IF;
END $$;

-- ---- Assertion: CHECK constraint rejects an inverted range ----
DO $$
BEGIN
  BEGIN
    INSERT INTO blackout_periods (range_start, range_end)
    VALUES ('2099-01-02 00:00 America/New_York', '2099-01-01 00:00 America/New_York');
    RAISE EXCEPTION 'expected CHECK(range_end > range_start) to reject inverted range';
  EXCEPTION WHEN check_violation THEN
    NULL; -- expected
  END;
END $$;

ROLLBACK;

\echo 'blackout_periods_test: PASS'
```

- [ ] **Step 2: Run the test — confirm it passes (and is load-bearing)**

Run: `psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f tests/blackout_periods_test.sql`
Expected: ends with `blackout_periods_test: PASS`.

Sanity check that the filter is doing the work: temporarily delete the two `AND NOT EXISTS (...)` clauses and re-run — the first assertion must now fail with "blacked-out slot 2099-08-25 should be excluded, found 1". Restore the clauses.

- [ ] **Step 3: Add the filter to the admin schedule command**

In `.claude/commands/wids-schedule-admin.md`, replace the `slots` CTE in the Step 2 SQL block (currently):

```sql
WITH slots AS (
  SELECT DISTINCT range_start AS slot_start,
                  range_start + interval '90 minutes' AS slot_end
  FROM availability WHERE meeting_id = <admin_id>
),
```

with:

```sql
WITH slots AS (
  SELECT DISTINCT av.range_start AS slot_start,
                  av.range_start + interval '90 minutes' AS slot_end
  FROM availability av
  WHERE av.meeting_id = <admin_id>
    AND NOT EXISTS (          -- skip slots overlapping any blackout window
      SELECT 1 FROM blackout_periods bp
      WHERE av.range_start < bp.range_end
        AND av.range_start + interval '90 minutes' > bp.range_start
    )
),
```

(The alias `av` is required: `blackout_periods` also has a `range_start`, so an unqualified column in the subquery would bind to it and drop every slot.)

- [ ] **Step 4: Add the zero-slot failure line to the admin command**

In `.claude/commands/wids-schedule-admin.md`, under "## Failure handling", add a bullet after the existing "No availability rows" bullet:

```markdown
- Availability exists but the filtered window list is empty (every submitted slot falls in a blackout) → halt: "All submitted availability falls within a blackout window. No bookable slot — collect availability outside the blackout, or clear the relevant `blackout_periods` row."
```

- [ ] **Step 5: Point the reading-group command at the shared filter**

In `.claude/commands/wids-schedule-reading-group.md` Step 2, replace:

```markdown
Same query as `/wids-schedule-admin` Step 2 but with target meeting_id = <rg_id>. Default duration: 90 minutes.
```

with:

```markdown
Same query as `/wids-schedule-admin` Step 2 but with target meeting_id = <rg_id>. Default duration: 90 minutes. This inherits the blackout filter in that query (the `NOT EXISTS (SELECT 1 FROM blackout_periods …)` clause), so reading-group slots skip blackout windows too — keep the two in sync.
```

And under "## Failure handling", add the same zero-slot bullet from Step 4.

- [ ] **Step 6: Commit**

```bash
git add tests/blackout_periods_test.sql .claude/commands/wids-schedule-admin.md .claude/commands/wids-schedule-reading-group.md
git commit -m "Filter blackout windows out of scheduler candidate slots"
```

---

### Task 3: Shared blackout overlap helper (web)

**Files:**
- Create: `web/lib/blackout.ts`
- Create: `web/lib/__tests__/blackout.test.ts`

**Interfaces:**
- Consumes: `nyDayAtHour(day: string, hour: number): string` from `@/lib/time`.
- Produces:
  - `type BlackoutPeriod = { range_start: string; range_end: string }`
  - `isDayBlackedOut(day: string, periods: BlackoutPeriod[]): boolean`
  - `blackedOutDays(days: string[], periods: BlackoutPeriod[]): string[]`
  Consumed by Tasks 4 and 5.

- [ ] **Step 1: Write the failing test**

Create `web/lib/__tests__/blackout.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isDayBlackedOut, blackedOutDays, type BlackoutPeriod } from "../blackout";
import { nyDayAtHour } from "../time";

// Mirrors the seeded 2026 windows, expressed as NY-midnight bounds so the test
// reads in the same clock the scheduler uses.
const PERIODS: BlackoutPeriod[] = [
  { range_start: nyDayAtHour("2026-07-12", 0), range_end: nyDayAtHour("2026-08-01", 0) },
  { range_start: nyDayAtHour("2026-08-21", 0), range_end: nyDayAtHour("2026-09-08", 0) },
];

describe("isDayBlackedOut", () => {
  it("blocks a day inside window 1", () => {
    expect(isDayBlackedOut("2026-07-15", PERIODS)).toBe(true);
  });
  it("blocks a day inside window 2", () => {
    expect(isDayBlackedOut("2026-08-25", PERIODS)).toBe(true);
  });
  it("allows a day in the Aug 1–20 gap", () => {
    expect(isDayBlackedOut("2026-08-10", PERIODS)).toBe(false);
  });
  it("blocks the last day of window 1 (Jul 31) and allows the first bookable day (Aug 1)", () => {
    expect(isDayBlackedOut("2026-07-31", PERIODS)).toBe(true);
    expect(isDayBlackedOut("2026-08-01", PERIODS)).toBe(false);
  });
  it("blocks the last day of window 2 (Sep 7) and allows the first bookable day (Sep 8)", () => {
    expect(isDayBlackedOut("2026-09-07", PERIODS)).toBe(true);
    expect(isDayBlackedOut("2026-09-08", PERIODS)).toBe(false);
  });
  it("allows any day when there are no periods", () => {
    expect(isDayBlackedOut("2026-07-15", [])).toBe(false);
  });
});

describe("blackedOutDays", () => {
  it("returns only the blocked days, preserving order", () => {
    const days = ["2026-08-10", "2026-07-15", "2026-08-01", "2026-09-07"];
    expect(blackedOutDays(days, PERIODS)).toEqual(["2026-07-15", "2026-09-07"]);
  });
  it("returns [] when nothing is blocked", () => {
    expect(blackedOutDays(["2026-08-10", "2026-08-01"], PERIODS)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `web/`): `npm test -- blackout`
Expected: FAIL — cannot resolve `../blackout`.

- [ ] **Step 3: Implement the helper**

Create `web/lib/blackout.ts`:

```ts
import { nyDayAtHour } from "@/lib/time";

export type BlackoutPeriod = { range_start: string; range_end: string };

/**
 * True if a member's fixed 6–9 PM ET slot for `day` (YYYY-MM-DD) overlaps any
 * blackout window. Same half-open overlap test the scheduler uses:
 * slot [s, e) is blocked iff s < period.end AND e > period.start.
 */
export function isDayBlackedOut(day: string, periods: BlackoutPeriod[]): boolean {
  const s = new Date(nyDayAtHour(day, 18)).getTime();
  const e = new Date(nyDayAtHour(day, 21)).getTime();
  return periods.some((p) => {
    const ps = new Date(p.range_start).getTime();
    const pe = new Date(p.range_end).getTime();
    return s < pe && e > ps;
  });
}

/** The subset of `days` that fall in a blackout window, in input order. */
export function blackedOutDays(days: string[], periods: BlackoutPeriod[]): string[] {
  return days.filter((d) => isDayBlackedOut(d, periods));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run (from `web/`): `npm test -- blackout`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add web/lib/blackout.ts web/lib/__tests__/blackout.test.ts
git commit -m "Add shared blackout overlap helper for the portal"
```

---

### Task 4: Reject availability submissions inside a blackout

**Files:**
- Modify: `web/app/availability/actions.ts`

**Interfaces:**
- Consumes: `blackedOutDays` (Task 3), `createSupabaseServiceClient` from `@/lib/supabase/service`, `blackout_periods` (Task 1).
- Produces: `submitAvailability` throws before any delete if any submitted day is blacked out.

- [ ] **Step 1: Add imports**

In `web/app/availability/actions.ts`, add to the import block:

```ts
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { blackedOutDays } from "@/lib/blackout";
```

- [ ] **Step 2: Insert the blackout check before the delete**

In `submitAvailability`, between the `memberRow` guard (`if (!memberRow) throw new Error("not on roster");`) and the delete (`const { error: delErr } = ...`), insert:

```ts
  // Reject blacked-out dates BEFORE deleting existing rows, so a rejected
  // submit leaves the member's prior availability intact. blackout_periods is
  // service-role-only (RLS), so read it with the service client, not `sb`.
  const svc = createSupabaseServiceClient();
  const { data: periods } = await svc
    .from("blackout_periods")
    .select("range_start, range_end");
  const blocked = blackedOutDays(days, periods ?? []);
  if (blocked.length > 0) {
    await logServerAction(
      "submitAvailability",
      "failure",
      `blackout rejected: ${blocked.join(", ")}`,
    );
    throw new Error(
      `These dates fall in a blackout window and can't be selected: ${blocked.join(", ")}`,
    );
  }
```

- [ ] **Step 3: Typecheck and lint**

Run (from `web/`): `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 4: Verify the server rejection end-to-end**

The client calendar does not yet block these dates (Task 5), so it can still submit one — ideal for isolating the server guard.

1. Start the dev server via `preview_start` (`{name}` from `.claude/launch.json`; create a `web` dev config if none exists — `runtimeExecutable: "npm"`, `runtimeArgs: ["run","dev"]`, the port Next prints).
2. As a signed-in member with a prep meeting, open `/availability`, select a **July 2026** date (inside window 1), and submit.
3. Expected: the submit throws; `read_console_messages`/`preview_logs` shows "These dates fall in a blackout window…", and a `submitAvailability` `failure` row is logged. Confirm the member's previously-saved availability is unchanged (check-before-delete).

If an authenticated preview session isn't available, record that this step needs the operator's signed-in session and was left for manual verification.

- [ ] **Step 5: Commit**

```bash
git add web/app/availability/actions.ts
git commit -m "Reject availability submissions inside a blackout window"
```

---

### Task 5: Grey out blacked-out dates in the availability calendar

**Files:**
- Modify: `web/components/MonthCalendar.tsx` (new `blackoutPeriods` prop; disable + prune blacked-out days)
- Modify: `web/app/availability/AvailabilityForm.tsx` (accept + forward the prop; keep the counter honest)
- Modify: `web/app/availability/page.tsx` (fetch periods via the service client; pass down)

**Interfaces:**
- Consumes: `isDayBlackedOut`, `BlackoutPeriod` (Task 3); `createSupabaseServiceClient` (Task 1 table).
- Produces: blacked-out days render disabled/unselectable and never count toward selection.

- [ ] **Step 1: Add the `blackoutPeriods` prop to MonthCalendar**

In `web/components/MonthCalendar.tsx`:

Add the import at the top (after the React import):

```ts
import { isDayBlackedOut, type BlackoutPeriod } from "@/lib/blackout";
```

Add to the `Props` type:

```ts
  /** Blackout windows; days overlapping one render disabled and are pruned from selection. */
  blackoutPeriods?: BlackoutPeriod[];
```

Add `blackoutPeriods = []` to the destructured parameters:

```ts
export function MonthCalendar({
  initialSelected,
  onChange,
  horizonEnd: horizonEndProp,
  today: todayProp,
  blackoutPeriods = [],
}: Props) {
```

Change the initial-selection state so blacked-out pre-fill is dropped (mirrors the existing window-pruning rationale — a disabled cell the user can't deselect must not sit in the Set):

```ts
  const [selected, setSelected] = useState<Set<string>>(
    () =>
      new Set(
        pruneToWindow(initialSelected, today, horizonEnd).filter(
          (k) => !isDayBlackedOut(k, blackoutPeriods),
        ),
      ),
  );
```

In the per-day cell loop, fold blackout into `disabled`:

```ts
          const isPast = date < today;
          const disabled = !inHorizon || isPast || isDayBlackedOut(key, blackoutPeriods);
```

- [ ] **Step 2: Forward the prop through AvailabilityForm and keep the counter honest**

In `web/app/availability/AvailabilityForm.tsx`:

Add the import:

```ts
import { isDayBlackedOut, type BlackoutPeriod } from "@/lib/blackout";
```

Extend the props:

```ts
export function AvailabilityForm({
  meetingId,
  initialDays,
  blackoutPeriods = [],
}: {
  meetingId: number;
  initialDays: string[];
  blackoutPeriods?: BlackoutPeriod[];
}) {
```

Exclude blacked-out days from `prunedInitial` so "N days selected" matches what the calendar shows:

```ts
  const prunedInitial = useMemo(() => {
    const today = startOfDay(new Date());
    return pruneToWindow(initialDays, today, endOfNextMonth(today)).filter(
      (k) => !isDayBlackedOut(k, blackoutPeriods),
    );
  }, [initialDays, blackoutPeriods]);
```

Pass the prop to the calendar:

```tsx
      <MonthCalendar
        initialSelected={prunedInitial}
        onChange={setDays}
        blackoutPeriods={blackoutPeriods}
      />
```

- [ ] **Step 3: Fetch blackout periods in the page and pass them down**

In `web/app/availability/page.tsx`:

Add the import:

```ts
import { createSupabaseServiceClient } from "@/lib/supabase/service";
```

After `initialDays` is computed (just before the `return`), fetch the windows with the service client (`blackout_periods` is RLS-locked to service-role):

```ts
  const svc = createSupabaseServiceClient();
  const { data: blackoutPeriods } = await svc
    .from("blackout_periods")
    .select("range_start, range_end");
```

Pass them to the form:

```tsx
        <AvailabilityForm
          meetingId={prep.id}
          initialDays={initialDays}
          blackoutPeriods={blackoutPeriods ?? []}
        />
```

- [ ] **Step 4: Typecheck, lint, and run the web tests**

Run (from `web/`): `npm run typecheck && npm run lint && npm test`
Expected: no type/lint errors; all tests pass (including Task 3's `blackout` suite and the existing `MonthCalendar` suite).

- [ ] **Step 5: Verify in the browser**

1. Ensure the dev server is running (`preview_start`); open `/availability` as a signed-in member with a prep meeting.
2. `read_page` / screenshot the calendar. Expected: **July 2026 dates are greyed and unclickable** (window 1); if the horizon reaches late August, **Aug 21+ are greyed too**; **Aug 1–20 remain selectable**.
3. Select an Aug 1–20 date and submit. Expected: success (redirect to `/dashboard?submitted=1`), a `submitAvailability` `success` row logged.
4. Confirm the "N days selected" counter never counts a greyed date.

If an authenticated preview session isn't available, record that Steps 5.1–5.4 need the operator's signed-in session and were left for manual verification.

- [ ] **Step 6: Commit**

```bash
git add web/components/MonthCalendar.tsx web/app/availability/AvailabilityForm.tsx web/app/availability/page.tsx
git commit -m "Grey out blacked-out dates in the availability calendar"
```

---

## Final verification

- [ ] From `web/`: `npm run typecheck && npm run lint && npm test` — all green.
- [ ] `psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f tests/blackout_periods_test.sql` — prints `blackout_periods_test: PASS`.
- [ ] Scheduler: with the 2026 seed applied, `/wids-schedule-admin` and `/wids-schedule-reading-group` never propose a slot Jul 12–31 or Aug 21–Sep 7, 2026.
- [ ] Portal: the availability calendar greys out those dates and the server action rejects them if bypassed.
