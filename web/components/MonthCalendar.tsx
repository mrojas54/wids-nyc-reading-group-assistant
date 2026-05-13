"use client";

import { useMemo, useState } from "react";

type Props = {
  initialSelected: string[];
  onChange: (days: string[]) => void;
  /** Days from today inclusive. Default 30. */
  windowDays?: number;
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
 * Month-grouped calendar (1-2 months) showing a `windowDays`-day horizon.
 * Days outside the horizon (past or beyond) render as `.dis`. Today gets the
 * sage-ring + sage-dot. Selected days flip to magenta.
 */
export function MonthCalendar({
  initialSelected,
  onChange,
  windowDays = 30,
  today: todayProp,
}: Props) {
  const today = useMemo(() => startOfDay(todayProp ?? new Date()), [todayProp]);
  const horizonEnd = useMemo(() => {
    const d = new Date(today);
    d.setDate(today.getDate() + windowDays);
    return d;
  }, [today, windowDays]);

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
