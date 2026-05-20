"use client";

// Volunteer-to-lead button for a "Want to lead" Inbox card. Renders a
// sibling of the card (not nested in its <Link>). The parent decides
// whether to render this at all — it's hidden when the viewer already
// leads the meeting.
import { useState, useTransition } from "react";
import { volunteerForMeeting } from "@/lib/paperpal/inbox-actions";

export default function VolunteerButton({
  meetingId,
  alreadyVolunteered,
}: {
  meetingId: number;
  alreadyVolunteered: boolean;
}) {
  const [volunteered, setVolunteered] = useState(alreadyVolunteered);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (volunteered) {
    return <span className="volunteer-done">You volunteered</span>;
  }

  function onClick() {
    setError(null);
    startTransition(async () => {
      try {
        await volunteerForMeeting(meetingId);
        setVolunteered(true);
      } catch {
        setError("Could not volunteer — please retry.");
      }
    });
  }

  return (
    <div className="volunteer-row">
      <button
        type="button"
        className="volunteer-btn"
        onClick={onClick}
        disabled={pending}
      >
        {pending ? "Volunteering…" : "Volunteer to lead"}
      </button>
      {error && (
        <span role="alert" className="volunteer-error">
          {error}
        </span>
      )}
    </div>
  );
}
