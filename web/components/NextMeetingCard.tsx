import Link from "next/link";
import { formatDateNY, formatTimeNY } from "@/lib/time";
import type { NextMeeting, RsvpStatus } from "@/lib/queries";
import { Icon } from "@/components/ui";
import { RsvpButtons } from "@/components/RsvpButtons";

const TYPE_LABEL: Record<NextMeeting["type"], string> = {
  admin: "admin",
  reading_group: "reading group",
};

export type AvailabilityStatus = "needed" | "submitted" | null;

export function NextMeetingCard({
  meeting,
  myRsvp,
  availabilityStatus = null,
}: {
  meeting: NextMeeting | null;
  myRsvp: RsvpStatus | null;
  /** Folds the availability prompt INTO the hero as a secondary CTA. */
  availabilityStatus?: AvailabilityStatus;
}) {
  if (!meeting) {
    return (
      <article className="card-hero">
        <div className="hero-eyebrow">Next meeting</div>
        <p style={{ color: "var(--color-paper-600)", fontSize: 14 }}>
          No meetings on the calendar yet — sit tight.
        </p>
      </article>
    );
  }

  const dateLabel = meeting.scheduled_at ? formatDateNY(meeting.scheduled_at) : null;
  const timeLabel = meeting.scheduled_at ? formatTimeNY(meeting.scheduled_at) : null;
  const place = meeting.location ?? "Location TBD";
  const leader = meeting.leader_name ?? "Leader TBD";
  // Reading-group is ~95% of meetings — only badge the exceptions.
  const showBadge = meeting.type !== "reading_group";
  const title =
    meeting.paper_title ?? (meeting.type === "admin" ? "Admin meeting" : "Next meeting");

  return (
    <article className="card-hero">
      <div className="hero-eyebrow">
        Next meeting{dateLabel ? ` · ${dateLabel}` : ""}
        {showBadge && (
          <span style={{ marginLeft: 8 }} className="badge badge-reading">
            {TYPE_LABEL[meeting.type]}
          </span>
        )}
      </div>

      <h2 className="hero-title">{title}</h2>

      <div className="hero-meta">
        {timeLabel && (
          <span>
            <Icon name="clock" size={13} />
            {timeLabel}
          </span>
        )}
        <span>
          <Icon name="mapPin" size={13} />
          {place}
        </span>
        <span className="hero-meta-soft">Led by {leader}</span>
      </div>

      {meeting.status === "scheduled" && (
        <RsvpButtons meetingId={meeting.id} current={myRsvp} />
      )}

      {availabilityStatus === "needed" && (
        <Link href="/availability" className="hero-nudge">
          <span className="nudge-text">
            <b>We&rsquo;re scheduling the next meeting.</b>
            <br />
            <span className="nudge-sub">Tap to vote on a date</span>
          </span>
          <Icon name="chevronRight" size={16} className="nudge-arrow" />
        </Link>
      )}
      {availabilityStatus === "submitted" && (
        <div className="hero-nudge confirmed">
          <span className="nudge-text">
            <b>Thanks — got your dates.</b>
            <br />
            We&rsquo;ll confirm the meeting time by Tuesday.
          </span>
        </div>
      )}
    </article>
  );
}
