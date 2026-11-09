// Data loader for /dashboard. It runs the member's queries and makes every
// show/hide decision, so app/dashboard/page.tsx only lays out the cards.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/lib/database.types";
import {
  currentMemberId,
  myAvailabilitySubmitted,
  myHistory,
  myRsvp,
  myStats,
  nextMeeting,
  type HistoryItem,
  type NextMeeting,
  type RsvpStatus,
  type Stats,
} from "@/lib/queries";
import { canFindPaper, canScheduleMeeting } from "@/lib/roles";
import { safeHref } from "@/lib/safeUrl";

export type DashboardData = {
  meeting: NextMeeting | null;
  rsvp: RsvpStatus | null;
  /** null when no reading group is collecting availability. */
  availabilityStatus: "needed" | "submitted" | null;
  prepMeetingId: number | null;
  /** Checked Paper Pal link for the next meeting's paper, if it has one. */
  companionHref: string | null;
  showFindPaper: boolean;
  showSchedule: boolean;
  firstName: string | null;
  stats: Stats;
  history: HistoryItem[];
};

type MemberRow = Pick<Tables<"members">, "name" | "role">;

export async function loadDashboard(
  sb: SupabaseClient<Database>,
): Promise<DashboardData> {
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
  const member = memberResult.data as MemberRow | null;

  const stats = await myStats(sb, submitted, memberId);

  return {
    meeting,
    rsvp,
    availabilityStatus: prepMeeting ? (submitted ? "submitted" : "needed") : null,
    prepMeetingId: prepMeeting?.id ?? null,
    // papers.companion_url is operator-written and holds either a site-relative
    // path or an absolute URL, so it gets the href check before it is rendered.
    companionHref: safeHref(meeting?.companion_url),
    // The banner is a prompt to *choose* a paper, so it stops once the next
    // meeting has one — permission alone would keep nagging leaders to pick a
    // paper that is already picked. No meeting (or no paper on it) still shows
    // it. Only reading_group meetings ever have a paper, so an admin meeting or
    // vibe session in prep must not trigger this — neither one is waiting on a pick.
    showFindPaper:
      canFindPaper(member?.role) && meeting?.type === "reading_group" && !meeting?.paper_id,
    // The operator's way into /admin/schedule: shown only while a reading group
    // is collecting availability, and never to members (see canScheduleMeeting).
    showSchedule:
      canScheduleMeeting(member?.role) && prepMeeting?.type === "reading_group",
    firstName: member?.name ? String(member.name).split(/\s+/)[0] : null,
    stats,
    history,
  };
}
