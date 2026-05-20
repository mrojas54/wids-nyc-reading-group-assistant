// Inbox — chapter reading queue. Server component; fetches via Promise.all.
// Ported from design_handoff/design/ideas-screens.jsx · <InboxScreen>.
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getInbox, type InboxMeeting } from "@/lib/paperpal/inbox";
import InboxCard from "./InboxCard";
import VolunteerButton from "./VolunteerButton";
import ProposePaperForm from "./ProposePaperForm";
import "./inbox.css";

function formatMonthYear(d: Date): string {
  return d.toLocaleString(undefined, { month: "long", year: "numeric" });
}

function formatHero(iso: string | null | undefined): string | null {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return null;
  }
}

function formatRelativeDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } catch {
    return null;
  }
}

export default async function InboxScreen() {
  const sb = await createSupabaseServerClient();
  const { reading, upcoming, suggestions, past, viewer, catalogPapers } =
    await getInbox(sb);

  const heroWhen = reading ? formatHero(reading.scheduled_at) : null;
  const heroLead = reading?.leader_name ?? null;
  const heroMonth = formatMonthYear(new Date());

  return (
    <div className="inbox-page" data-screen-label="04 Inbox">
      <div className="inbox-hero">
        <div>
          <div className="inbox-hero-eyebrow">
            <span className="dot" />
            <span>WiDS NYC AI Reading Group · {heroMonth}</span>
          </div>
          <h1>Your inbox for this month.</h1>
          <p className="sub">
            One paper in flight, {upcoming.length} next up — each lead picks
            the paper they&apos;ll lead. Wherever you left off is one tap away.
          </p>
        </div>
        {reading && (
          <div className="right">
            <span className="meeting">Next meeting</span>
            <span className="when">{heroWhen ?? "Date TBD"}</span>
            {heroLead && <span className="lead">{heroLead} leading</span>}
          </div>
        )}
      </div>

      {/* Reading now */}
      <section className="inbox-section">
        <div className="h-section">
          Reading now <span className="count">· {reading ? 1 : 0}</span>
        </div>
        {reading ? (
          <div className="inbox-grid">
            <ReadingCard meeting={reading} />
          </div>
        ) : (
          <div className="inbox-empty">
            Sit tight — the next pick lands as soon as a lead claims it.
          </div>
        )}
      </section>

      {/* Lead's picks (upcoming) */}
      <section className="inbox-section">
        <div className="h-section">
          Lead&apos;s picks{" "}
          <span className="count">
            · {upcoming.length} · leads pick their own paper
          </span>
        </div>
        {upcoming.length === 0 ? (
          <div className="inbox-empty">No upcoming picks yet.</div>
        ) : (
          <div className="inbox-grid">
            {upcoming.map((m) =>
              m.paper ? (
                <InboxCard
                  key={m.meeting_id}
                  paper={m.paper}
                  variant="queued"
                  badge={{ tone: "warning", label: "Up next" }}
                  scheduled={m.scheduled_at}
                  leaderName={m.leader_name}
                  pickPill={{ label: "Lead's choice" }}
                  pickAttribution={
                    m.leader_name
                      ? {
                          who: m.leader_name,
                          verb: "chose this for their meeting",
                          when: formatRelativeDate(m.scheduled_at),
                        }
                      : undefined
                  }
                />
              ) : null,
            )}
          </div>
        )}
      </section>

      {/* Want to lead */}
      <section className="inbox-section">
        <div className="h-section">
          Want to lead <span className="count">· {suggestions.length}</span>
        </div>
        <p className="h-section-sub">
          Members propose papers they&apos;d lead. The chapter lead slots them
          into upcoming meetings.
        </p>
        {suggestions.length === 0 ? (
          <div className="inbox-empty">
            Nothing in the pile. Suggest a paper you&apos;d love to lead.
          </div>
        ) : (
          <div className="inbox-grid">
            {suggestions.map((s) => {
              const isLeader =
                viewer.memberId != null &&
                s.meeting_leader_id === viewer.memberId;
              return (
                <div className="inbox-card-stack" key={s.suggestion_id}>
                  <InboxCard
                    paper={s.paper}
                    variant="proposed"
                    badge={{ tone: "neutral", label: "Suggested" }}
                    pickPill={{ label: "Wants to lead", ghost: true }}
                    pickAttribution={
                      s.suggested_by_name
                        ? {
                            who: s.suggested_by_name,
                            when: formatRelativeDate(s.suggested_at),
                          }
                        : undefined
                    }
                    note={s.note}
                  />
                  {viewer.memberId != null && !isLeader && (
                    <VolunteerButton
                      meetingId={s.meeting_id}
                      alreadyVolunteered={viewer.volunteeredMeetingIds.includes(
                        s.meeting_id,
                      )}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
        <ProposePaperForm papers={catalogPapers} />
      </section>

      {/* Recently discussed */}
      <section className="inbox-section">
        <div className="h-section">
          Recently discussed <span className="count">· {past.length}</span>
        </div>
        {past.length === 0 ? (
          <div className="inbox-empty">
            Nothing in the rear-view yet — your first meeting will land here.
          </div>
        ) : (
          <div className="inbox-grid">
            {past.map((m) =>
              m.paper ? (
                <InboxCard
                  key={m.meeting_id}
                  paper={m.paper}
                  variant="past"
                  badge={{ tone: "neutral", label: "Past" }}
                  scheduled={m.scheduled_at}
                  leaderName={m.leader_name}
                />
              ) : null,
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function ReadingCard({ meeting }: { meeting: InboxMeeting }) {
  if (!meeting.paper) {
    return (
      <div className="inbox-empty">
        A meeting is scheduled, but no paper is attached yet.
      </div>
    );
  }
  return (
    <InboxCard
      paper={meeting.paper}
      variant="current"
      badge={{ tone: "sage", label: "Synthesized" }}
      scheduled={meeting.scheduled_at}
      leaderName={meeting.leader_name}
    />
  );
}
