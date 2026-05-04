import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  myAvailabilitySubmitted,
  myHistory,
  myRsvp,
  myStats,
  nextMeeting,
} from "@/lib/queries";
import { Brandmark } from "@/components/ui";
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

        <YourStats stats={stats} />
        <YourHistory items={history} />
      </main>
    </div>
  );
}
