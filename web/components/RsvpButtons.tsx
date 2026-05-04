"use client";

import { useState, useTransition } from "react";
import { setRsvp } from "@/app/dashboard/rsvp-actions";
import type { RsvpStatus } from "@/lib/queries";

type RsvpChoice = "attending" | "tentative" | "declined";

const VERB: Record<RsvpChoice, string> = {
  attending: "attending",
  tentative: "tentative",
  declined: "not coming",
};

function isChoice(s: RsvpStatus | null): s is RsvpChoice {
  return s === "attending" || s === "tentative" || s === "declined";
}

export function RsvpButtons({
  meetingId,
  current,
}: {
  meetingId: number;
  current: RsvpStatus | null;
}) {
  const seed: RsvpChoice | null = isChoice(current) ? current : null;
  const [saved, setSaved] = useState<RsvpChoice | null>(seed);
  const [editing, setEditing] = useState<boolean>(saved === null);
  const [pending, startTransition] = useTransition();

  function pick(choice: RsvpChoice) {
    const previous = saved;
    setSaved(choice);
    setEditing(false);
    startTransition(async () => {
      try {
        await setRsvp(meetingId, choice);
      } catch {
        setSaved(previous);
        setEditing(true);
      }
    });
  }

  if (!editing && saved !== null) {
    return (
      <p className="rsvp-collapsed" aria-busy={pending || undefined}>
        You&apos;re <strong>{VERB[saved]}</strong> —{" "}
        <button
          type="button"
          className="rsvp-change"
          onClick={() => setEditing(true)}
          disabled={pending}
        >
          change?
        </button>
      </p>
    );
  }

  return (
    <div className="rsvp-picker" aria-busy={pending || undefined}>
      <button
        type="button"
        className="rsvp-btn"
        aria-pressed={saved === "attending"}
        disabled={pending}
        onClick={() => pick("attending")}
      >
        Attending
      </button>
      <button
        type="button"
        className="rsvp-btn"
        aria-pressed={saved === "tentative"}
        disabled={pending}
        onClick={() => pick("tentative")}
      >
        Tentative
      </button>
      <button
        type="button"
        className="rsvp-btn"
        aria-pressed={saved === "declined"}
        disabled={pending}
        onClick={() => pick("declined")}
      >
        Can&apos;t make it
      </button>
    </div>
  );
}
