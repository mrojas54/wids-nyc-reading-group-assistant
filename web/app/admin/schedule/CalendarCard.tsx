"use client";

// The availability calendar: one month of candidate evenings at a time, each
// tinted by how many members are free, paged over every month of the poll.
import { useMemo, useState } from "react";
import { Button, Card, CardBody, CardHeader, Icon } from "@/components/ui";
import { cellAriaLabel, type CandidateDay, type Poll, type PollWindow } from "@/lib/schedule/poll";
import {
  daysInMonth,
  firstWeekday,
  formatMonthTitle,
  formatPollWindow,
  monthsCovering,
  parseDayKey,
  toDayKey,
  type MonthRef,
} from "@/lib/schedule/format";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function CalendarCard({
  poll,
  pollWindow,
  todayKey,
  selectedDay,
  onPick,
}: {
  poll: Poll;
  pollWindow: PollWindow | null;
  todayKey: string;
  selectedDay: string | null;
  onPick: (day: string) => void;
}) {
  const candidateDays = useMemo(() => poll.candidates.map((c) => c.day), [poll]);
  // The calendar pages over every month members could pick in, not just the
  // ones someone marked — a grey month is information too.
  const windowDays = useMemo(
    () => (pollWindow ? [pollWindow.start, pollWindow.end] : []),
    [pollWindow],
  );
  const months = useMemo<MonthRef[]>(() => {
    const today = parseDayKey(todayKey);
    return monthsCovering(
      [...windowDays, ...candidateDays],
      today ? { y: today.y, m: today.m } : { y: 2026, m: 1 },
    );
  }, [windowDays, candidateDays, todayKey]);
  const [monthIndex, setMonthIndex] = useState(() => indexOfMonth(months, selectedDay));

  const month = months[Math.min(monthIndex, months.length - 1)];
  const legendTop = poll.answered > 7 ? `7 to ${poll.answered}` : "7 or more";

  return (
    <Card>
      <CardHeader>
        <div className="card-title-row">
          <div className="card-title-stack">
            <h2 className="heading">{formatMonthTitle(month)}</h2>
            <span className="meta">
              {windowDays.length > 0 ? `Poll window ${formatPollWindow(windowDays)} · ` : ""}
              {poll.answered} of {poll.total} answered
            </span>
          </div>
          <div className="nav-buttons">
            <Button
              variant="ghost"
              size="sm"
              aria-label="Previous month"
              disabled={months.length < 2 || monthIndex === 0}
              onClick={() => setMonthIndex((i) => Math.max(0, i - 1))}
            >
              <Icon name="chevronLeft" size={16} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Next month"
              disabled={months.length < 2 || monthIndex >= months.length - 1}
              onClick={() => setMonthIndex((i) => Math.min(months.length - 1, i + 1))}
            >
              <Icon name="chevronRight" size={16} />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardBody>
        <div className="cal-body">
          <div className="cal-week" aria-hidden="true">
            {WEEKDAYS.map((w) => (
              <span key={w}>{w}</span>
            ))}
          </div>
          <MonthGrid month={month} poll={poll} selectedDay={selectedDay} onPick={onPick} />
          <div className="legend">
            <span>Number = members free that evening, of {poll.answered} who answered.</span>
            <span className="legend-item">
              <span className="swatch" />3 or fewer
            </span>
            <span className="legend-item">
              <span className="swatch" data-tier="1" />4 to 5
            </span>
            <span className="legend-item">
              <span className="swatch" data-tier="2" />6
            </span>
            <span className="legend-item">
              <span className="swatch" data-tier="3" />
              {legendTop}
            </span>
            <span className="legend-item">
              <span className="swatch swatch-selected" />
              Selected
            </span>
            {poll.leaderName && (
              <span className="legend-item">
                <span className="swatch swatch-dashed" />
                {poll.leaderName}, who leads, isn’t free
              </span>
            )}
            <span>Grey days aren’t in the poll.</span>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

function indexOfMonth(months: MonthRef[], day: string | null): number {
  const parts = day ? parseDayKey(day) : null;
  if (!parts) return 0;
  const i = months.findIndex((m) => m.y === parts.y && m.m === parts.m);
  return i < 0 ? 0 : i;
}

function MonthGrid({
  month,
  poll,
  selectedDay,
  onPick,
}: {
  month: MonthRef;
  poll: Poll;
  selectedDay: string | null;
  onPick: (day: string) => void;
}) {
  const leading = firstWeekday(month.y, month.m);
  const total = daysInMonth(month.y, month.m);
  const byDay = new Map(poll.candidates.map((c) => [c.day, c]));
  const cells: React.ReactNode[] = [];
  for (let i = 0; i < leading; i++) {
    cells.push(<div className="cal-cell" key={`blank-${i}`} aria-hidden="true" />);
  }
  for (let d = 1; d <= total; d++) {
    const key = toDayKey({ y: month.y, m: month.m, d });
    const c = byDay.get(key);
    cells.push(
      <div className="cal-cell" key={key}>
        {c ? (
          <DayCell c={c} poll={poll} selected={key === selectedDay} onPick={onPick} />
        ) : (
          <div className="cal-plain" aria-hidden="true">
            {d}
          </div>
        )}
      </div>,
    );
  }
  return (
    <div role="group" aria-label={`Candidate evenings in ${formatMonthTitle(month)}`} className="cal-days">
      {cells}
    </div>
  );
}

function DayCell({
  c,
  poll,
  selected,
  onPick,
}: {
  c: CandidateDay;
  poll: Poll;
  selected: boolean;
  onPick: (day: string) => void;
}) {
  const busy = c.leader === "busy";
  return (
    <button
      type="button"
      className="cal-day"
      aria-pressed={selected}
      aria-label={cellAriaLabel(c, poll, selected)}
      data-tier={busy ? undefined : c.tier}
      data-leader={busy ? "busy" : undefined}
      onClick={() => onPick(c.day)}
    >
      <span className="cal-day-num">{parseDayKey(c.day)?.d}</span>
      <span className="cal-day-meta">{c.freeCount} free</span>
      {busy && poll.leaderName && <span className="cal-day-lead">{poll.leaderName} not free</span>}
    </button>
  );
}
