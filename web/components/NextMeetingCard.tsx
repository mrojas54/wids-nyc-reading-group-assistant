import { formatDateTimeNY } from "@/lib/time";
import type { NextMeeting } from "@/lib/queries";
import { Icon } from "@/components/ui";

const TYPE_LABEL: Record<NextMeeting["type"], string> = {
  admin: "admin",
  reading_group: "reading group",
};

export function NextMeetingCard({ meeting }: { meeting: NextMeeting | null }) {
  if (!meeting) {
    return (
      <div className="next-meeting next-meeting-empty">
        <p>No meetings on the calendar yet — sit tight.</p>
      </div>
    );
  }

  const date = meeting.scheduled_at ? formatDateTimeNY(meeting.scheduled_at) : "Date TBD";
  const location = meeting.location ?? "Location TBD";
  const leader = meeting.leader_name ?? "Leader TBD";

  return (
    <article className="next-meeting">
      <header className="next-meeting-head">
        <h2 className="next-meeting-eyebrow">Next meeting</h2>
        <span className="next-meeting-badge">{TYPE_LABEL[meeting.type]}</span>
      </header>

      <div className="next-meeting-when">{date}</div>

      <dl className="next-meeting-meta">
        <div>
          <dt>Location</dt>
          <dd>{location}</dd>
        </div>
        <div>
          <dt>Leader</dt>
          <dd>{leader}</dd>
        </div>
        {meeting.paper_title && (
          <div>
            <dt>Paper</dt>
            <dd>{meeting.paper_title}</dd>
          </div>
        )}
      </dl>

      {meeting.companion_url && (
        <a href={meeting.companion_url} className="btn btn-primary btn-sm next-meeting-cta">
          Open paper companion
          <Icon name="arrowRight" size={14} />
        </a>
      )}
    </article>
  );
}
