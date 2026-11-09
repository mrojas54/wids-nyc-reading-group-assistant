import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { loadDashboard } from "@/lib/dashboard";
import { Brandmark, Icon } from "@/components/ui";
import { NextMeetingCard } from "@/components/NextMeetingCard";
import { QuoteCard } from "@/components/QuoteCard";
import { YourStats } from "@/components/YourStats";
import { YourHistory } from "@/components/YourHistory";
import { signOut } from "./actions";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const sb = await createSupabaseServerClient();
  const {
    meeting,
    rsvp,
    availabilityStatus,
    prepMeetingId,
    companionHref,
    showFindPaper,
    showSchedule,
    firstName,
    stats,
    history,
  } = await loadDashboard(sb);

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
          prepMeetingId={prepMeetingId}
        />

        <QuoteCard />

        {companionHref && (
          <a
            href={companionHref}
            className="card companion-card"
            style={{ textDecoration: "none", color: "inherit" }}
          >
            <div className="companion-body">
              <div className="companion-eyebrow">Paper Pal</div>
              <div className="companion-title">
                {meeting?.paper_title ?? "Paper Pal"}
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

        {showSchedule && (
          <Link href="/admin/schedule" className="banner banner-info">
            <div className="availability-banner-body">
              <strong className="banner-title">Schedule the next meeting</strong>
              <span>Pick an evening from the availability poll</span>
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
