"use client";

import { useState } from "react";

type Props = {
  initialSelected: string[];
  onChange: (days: string[]) => void;
  windowDays?: number;
};

export function DayPickerCalendar({ initialSelected, onChange, windowDays = 30 }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set(initialSelected));

  const today = new Date();
  const days: string[] = [];
  for (let i = 0; i < windowDays; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    days.push(d.toISOString().slice(0, 10));
  }

  function toggle(day: string) {
    const next = new Set(selected);
    if (next.has(day)) next.delete(day);
    else next.add(day);
    setSelected(next);
    onChange(Array.from(next));
  }

  return (
    <div className="day-picker" role="group" aria-label="Pick available days">
      {days.map((day) => {
        const d = new Date(day + "T00:00");
        const isSelected = selected.has(day);
        return (
          <button
            key={day}
            type="button"
            onClick={() => toggle(day)}
            aria-pressed={isSelected}
            className={`day-picker-cell${isSelected ? " day-picker-cell-selected" : ""}`}
          >
            <span className="day-picker-dow">
              {d.toLocaleDateString("en-US", { weekday: "short" })}
            </span>
            <span className="day-picker-num">{d.getDate()}</span>
          </button>
        );
      })}
    </div>
  );
}
