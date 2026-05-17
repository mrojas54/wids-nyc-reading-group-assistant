import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  myAvailabilitySubmitted,
  myHistory,
  myRsvp,
  myStats,
  nextMeeting,
} from "@/lib/queries";
import { Brandmark, Icon } from "@/components/ui";
import { NextMeetingCard, type AvailabilityStatus } from "@/components/NextMeetingCard";
import { YourStats } from "@/components/YourStats";
import { YourHistory } from "@/components/YourHistory";
import { signOut } from "./actions";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const sb = createSupabaseServerClient();

  const meeting = await nextMeeting(sb);

  const { data: prepMeeting } = await sb
    .from("meetings")
    .select("id, type")
    .eq("status", "prep")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const submitted = prepMeeting
    ? await myAvailabilitySubmitted(sb, prepMeeting.id)
    : true;

  const rsvp =
    meeting?.status === "scheduled" ? await myRsvp(sb, meeting.id) : null;

  const stats = await myStats(sb, submitted);
  const history = await myHistory(sb, 10);

  // members.id is SERIAL INT; user.id is UUID — bridge is members.auth_user_id.
  // The role CHECK currently permits 'member' and 'operator'; the set below is
  // forward-compatible for if/when 'leader' / 'admin' are added.
  const {
    data: { user },
  } = await sb.auth.getUser();
  const { data: member } = user
    ? await sb
        .from("members")
        .select("name, role")
        .eq("auth_user_id", user.id)
        .single()
    : { data: null };
  const canFindPaper =
    member?.role === "operator" ||
    member?.role === "leader" ||
    member?.role === "admin";

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

        {canFindPaper && (
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
