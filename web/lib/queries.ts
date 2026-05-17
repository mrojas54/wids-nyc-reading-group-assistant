// Server-side data accessors for the dashboard.
// All queries assume the supplied client respects RLS (server.ts client).
import type { SupabaseClient } from "@supabase/supabase-js";

export type MeetingStatus = "prep" | "scheduled" | "done" | "cancelled" | "guide_failed";
export type RsvpStatus = "attending" | "declined" | "tentative" | "no_response";

export type NextMeeting = {
  id: number;
  type: "admin" | "reading_group";
  status: MeetingStatus;
  scheduled_at: string | null;
  location: string | null;
  leader_name: string | null;
  paper_id: number | null;
  paper_title: string | null;
  companion_url: string | null;
};

export async function nextMeeting(sb: SupabaseClient): Promise<NextMeeting | null> {
  const nowIso = new Date().toISOString();

  const { data: scheduled } = await sb
    .from("meetings")
    .select(
      "id, type, status, scheduled_at, location, leader_id, paper_id, members:leader_id(name), papers:paper_id(title, companion_url)",
    )
    .eq("status", "scheduled")
    .gte("scheduled_at", nowIso)
    .order("scheduled_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (scheduled) return mapMeeting(scheduled);

  const { data: prep } = await sb
    .from("meetings")
    .select(
      "id, type, status, scheduled_at, location, leader_id, paper_id, members:leader_id(name), papers:paper_id(title, companion_url)",
    )
    .eq("status", "prep")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return prep ? mapMeeting(prep) : null;
}

function mapMeeting(row: any): NextMeeting {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    scheduled_at: row.scheduled_at,
    location: row.location,
    leader_name: row.members?.name ?? null,
    paper_id: row.paper_id,
    paper_title: row.papers?.title ?? null,
    companion_url: row.papers?.companion_url ?? null,
  };
}

export async function currentMemberId(sb: SupabaseClient): Promise<number | null> {
  const { data } = await sb.rpc("current_member_id");
  return (data as number | null) ?? null;
}

export async function myAvailabilitySubmitted(
  sb: SupabaseClient,
  prepMeetingId: number,
): Promise<boolean> {
  const memberId = await currentMemberId(sb);
  if (memberId == null) return false;
  const { count } = await sb
    .from("availability")
    .select("*", { count: "exact", head: true })
    .eq("meeting_id", prepMeetingId)
    .eq("member_id", memberId);
  return (count ?? 0) > 0;
}

export async function myRsvp(
  sb: SupabaseClient,
  meetingId: number,
): Promise<RsvpStatus | null> {
  const { data } = await sb
    .from("meeting_attendance")
    .select("rsvp_status")
    .eq("meeting_id", meetingId)
    .maybeSingle();
  return (data?.rsvp_status as RsvpStatus | undefined) ?? null;
}

export type Stats = {
  meetingsAttended: number;
  papersLed: number;
  availabilitySubmitted: boolean;
};

export async function myStats(
  sb: SupabaseClient,
  availabilitySubmitted: boolean,
): Promise<Stats> {
  const memberId = await currentMemberId(sb);

  const attendedQ = sb
    .from("meeting_attendance")
    .select("meetings!inner(id, status)", { count: "exact", head: true })
    .eq("rsvp_status", "attending")
    .eq("meetings.status", "done");

  const ledQ = memberId
    ? sb
        .from("meetings")
        .select("*", { count: "exact", head: true })
        .eq("status", "done")
        .eq("leader_id", memberId)
    : Promise.resolve({ count: 0 } as { count: number });

  const [{ count: attended }, { count: led }] = await Promise.all([attendedQ, ledQ]);

  return {
    meetingsAttended: attended ?? 0,
    papersLed: led ?? 0,
    availabilitySubmitted,
  };
}

export type HistoryItem = {
  meeting_id: number;
  paper_title: string | null;
  date: string | null;
  companion_url: string | null;
};

export type SynthesisGate = {
  canSynthesize: boolean;
  reason: "owner" | "leader" | "none";
};

/**
 * Paper Pal synthesis gate. Returns canSynthesize=true when the caller is
 * the chapter owner (role in operator/admin) OR the leader of any meeting
 * that uses this paper. Safe to call on the public /papers/<id> route —
 * unauthenticated callers get { canSynthesize: false, reason: "none" }.
 *
 * See docs/superpowers/specs/2026-05-17-paper-pal-design.md §3.
 */
export async function canSynthesizePaperPal(
  sb: SupabaseClient,
  paperId: number,
): Promise<SynthesisGate> {
  const memberId = await currentMemberId(sb);
  if (memberId == null) return { canSynthesize: false, reason: "none" };

  const { data: member } = await sb
    .from("members")
    .select("role")
    .eq("id", memberId)
    .maybeSingle();

  if (member?.role === "operator" || member?.role === "admin") {
    return { canSynthesize: true, reason: "owner" };
  }

  const { count } = await sb
    .from("meetings")
    .select("*", { count: "exact", head: true })
    .eq("paper_id", paperId)
    .eq("leader_id", memberId);

  if ((count ?? 0) > 0) return { canSynthesize: true, reason: "leader" };
  return { canSynthesize: false, reason: "none" };
}

export type PaperCatalogRow = {
  id: number;
  title: string;
  authors: string[] | null;
  leader_name: string | null;
};

/** Looks up papers.id and joins the most recent meeting's leader, if any. */
export async function paperCatalogRow(
  sb: SupabaseClient,
  paperId: number,
): Promise<PaperCatalogRow | null> {
  const { data: paper } = await sb
    .from("papers")
    .select("id, title, authors")
    .eq("id", paperId)
    .maybeSingle();
  if (!paper) return null;

  const { data: meeting } = await sb
    .from("meetings")
    .select("members:leader_id(name)")
    .eq("paper_id", paperId)
    .order("scheduled_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  return {
    id: paper.id,
    title: paper.title,
    authors: paper.authors ?? null,
    leader_name: (meeting as any)?.members?.name ?? null,
  };
}

export async function myHistory(sb: SupabaseClient, limit = 10): Promise<HistoryItem[]> {
  const { data } = await sb
    .from("meeting_attendance")
    .select(
      "meetings:meeting_id(id, scheduled_at, status, papers:paper_id(title, companion_url))",
    )
    .eq("rsvp_status", "attending")
    .limit(limit * 2);

  const items: HistoryItem[] = (data ?? [])
    .map((r: any) => r.meetings)
    .filter((m: any) => m && m.status === "done")
    .map((m: any) => ({
      meeting_id: m.id,
      paper_title: m.papers?.title ?? null,
      date: m.scheduled_at ?? null,
      companion_url: m.papers?.companion_url ?? null,
    }));

  items.sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return b.date.localeCompare(a.date);
  });

  return items.slice(0, limit);
}
