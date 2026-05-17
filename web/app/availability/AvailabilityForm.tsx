"use client";

import { useState, useTransition } from "react";
import { MonthCalendar } from "@/components/MonthCalendar";
import { Button } from "@/components/ui";
import { submitAvailability } from "./actions";

export function AvailabilityForm({
  meetingId,
  initialDays,
}: {
  meetingId: number;
  initialDays: string[];
}) {
  const [days, setDays] = useState<string[]>(initialDays);
  const [pending, start] = useTransition();

  function onSubmit() {
    start(async () => {
      await submitAvailability(meetingId, days);
    });
  }

  const count = days.length;
  const dayWord = count === 1 ? "day" : "days";
  const isEditing = initialDays.length > 0;
  const submitLabel = isEditing ? "Update availability" : "Submit availability";

  return (
    <div className="availability-form">
      <MonthCalendar initialSelected={initialDays} onChange={setDays} />

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
