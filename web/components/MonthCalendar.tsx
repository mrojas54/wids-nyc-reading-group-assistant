"use client";

import { useMemo, useState } from "react";

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
}: Props) {
  const today = useMemo(() => startOfDay(todayProp ?? new Date()), [todayProp]);
  const horizonEnd = useMemo(
    () => startOfDay(horizonEndProp ?? endOfNextMonth(today)),
    [today, horizonEndProp],
  );

  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initialSelected),
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
          const disabled = !inHorizon || isPast;
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
