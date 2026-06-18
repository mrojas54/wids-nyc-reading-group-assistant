import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  currentMemberId,
  myAvailabilitySubmitted,
  myHistory,
  myRsvp,
  myStats,
  nextMeeting,
} from "@/lib/queries";
import { Brandmark, Icon } from "@/components/ui";
import { NextMeetingCard, type AvailabilityStatus } from "@/components/NextMeetingCard";
import { QuoteCard } from "@/components/QuoteCard";
import { YourStats } from "@/components/YourStats";
import { YourHistory } from "@/components/YourHistory";
import { canFindPaper } from "@/lib/roles";
import { signOut } from "./actions";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const sb = await createSupabaseServerClient();

  // members.id is SERIAL INT; user.id is UUID — bridge is members.auth_user_id.
  // Role values are constrained in migrations/014_members_role_leader_admin.sql.
  const [meeting, history, memberId, userResult] = await Promise.all([
    nextMeeting(sb),
    myHistory(sb, 10),
    currentMemberId(sb),
    sb.auth.getUser(),
  ]);
  // nextMeeting() falls back to the most recent prep meeting when nothing is
  // scheduled, so derive the prep meeting from that result instead of issuing
  // a second, overlapping query.
  const prepMeeting = meeting?.status === "prep" ? meeting : null;
  const user = userResult.data.user;

  const [submitted, rsvp, memberResult] = await Promise.all([
    prepMeeting
      ? myAvailabilitySubmitted(sb, prepMeeting.id, memberId)
      : Promise.resolve(true),
    meeting?.status === "scheduled" ? myRsvp(sb, meeting.id) : Promise.resolve(null),
    user
      ? sb.from("members").select("name, role").eq("auth_user_id", user.id).single()
      : Promise.resolve({ data: null }),
  ]);
  const member = memberResult.data;

  const stats = await myStats(sb, submitted, memberId);
  const showFindPaper = canFindPaper(member?.role);

  const firstName = member?.name ? String(member.name).split(/\s+/)[0] : null;

  const availabilityStatus: AvailabilityStatus = prepMeeting
    ? submitted
      ? "submitted"
      : "needed"
    : null;

  return (
    <div className="shell">
      <header className="shell-header">
        <Brandmark />
        {firstName ? (
          <div className="greet">
            Hi, <b>{firstName}</b>
          </div>
        ) : (
          <form action={signOut}>
            <button type="submit" className="signout">
              Sign out
            </button>
          </form>
        )}
      </header>

      <main className="shell-main dashboard">
        <NextMeetingCard
          meeting={meeting}
          myRsvp={rsvp}
          availabilityStatus={availabilityStatus}
          prepMeetingId={prepMeeting?.id ?? null}
        />

        <QuoteCard />

        {meeting?.companion_url && (
          <a
            href={meeting.companion_url}
            className="card companion-card"
            style={{ textDecoration: "none", color: "inherit" }}
          >
            <div className="companion-body">
              <div className="companion-eyebrow">Paper Pal</div>
              <div className="companion-title">
                {meeting.paper_title ?? "Paper Pal"}
              </div>
              <div className="companion-meta">Open Paper Pal</div>
            </div>
            <Icon name="chevronRight" size={16} aria-hidden />
          </a>
        )}

        {showFindPaper && (
          <Link href="/admin/suggest" className="banner banner-info">
            <div className="availability-banner-body">
              <strong className="banner-title">Find a paper</strong>
              <span>Search and rank papers for the next meeting</span>
            </div>
            <Icon name="arrowRight" size={16} aria-hidden />
          </Link>
        )}

        <YourStats stats={stats} />
        <YourHistory items={history} />

        {firstName && (
          <form action={signOut} style={{ marginTop: 8 }}>
            <button type="submit" className="signout">
              Sign out
            </button>
          </form>
        )}
      </main>
    </div>
  );
}
