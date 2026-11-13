// The signed-in member's own rows: their id, availability, RSVPs, stats and
// attended-meeting history.
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/lib/database.types";
import type { NextMeeting } from "./meetings";
import {
  companionUrl,
  logQueryError,
  type PaperCompanionEmbed,
  type RsvpStatus,
} from "./shared";

export async function currentMemberId(sb: SupabaseClient<Database>): Promise<number | null> {
  const { data, error } = await sb.rpc("current_member_id");
  logQueryError("currentMemberId", error);
  return data ?? null;
}

export async function myAvailabilitySubmitted(
  sb: SupabaseClient<Database>,
  prepMeetingId: number,
  memberId: number | null,
): Promise<boolean> {
  if (memberId == null) return false;
  const { count, error } = await sb
    .from("availability")
    .select("*", { count: "exact", head: true })
    .eq("meeting_id", prepMeetingId)
    .eq("member_id", memberId);
  logQueryError("myAvailabilitySubmitted", error);
  return (count ?? 0) > 0;
}

export async function myRsvp(
  sb: SupabaseClient<Database>,
  meetingId: number,
): Promise<RsvpStatus | null> {
  const { data, error } = await sb
    .from("meeting_attendance")
    .select("rsvp_status")
    .eq("meeting_id", meetingId)
    .maybeSingle();
  logQueryError("myRsvp", error);
  return (data?.rsvp_status as RsvpStatus | undefined) ?? null;
}

export type UpcomingRsvp = {
  meeting_id: number;
  type: NextMeeting["type"];
  scheduled_at: string | null;
  location: string | null;
  leader_name: string | null;
  paper_title: string | null;
  rsvp_status: RsvpStatus | null;
};

type UpcomingMeetingRow = Pick<Tables<"meetings">, "id" | "type" | "scheduled_at" | "location"> & {
  members: Pick<Tables<"members">, "name"> | null;
  papers: Pick<Tables<"papers">, "title"> | null;
};

type AttendanceRsvpRow = Pick<Tables<"meeting_attendance">, "meeting_id" | "rsvp_status">;

/**
 * Every upcoming scheduled meeting, each carrying the caller's own RSVP.
 * Backs /me/rsvps — the "Manage your RSVPs" link in the transactional email
 * footers, which lands members on the full list rather than the single next
 * meeting the dashboard hero shows.
 *
 * Two round trips instead of an embed on purpose: PostgREST would emit
 * `meeting_attendance` as a nested array per meeting, and the RLS-scoped embed
 * silently returns [] for a member with no rows — indistinguishable from a
 * dropped join. Fetching the attendance rows separately keeps "no RSVP yet"
 * an explicit null.
 *
 * `memberId` is filtered on in addition to `attendance_select_own` for the
 * same defense-in-depth reason as myAvailabilitySubmitted: if RLS ever loosens
 * or a service-role client is passed in, the missing filter would show one
 * member another member's RSVPs.
 */
export async function upcomingRsvps(
  sb: SupabaseClient<Database>,
  memberId: number | null,
): Promise<UpcomingRsvp[]> {
  const nowIso = new Date().toISOString();

  const { data: meetings, error: meetingsError } = await sb
    .from("meetings")
    .select(
      "id, type, scheduled_at, location, members:leader_id(name), papers:paper_id(title)",
    )
    .eq("status", "scheduled")
    .gte("scheduled_at", nowIso)
    .order("scheduled_at", { ascending: true });
  logQueryError("upcomingRsvps.meetings", meetingsError);

  const rows: UpcomingMeetingRow[] = meetings ?? [];
  if (rows.length === 0) return [];

  const byMeeting = new Map<number, RsvpStatus>();
  if (memberId != null) {
    const { data: attendance, error: attendanceError } = await sb
      .from("meeting_attendance")
      .select("meeting_id, rsvp_status")
      .eq("member_id", memberId)
      .in(
        "meeting_id",
        rows.map((m) => m.id),
      );
    logQueryError("upcomingRsvps.attendance", attendanceError);
    const attendanceRows: AttendanceRsvpRow[] = attendance ?? [];
    for (const a of attendanceRows) {
      byMeeting.set(a.meeting_id, a.rsvp_status as RsvpStatus);
    }
  }

  return rows.map((m) => ({
    meeting_id: m.id,
    type: m.type as NextMeeting["type"],
    scheduled_at: m.scheduled_at,
    location: m.location,
    leader_name: m.members?.name ?? null,
    paper_title: m.papers?.title ?? null,
    rsvp_status: byMeeting.get(m.id) ?? null,
  }));
}

export type Stats = {
  meetingsAttended: number;
  papersLed: number;
  availabilitySubmitted: boolean;
};

export async function myStats(
  sb: SupabaseClient<Database>,
  availabilitySubmitted: boolean,
  memberId: number | null,
): Promise<Stats> {
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
    : Promise.resolve({ count: 0, error: null } as { count: number; error: PostgrestError | null });

  const [{ count: attended, error: attendedError }, { count: led, error: ledError }] =
    await Promise.all([attendedQ, ledQ]);
  logQueryError("myStats.attended", attendedError);
  logQueryError("myStats.led", ledError);

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

type HistoryAttendanceRow = {
  meetings: (Pick<Tables<"meetings">, "id" | "scheduled_at" | "status"> & {
    papers: PaperCompanionEmbed | null;
  }) | null;
};

export async function myHistory(sb: SupabaseClient<Database>, limit = 10): Promise<HistoryItem[]> {
  // `!inner` makes the meetings embed an INNER JOIN, so `meetings.status` filters
  // the meeting_attendance rows themselves — letting the DB do the filtering and
  // ordering and return exactly `limit` rows (no JS post-filter / sort / pad).
  const { data, error } = await sb
    .from("meeting_attendance")
    .select(
      "meetings:meeting_id!inner(id, scheduled_at, status, papers:paper_id(id, title, companion_url, paper_companions(paper_id)))",
    )
    .eq("rsvp_status", "attending")
    .eq("meetings.status", "done")
    .order("scheduled_at", {
      referencedTable: "meetings",
      ascending: false,
      nullsFirst: false,
    })
    .limit(limit);
  logQueryError("myHistory", error);
  const rows: HistoryAttendanceRow[] = data ?? [];

  return rows
    .map((r) => r.meetings)
    .filter((m): m is NonNullable<HistoryAttendanceRow["meetings"]> => m != null)
    .map((m) => ({
      meeting_id: m.id,
      paper_title: m.papers?.title ?? null,
      date: m.scheduled_at ?? null,
      companion_url: companionUrl(m.papers),
    }));
}
