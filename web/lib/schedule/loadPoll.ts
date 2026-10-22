// Server-side loader for /admin/schedule. Takes the SERVICE client on purpose:
// availability is RLS-locked to each member's own rows (availability_select_own,
// migration 002) and members.active is outside the authenticated column grant
// (migration 031), so the operator's cross-roster view cannot be read through
// the session client. The route is behind requireOperatorRole before this runs.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/lib/database.types";
import { isDayBlackedOut } from "@/lib/blackout";
import { nyDayKey } from "@/lib/time";
import { pollWindowFrom, type PollMember, type PollResponse, type PollWindow } from "./poll";

export type SchedulePaper = {
  id: number;
  title: string;
  authors: string[] | null;
  year: number | null;
  url: string | null;
  hasPaperPal: boolean;
};

export type ScheduleMeeting = {
  id: number;
  created_at: string;
  leader_id: number | null;
  leader_name: string | null;
  paper: SchedulePaper | null;
};

export type SchedulePageData = {
  /** The cycle's canonical reading_group meeting in prep, or null when there is nothing to schedule. */
  meeting: ScheduleMeeting | null;
  members: PollMember[];
  responses: PollResponse[];
  /** Marked evenings that have since fallen inside a blackout window. */
  excludedDays: string[];
  /** The span of evenings members could pick from. */
  pollWindow: PollWindow | null;
  /** The venue of the last booked reading group — the group's usual room. */
  defaultLocation: string | null;
  /** When members were asked to answer by. */
  pollClosesAt: string | null;
};

// Same row shape trick as lib/queries.ts: land the embedded select in a typed
// alias so a renamed column in the select string is a compile error here.
type PrepMeetingRow = Pick<Tables<"meetings">, "id" | "created_at" | "leader_id" | "paper_id"> & {
  members: Pick<Tables<"members">, "name"> | null;
  papers:
    | (Pick<Tables<"papers">, "id" | "title" | "authors" | "year" | "url"> & {
        paper_companions:
          | Pick<Tables<"paper_companions">, "paper_id">[]
          | Pick<Tables<"paper_companions">, "paper_id">
          | null;
      })
    | null;
};

type AvailabilityRow = Pick<Tables<"availability">, "member_id" | "range_start">;
type BlackoutRow = Pick<Tables<"blackout_periods">, "range_start" | "range_end">;

/**
 * Members were told to answer within a week of the poll opening
 * (/wids-meeting-start Step A3/R3: "please submit availability by <today + 7
 * days>"). The date is not stored, so it is re-derived from the meeting's
 * created_at here. (availability-chase's reminder emails use a softer
 * "upcoming Sunday evening"; the banner follows the date members were told.)
 */
export function pollClosesAt(meeting: Pick<ScheduleMeeting, "created_at">): string {
  const opened = new Date(meeting.created_at);
  return new Date(opened.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
}

export async function loadSchedulePoll(
  svc: SupabaseClient<Database>,
): Promise<SchedulePageData> {
  // planned_by_admin_id IS NOT NULL is the cycle's canonical reading group —
  // the same filter /wids-schedule-reading-group Step 1 uses, so this page and
  // the slash command always land on the same row and never on a member's
  // proposePaper placeholder (which is also reading_group + prep).
  const { data: meetingRow, error: meetingError } = await svc
    .from("meetings")
    .select(
      "id, created_at, leader_id, paper_id, members:leader_id(name), papers:paper_id(id, title, authors, year, url, paper_companions(paper_id))",
    )
    .eq("type", "reading_group")
    .eq("status", "prep")
    .not("planned_by_admin_id", "is", null)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (meetingError) throw new Error(`loadSchedulePoll.meeting: ${meetingError.message}`);
  const row: PrepMeetingRow | null = meetingRow;

  const [membersRes, lastVenueRes] = await Promise.all([
    svc.from("members").select("id, name").eq("active", true).order("name", { ascending: true }),
    svc
      .from("meetings")
      .select("location")
      .eq("type", "reading_group")
      .in("status", ["scheduled", "done"])
      .not("location", "is", null)
      .order("scheduled_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (membersRes.error) throw new Error(`loadSchedulePoll.members: ${membersRes.error.message}`);
  const members: PollMember[] = (membersRes.data ?? []).map((m) => ({ id: m.id, name: m.name }));
  const defaultLocation = lastVenueRes.data?.location ?? null;

  if (!row) {
    return {
      meeting: null,
      members,
      responses: [],
      excludedDays: [],
      pollWindow: null,
      defaultLocation,
      pollClosesAt: null,
    };
  }

  const [availabilityRes, blackoutRes] = await Promise.all([
    svc.from("availability").select("member_id, range_start").eq("meeting_id", row.id),
    svc.from("blackout_periods").select("range_start, range_end"),
  ]);
  if (availabilityRes.error) {
    throw new Error(`loadSchedulePoll.availability: ${availabilityRes.error.message}`);
  }
  const availabilityRows: AvailabilityRow[] = availabilityRes.data ?? [];
  const responses: PollResponse[] = availabilityRows.map((r) => ({
    member_id: r.member_id,
    day: nyDayKey(r.range_start),
  }));

  // Display-only, like /availability: a failed blackout read means no
  // greying, not a bypass — scheduleMeeting re-checks blackouts authoritatively.
  const periods: BlackoutRow[] = blackoutRes.data ?? [];
  const distinctDays = [...new Set(responses.map((r) => r.day))];
  const excludedDays = distinctDays.filter((d) => isDayBlackedOut(d, periods));

  const embed = row.papers?.paper_companions;
  const hasPaperPal = Array.isArray(embed) ? embed.length > 0 : embed != null;

  return {
    meeting: {
      id: row.id,
      created_at: row.created_at,
      leader_id: row.leader_id,
      leader_name: row.members?.name ?? null,
      paper: row.papers
        ? {
            id: row.papers.id,
            title: row.papers.title,
            authors: row.papers.authors,
            year: row.papers.year,
            url: row.papers.url,
            hasPaperPal,
          }
        : null,
    },
    members,
    responses,
    excludedDays,
    pollWindow: pollWindowFrom(
      nyDayKey(row.created_at),
      distinctDays.filter((d) => !excludedDays.includes(d)),
    ),
    defaultLocation,
    pollClosesAt: pollClosesAt(row),
  };
}
