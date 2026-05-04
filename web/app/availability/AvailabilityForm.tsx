"use client";

import { useState, useTransition } from "react";
import { DayPickerCalendar } from "@/components/DayPickerCalendar";
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
  const [confirming, setConfirming] = useState(false);

  const isEdit = initialDays.length > 0;

  function onSubmit() {
    if (isEdit && !confirming) {
      setConfirming(true);
      return;
    }
    start(async () => {
      await submitAvailability(meetingId, days);
    });
  }

  const dayWord = days.length === 1 ? "day" : "days";

  return (
    <div className="availability-form">
      <DayPickerCalendar initialSelected={initialDays} onChange={setDays} />

      <p className="availability-count">
        Selected: {days.length} {dayWord}. Default window: 6–9 PM ET.
      </p>

      {confirming && (
        <div className="confirm-card" role="alert">
          This will replace your previous selection. Continue?
        </div>
      )}

      <div className="availability-actions">
        <Button onClick={onSubmit} disabled={pending} variant="primary">
          {pending ? "Saving…" : confirming ? "Yes, replace" : isEdit ? "Update" : "Submit"}
        </Button>
        {confirming && (
          <Button onClick={() => setConfirming(false)} variant="secondary" disabled={pending}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}
