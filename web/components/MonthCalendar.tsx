"use client";

import { useMemo, useState } from "react";
import { isDayBlackedOut, type BlackoutPeriod } from "@/lib/blackout";

type Props = {
  initialSelected: string[];
  onChange: (days: string[]) => void;
  /**
   * Last selectable day, inclusive. Defaults to the last day of NEXT month
   * (today's remaining days + all of the following month). A fixed day-count
   * window felt too short near month boundaries — a monthly reading group
   * cadence wants "the rest of this month and all of next month" semantics.
   */
  horizonEnd?: Date;
  /** Inject a stable "today" for tests/snapshots. */
  today?: Date;
  /** Blackout windows; days overlapping one render disabled and are pruned from selection. */
  blackoutPeriods?: BlackoutPeriod[];
};

const WK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/**
 * Last day of the month AFTER `from`. JS Date day=0 of month M+1 yields the
 * last day of month M, so day=0 of month+2 yields the last day of month+1.
 * Handles December rollover via the Date constructor's month normalization.
 */
export function endOfNextMonth(from: Date): Date {
  return new Date(from.getFullYear(), from.getMonth() + 2, 0);
}

/**
 * Parse a "YYYY-MM-DD" key into a local-midnight Date. Matches isoDay's
 * encoding: zero-padded year/month/day in local time, no timezone shift.
 */
export function parseLocalDay(key: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  const [, y, mo, d] = m;
  return new Date(Number(y), Number(mo) - 1, Number(d));
}

/**
 * Filter pre-fill keys down to those inside [today, horizonEnd] inclusive.
 *
 * Why this exists: pre-fill comes from DB rows that may include dates
 * outside the current selectable window — stale rows from a previous cycle,
 * test seed data, or rows whose dates have since rolled into the past. The
 * calendar renders such dates as disabled cells, so a user CAN'T deselect
 * them via UI, yet they remain in the selection Set and inflate the "N
 * days selected" counter. Pruning at intake means the count matches what's
 * visible, and the next submit naturally cleans up the stale rows.
 */
export function pruneToWindow(
  keys: readonly string[],
  today: Date,
  horizonEnd: Date,
): string[] {
  const lo = today.getTime();
  const hi = horizonEnd.getTime();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const key of keys) {
    if (seen.has(key)) continue;
    const date = parseLocalDay(key);
    if (!date) continue;
    const t = date.getTime();
    if (t >= lo && t <= hi) {
      seen.add(key);
      out.push(key);
    }
  }
  return out;
}

/**
 * Month-grouped calendar (1-2 months) showing today → `horizonEnd` inclusive.
 * Default horizon is the last day of NEXT month so members near a month
 * boundary can still pick dates well into the following month. Days outside
 * the horizon (past or beyond) render as `.dis`. Today gets the sage-ring +
 * sage-dot. Selected days flip to magenta.
 */
export function MonthCalendar({
  initialSelected,
  onChange,
  horizonEnd: horizonEndProp,
  today: todayProp,
  blackoutPeriods = [],
}: Props) {
  const today = useMemo(() => startOfDay(todayProp ?? new Date()), [todayProp]);
  const horizonEnd = useMemo(
    () => startOfDay(horizonEndProp ?? endOfNextMonth(today)),
    [today, horizonEndProp],
  );

  // Prune pre-fill at mount so stale rows (past dates, out-of-window) don't
  // sit as invisible Set entries the user can't deselect. See pruneToWindow.
  // Blacked-out days get the same treatment (mirrors the window-pruning
  // rationale): a disabled cell the user can't deselect must not sit in the Set.
  const [selected, setSelected] = useState<Set<string>>(
    () =>
      new Set(
        pruneToWindow(initialSelected, today, horizonEnd).filter(
          (k) => !isDayBlackedOut(k, blackoutPeriods),
        ),
      ),
  );

  // Render the current month and (if the horizon spills) the next month.
  const months = useMemo(() => {
    const list = [{ year: today.getFullYear(), month: today.getMonth() }];
    const last = { year: horizonEnd.getFullYear(), month: horizonEnd.getMonth() };
    if (last.year !== list[0].year || last.month !== list[0].month) {
      list.push(last);
    }
    return list;
  }, [today, horizonEnd]);

  function toggle(key: string) {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelected(next);
    onChange(Array.from(next));
  }

  return (
    <div className="cal-stack" role="group" aria-label="Pick available days">
      {months.map(({ year, month }) => {
        const first = new Date(year, month, 1);
        const offset = first.getDay();
        const total = daysInMonth(year, month);

        const cells: React.ReactNode[] = [];
        for (let i = 0; i < offset; i++) {
          cells.push(<div className="day empty" key={`e-${month}-${i}`} aria-hidden />);
        }
        for (let d = 1; d <= total; d++) {
          const date = new Date(year, month, d);
          const key = isoDay(date);
          const inHorizon = date >= today && date <= horizonEnd;
          const isPast = date < today;
          const disabled = !inHorizon || isPast || isDayBlackedOut(key, blackoutPeriods);
          const isSelected = selected.has(key);
          const isToday = sameDay(date, today);
          const cls = [
            "day",
            disabled ? "dis" : "",
            !disabled && isSelected ? "on" : "",
            isToday ? "today" : "",
          ]
            .filter(Boolean)
            .join(" ");
          cells.push(
            <button
              key={key}
              type="button"
              className={cls}
              disabled={disabled}
              aria-pressed={!disabled && isSelected}
              aria-label={date.toDateString()}
              onClick={() => !disabled && toggle(key)}
            >
              {d}
            </button>,
          );
        }

        const monthLabel = first.toLocaleString("en-US", {
          month: "long",
          year: "numeric",
        });

        return (
          <div className="cal-month" key={`${year}-${month}`}>
            <div className="cal-month-h">{monthLabel}</div>
            <div className="cal-grid">
              {WK.map((w) => (
                <div className="cal-wkhead" key={w}>
                  {w}
                </div>
              ))}
              {cells}
            </div>
          </div>
        );
      })}
    </div>
  );
}
