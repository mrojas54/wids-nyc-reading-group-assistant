import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { currentMemberId, upcomingRsvps } from "@/lib/queries";
import { Brandmark, Icon } from "@/components/ui";
import { RsvpButtons } from "@/components/RsvpButtons";
import { formatDateNY, formatTimeNY } from "@/lib/time";

export const dynamic = "force-dynamic";

// Landing page for the "Manage your RSVPs" footer link that ships in every
// transactional email (links.rsvpManage → <portalBase>/me/rsvps). Members
// arrive here from their inbox, so the page has to stand on its own: it lists
// every upcoming meeting rather than the single next one the dashboard hero
// shows, and each row is independently answerable.
export default async function MyRsvpsPage() {
  const sb = await createSupabaseServerClient();

  const memberId = await currentMemberId(sb);
  const meetings = await upcomingRsvps(sb, memberId);

  return (
    <div className="shell">
      <header className="shell-header">
        <Link href="/dashboard" className="btn btn-ghost btn-sm" aria-label="Back to dashboard">
          <Icon name="chevronRight" size={14} style={{ transform: "rotate(180deg)" }} />
          Back
        </Link>
        <Brandmark />
      </header>

      <main className="shell-main">
        <div>
          <h1 className="page-title">Your RSVPs</h1>
          <p className="page-sub">
            Everything on the calendar right now. Change an answer any time — the
            most recent one is what we count.
          </p>
        </div>

        {memberId == null ? (
          // Signed in to Auth but with no members row: RLS resolves
          // current_member_id() to NULL, so every RSVP write would fail the
          // WITH CHECK. Say so instead of rendering buttons that can't save.
          <div className="empty-state">
            <div className="es-glyph">
              <Icon name="mail" size={22} />
            </div>
            <div className="es-title">We can&rsquo;t find you on the roster.</div>
            <div className="es-body">
              Your sign-in worked, but this email isn&rsquo;t linked to a member yet.
              Contact Michelle at{" "}
              <a href="mailto:mirojas1524@gmail.com">mirojas1524@gmail.com</a> and
              she&rsquo;ll sort it out.
            </div>
          </div>
        ) : meetings.length === 0 ? (
          <div className="empty-state">
            <div className="es-glyph">
              <Icon name="calendar" size={22} />
            </div>
            <div className="es-title">Nothing to RSVP to yet.</div>
            <div className="es-body">
              No meetings are on the calendar right now. We&rsquo;ll email you as soon
              as the next one is scheduled.
            </div>
            <Link href="/dashboard" className="btn btn-ghost btn-sm es-action">
              Back to dashboard
            </Link>
          </div>
        ) : (
          <ul className="rsvp-list">
            {meetings.map((m) => {
              const dateLabel = m.scheduled_at ? formatDateNY(m.scheduled_at) : "Date TBD";
              const timeLabel = m.scheduled_at ? formatTimeNY(m.scheduled_at) : null;
              // Reading-group is ~95% of meetings — only badge the exceptions,
              // matching NextMeetingCard.
              const showBadge = m.type !== "reading_group";
              const title =
                m.paper_title ??
                (m.type === "admin" ? "Admin meeting" : "Paper to be announced");

              return (
                <li key={m.meeting_id} className="rsvp-meeting">
                  <div className="rsvp-meeting-when">
                    {dateLabel}
                    {showBadge && <span className="rsvp-meeting-badge">admin</span>}
                  </div>

                  <div className="rsvp-meeting-title">{title}</div>

                  <div className="rsvp-meeting-meta">
                    {timeLabel && (
                      <span>
                        <Icon name="clock" size={13} />
                        {timeLabel}
                      </span>
                    )}
                    <span>
                      <Icon name="mapPin" size={13} />
                      {m.location ?? "Location TBD"}
                    </span>
                    {m.leader_name && (
                      <span className="rsvp-meeting-meta-soft">Led by {m.leader_name}</span>
                    )}
                  </div>

                  <RsvpButtons meetingId={m.meeting_id} current={m.rsvp_status} />
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
