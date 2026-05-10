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
import { NextMeetingCard } from "@/components/NextMeetingCard";
import { AvailabilityBanner } from "@/components/AvailabilityBanner";
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

  // Decide whether to show the "Find a paper" link. members.id is SERIAL INT;
  // user.id is a UUID — the bridge column is members.auth_user_id. Today the
  // role CHECK constraint only permits 'member' and 'operator', but the set
  // below is forward-compatible for if/when 'leader' / 'admin' are added.
  const {
    data: { user },
  } = await sb.auth.getUser();
  const { data: member } = user
    ? await sb
        .from("members")
        .select("role")
        .eq("auth_user_id", user.id)
        .single()
    : { data: null };
  const canFindPaper =
    member?.role === "operator" ||
    member?.role === "leader" ||
    member?.role === "admin";

  return (
    <div className="shell">
      <header className="shell-header">
        <Brandmark />
        <form action={signOut}>
          <button type="submit" className="signout">
            Sign out
          </button>
        </form>
      </header>

      <main className="shell-main dashboard">
        <header className="dashboard-head">
          <h1>Dashboard</h1>
        </header>

        <NextMeetingCard meeting={meeting} myRsvp={rsvp} />

        {prepMeeting && !submitted && (
          <AvailabilityBanner meetingType={prepMeeting.type} />
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
      </main>
    </div>
  );
}
