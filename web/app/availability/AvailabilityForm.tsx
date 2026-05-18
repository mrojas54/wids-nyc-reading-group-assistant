"use client";

import { useMemo, useState, useTransition } from "react";
import {
  MonthCalendar,
  endOfNextMonth,
  pruneToWindow,
} from "@/components/MonthCalendar";
import { Button } from "@/components/ui";
import { submitAvailability } from "./actions";

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function AvailabilityForm({
  meetingId,
  initialDays,
}: {
  meetingId: number;
  initialDays: string[];
}) {
  // Mirror the calendar's pruning so the "N days selected" counter is
  // correct from first render — without this, stale pre-fill entries show
  // up in the count even though no cell renders as selected.
  const prunedInitial = useMemo(() => {
    const today = startOfDay(new Date());
    return pruneToWindow(initialDays, today, endOfNextMonth(today));
  }, [initialDays]);
  const [days, setDays] = useState<string[]>(prunedInitial);
  const [pending, start] = useTransition();

  function onSubmit() {
    start(async () => {
      await submitAvailability(meetingId, days);
    });
  }

  const count = days.length;
  const dayWord = count === 1 ? "day" : "days";
  const isEditing = prunedInitial.length > 0;
  const submitLabel = isEditing ? "Update availability" : "Submit availability";

  return (
    <div className="availability-form">
      <MonthCalendar initialSelected={prunedInitial} onChange={setDays} />

      <div className="cal-summary">
        <div className="count">
          {count === 0 ? (
            <>No days selected yet</>
          ) : (
            <>
              <b>{count}</b> {dayWord} selected
            </>
          )}
        </div>
        <Button
          onClick={onSubmit}
          disabled={pending || count === 0}
          variant="primary"
        >
          {pending ? "Saving…" : count === 0 ? "Choose dates" : submitLabel}
        </Button>
      </div>
    </div>
  );
}
