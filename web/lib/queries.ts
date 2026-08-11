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
      "id, type, status, scheduled_at, location, leader_id, paper_id, members:leader_id(name), papers:paper_id(id, title, companion_url, paper_companions(paper_id))",
    )
    .eq("status", "scheduled")
    .gte("scheduled_at", nowIso)
    .order("scheduled_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (scheduled) return mapMeeting(scheduled);

  const { data: prep } = await orderNewestPrep(
    sb
      .from("meetings")
      .select(
        "id, type, status, scheduled_at, location, leader_id, paper_id, members:leader_id(name), papers:paper_id(id, title, companion_url, paper_companions(paper_id))",
      )
      .eq("status", "prep"),
  )
    .limit(1)
    .maybeSingle();

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
export async function newestPrepMeeting(sb: SupabaseClient): Promise<PrepMeetingRef | null> {
  const { data } = await orderNewestPrep(
    sb.from("meetings").select("id, type").eq("status", "prep"),
  )
    .limit(1)
    .maybeSingle();
  return (data as PrepMeetingRef | null) ?? null;
}

// Paper Pal stores each companion in `paper_companions` and renders it at
// /papers/<paper_id>. The legacy `papers.companion_url` column holds a
// denormalised copy of that same path, left over from the retired
// /wids-make-companion flow — and the Paper Pal generator never writes it, so it
// is NULL for every Paper-Pal-era paper. Gating on the column therefore hid every
// Paper Pal companion. The companion row is the source of truth; fall back to the
// column only for pre-Paper-Pal papers that have one.
function companionUrl(papers: any): string | null {
  // paper_companions.paper_id is both PK and FK, so PostgREST may collapse this
  // 1-to-1 embed to a bare object instead of a single-element array.
  const embed = papers?.paper_companions;
  const hasCompanion = Array.isArray(embed) ? embed.length > 0 : embed != null;

  if (hasCompanion && papers?.id != null) return `/papers/${papers.id}`;
  return papers?.companion_url ?? null;
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
    companion_url: companionUrl(row.papers),
  };
}

export async function currentMemberId(sb: SupabaseClient): Promise<number | null> {
  const { data } = await sb.rpc("current_member_id");
  return (data as number | null) ?? null;
}

export async function myAvailabilitySubmitted(
  sb: SupabaseClient,
  prepMeetingId: number,
  memberId: number | null,
): Promise<boolean> {
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

export type UpcomingRsvp = {
  meeting_id: number;
  type: NextMeeting["type"];
  scheduled_at: string | null;
  location: string | null;
  leader_name: string | null;
  paper_title: string | null;
  rsvp_status: RsvpStatus | null;
};

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
  sb: SupabaseClient,
  memberId: number | null,
): Promise<UpcomingRsvp[]> {
  const nowIso = new Date().toISOString();

  const { data: meetings } = await sb
    .from("meetings")
    .select(
      "id, type, scheduled_at, location, members:leader_id(name), papers:paper_id(title)",
    )
    .eq("status", "scheduled")
    .gte("scheduled_at", nowIso)
    .order("scheduled_at", { ascending: true });

  const rows = (meetings ?? []) as any[];
  if (rows.length === 0) return [];

  const byMeeting = new Map<number, RsvpStatus>();
  if (memberId != null) {
    const { data: attendance } = await sb
      .from("meeting_attendance")
      .select("meeting_id, rsvp_status")
      .eq("member_id", memberId)
      .in(
        "meeting_id",
        rows.map((m) => m.id),
      );
    for (const a of (attendance ?? []) as any[]) {
      byMeeting.set(a.meeting_id, a.rsvp_status as RsvpStatus);
    }
  }

  return rows.map((m) => ({
    meeting_id: m.id,
    type: m.type,
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
  sb: SupabaseClient,
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
  sb: SupabaseClient,
  paperId: number,
): Promise<SynthesisGate> {
  const { data, error } = await sb.rpc("can_synthesize_paper_pal", {
    p_paper_id: paperId,
  });
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
  // `!inner` makes the meetings embed an INNER JOIN, so `meetings.status` filters
  // the meeting_attendance rows themselves — letting the DB do the filtering and
  // ordering and return exactly `limit` rows (no JS post-filter / sort / pad).
  const { data } = await sb
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

  return (data ?? [])
    .map((r: any) => r.meetings)
    .filter((m: any) => m)
    .map((m: any) => ({
      meeting_id: m.id,
      paper_title: m.papers?.title ?? null,
      date: m.scheduled_at ?? null,
      companion_url: companionUrl(m.papers),
    }));
}
