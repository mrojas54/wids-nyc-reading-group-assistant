// Server-side data accessors for the dashboard.
// All queries assume the supplied client respects RLS (server.ts client).
//
// The `<Database>` generic is load-bearing, not decoration. `SupabaseClient`'s
// generic parameter defaults to `any`, so a bare annotation silently discards
// the schema types that lib/supabase/{server,browser,service}.ts attach at
// construction. Without it `tsc` accepted `.from("meetingz")` — a table that
// does not exist — with zero errors. Keep the generic on every accessor's
// client parameter.
//
// What it catches, as measured on this file: unknown table in .from(), unknown
// function in .rpc(), unknown column in filters (.eq/.gte/.order/...), and
// unknown column inside a .select("a, b, c") string.
//
// That last one has a catch worth knowing about. postgrest-js does detect it,
// but it reports it *in the result type* rather than at the call:
//
//   .select("id, bogus_col")
//     -> SelectQueryError<"column 'bogus_col' does not exist on 'meetings'."> | null
//
// which is only an error once something consumes `data` in a type-checked way.
// Row mappers and casts that widen back to `any` swallow that diagnostic, so
// it's computed and then discarded. The `.returns<...>()` calls below pin
// each embedded select to an explicit shape built from Tables<"..."> — that's
// what makes a renamed/dropped column surface as a real tsc error instead of
// a silent `undefined` at runtime.
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/lib/database.types";

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

// Shape of the `papers:paper_id(...)` embed used by nextMeeting/myHistory —
// built from the generated Row types so a renamed/dropped column on either
// table is a compile error here, not a silently-undefined field at runtime.
type PaperCompanionEmbed = Pick<Tables<"papers">, "id" | "title" | "companion_url"> & {
  paper_companions: Pick<Tables<"paper_companions">, "paper_id">[] | Pick<Tables<"paper_companions">, "paper_id"> | null;
};

type MeetingWithLeaderAndPaper = Pick<
  Tables<"meetings">,
  "id" | "type" | "status" | "scheduled_at" | "location" | "leader_id" | "paper_id"
> & {
  members: Pick<Tables<"members">, "name"> | null;
  papers: PaperCompanionEmbed | null;
};

function logQueryError(fn: string, error: PostgrestError | null): void {
  if (!error) return;
  console.error(JSON.stringify({ event: "query_failed", fn, message: error.message, code: error.code }));
}

export async function nextMeeting(sb: SupabaseClient<Database>): Promise<NextMeeting | null> {
  const nowIso = new Date().toISOString();

  const { data: scheduled, error: scheduledError } = await sb
    .from("meetings")
    .select(
      "id, type, status, scheduled_at, location, leader_id, paper_id, members:leader_id(name), papers:paper_id(id, title, companion_url, paper_companions(paper_id))",
    )
    .eq("status", "scheduled")
    .gte("scheduled_at", nowIso)
    .order("scheduled_at", { ascending: true })
    .limit(1)
    .maybeSingle()
    .returns<MeetingWithLeaderAndPaper>();
  logQueryError("nextMeeting.scheduled", scheduledError);

  if (scheduled) return mapMeeting(scheduled);

  const { data: prep, error: prepError } = await orderNewestPrep(
    sb
      .from("meetings")
      .select(
        "id, type, status, scheduled_at, location, leader_id, paper_id, members:leader_id(name), papers:paper_id(id, title, companion_url, paper_companions(paper_id))",
      )
      .eq("status", "prep"),
  )
    .limit(1)
    .maybeSingle()
    .returns<MeetingWithLeaderAndPaper>();
  logQueryError("nextMeeting.prep", prepError);

  return prep ? mapMeeting(prep) : null;
}

/**
 * Orders a `status=prep` meetings query so that "the newest prep meeting" is a
 * TOTAL order — one row, always the same row.
 *
 * created_at alone is not enough. It defaults to now(), which in Postgres is
 * transaction_timestamp() — fixed for the whole transaction — and the cycle
 * bootstrap inserts the admin + reading_group pair in a SINGLE transaction. The
 * two rows therefore carry a byte-identical created_at every cycle (observed
 * 2026-07-14 on meetings #36/#37), and an ORDER BY that ties is only a partial
 * order: Postgres may hand back either row, and will happily change its mind
 * when the plan changes. So break the tie deliberately:
 *
 *   type — TEXT with a CHECK, not an enum, so DESC sorts lexicographically and
 *          puts 'reading_group' ahead of 'admin'. Members should be pointed at
 *          the paper, not the admin slot. An admin meeting is still returned
 *          when it is the only thing in prep — it collects availability too.
 *   id   — SERIAL: unique and non-null, the backstop that makes the order total
 *          no matter what else ties.
 *
 * Shared by every "current prep meeting" lookup on purpose. If the dashboard
 * and /availability ordered differently, the dashboard could nudge a member
 * toward one meeting while the form it deep-links to resolved to the other.
 */
function orderNewestPrep<Q extends { order(col: string, opts: { ascending: boolean }): Q }>(
  q: Q,
): Q {
  return q
    .order("created_at", { ascending: false })
    .order("type", { ascending: false })
    .order("id", { ascending: false });
}

export type PrepMeetingRef = { id: number; type: string };

/**
 * The prep meeting members are currently being scheduled into — the same row
 * nextMeeting()'s tier-2 fallback lands on. Used by /availability when no
 * `?meeting=<id>` param pins a specific meeting.
 */
export async function newestPrepMeeting(sb: SupabaseClient<Database>): Promise<PrepMeetingRef | null> {
  const { data, error } = await orderNewestPrep(
    sb.from("meetings").select("id, type").eq("status", "prep"),
  )
    .limit(1)
    .maybeSingle();
  logQueryError("newestPrepMeeting", error);
  return data ?? null;
}

// Paper Pal stores each companion in `paper_companions` and renders it at
// /papers/<paper_id>. The legacy `papers.companion_url` column holds a
// denormalised copy of that same path, left over from the retired
// /wids-make-companion flow — and the Paper Pal generator never writes it, so it
// is NULL for every Paper-Pal-era paper. Gating on the column therefore hid every
// Paper Pal companion. The companion row is the source of truth; fall back to the
// column only for pre-Paper-Pal papers that have one.
function companionUrl(papers: PaperCompanionEmbed | null): string | null {
  // paper_companions.paper_id is both PK and FK, so PostgREST may collapse this
  // 1-to-1 embed to a bare object instead of a single-element array.
  const embed = papers?.paper_companions;
  const hasCompanion = Array.isArray(embed) ? embed.length > 0 : embed != null;

  if (hasCompanion && papers?.id != null) return `/papers/${papers.id}`;
  return papers?.companion_url ?? null;
}

function mapMeeting(row: MeetingWithLeaderAndPaper): NextMeeting {
  return {
    id: row.id,
    type: row.type as NextMeeting["type"],
    status: row.status as MeetingStatus,
    scheduled_at: row.scheduled_at,
    location: row.location,
    leader_name: row.members?.name ?? null,
    paper_id: row.paper_id,
    paper_title: row.papers?.title ?? null,
    companion_url: companionUrl(row.papers),
  };
}

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
    .order("scheduled_at", { ascending: true })
    .returns<UpcomingMeetingRow[]>();
  logQueryError("upcomingRsvps.meetings", meetingsError);

  const rows = meetings ?? [];
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
      )
      .returns<AttendanceRsvpRow[]>();
    logQueryError("upcomingRsvps.attendance", attendanceError);
    for (const a of attendance ?? []) {
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

// Discriminated union — makes the illegal state
// `{canSynthesize: true, reason: "none"}` a compile error and frees
// callers from having to defensively check both fields independently.
export type SynthesisGate =
  | { canSynthesize: true; reason: "owner" | "leader" }
  | { canSynthesize: false; reason: "none" };

/**
 * Paper Pal synthesis gate. Returns canSynthesize=true when the caller is
 * the chapter owner (role in operator/admin) OR the leader of any meeting
 * that uses this paper. Safe to call on the public /papers/<id> route —
 * unauthenticated callers get { canSynthesize: false, reason: "none" }.
 *
 * Thin wrapper over the can_synthesize_paper_pal SECURITY DEFINER RPC
 * (migration 017), so the gate logic stays identical across Node and the
 * Deno Edge Functions.
 *
 * See docs/superpowers/specs/2026-05-17-paper-pal-edge-functions.md §7.
 */
export async function canSynthesizePaperPal(
  sb: SupabaseClient<Database>,
  paperId: number,
): Promise<SynthesisGate> {
  const { data, error } = await sb.rpc("can_synthesize_paper_pal", {
    p_paper_id: paperId,
  });
  logQueryError("canSynthesizePaperPal", error);
  if (error || !data) return { canSynthesize: false, reason: "none" };
  const row = data as { canSynthesize?: boolean; reason?: string };
  if (row.canSynthesize === true && (row.reason === "owner" || row.reason === "leader")) {
    return { canSynthesize: true, reason: row.reason };
  }
  return { canSynthesize: false, reason: "none" };
}

export type PaperCatalogRow = {
  id: number;
  title: string;
  authors: string[] | null;
  leader_name: string | null;
};

type LeaderOnlyMeetingRow = {
  members: Pick<Tables<"members">, "name"> | null;
};

/** Looks up papers.id and joins the most recent meeting's leader, if any. */
export async function paperCatalogRow(
  sb: SupabaseClient<Database>,
  paperId: number,
): Promise<PaperCatalogRow | null> {
  const { data: paper, error: paperError } = await sb
    .from("papers")
    .select("id, title, authors")
    .eq("id", paperId)
    .maybeSingle();
  logQueryError("paperCatalogRow.paper", paperError);
  if (!paper) return null;

  const { data: meeting, error: meetingError } = await sb
    .from("meetings")
    .select("members:leader_id(name)")
    .eq("paper_id", paperId)
    .order("scheduled_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()
    .returns<LeaderOnlyMeetingRow>();
  logQueryError("paperCatalogRow.meeting", meetingError);

  return {
    id: paper.id,
    title: paper.title,
    authors: paper.authors ?? null,
    leader_name: meeting?.members?.name ?? null,
  };
}

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
    .limit(limit)
    .returns<HistoryAttendanceRow[]>();
  logQueryError("myHistory", error);

  return (data ?? [])
    .map((r) => r.meetings)
    .filter((m): m is NonNullable<HistoryAttendanceRow["meetings"]> => m != null)
    .map((m) => ({
      meeting_id: m.id,
      paper_title: m.papers?.title ?? null,
      date: m.scheduled_at ?? null,
      companion_url: companionUrl(m.papers),
    }));
}
