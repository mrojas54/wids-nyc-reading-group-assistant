// The next meeting a member should see, and the prep meeting members are
// currently giving availability for.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/lib/database.types";
import {
  companionUrl,
  logQueryError,
  type MeetingStatus,
  type PaperCompanionEmbed,
} from "./shared";

export type NextMeeting = {
  id: number;
  type: "admin" | "reading_group" | "vibe_session";
  status: MeetingStatus;
  scheduled_at: string | null;
  location: string | null;
  leader_name: string | null;
  paper_id: number | null;
  paper_title: string | null;
  companion_url: string | null;
};

type MeetingWithLeaderAndPaper = Pick<
  Tables<"meetings">,
  "id" | "type" | "status" | "scheduled_at" | "location" | "leader_id" | "paper_id"
> & {
  members: Pick<Tables<"members">, "name"> | null;
  papers: PaperCompanionEmbed | null;
};

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
    .maybeSingle();
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
    .maybeSingle();
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
 *
 * `type` itself is no longer the sort key. It used to be — TEXT with a CHECK,
 * not an enum, DESC happened to put 'reading_group' ahead of 'admin' — but
 * that only worked by coincidence of spelling. Adding a third type,
 * 'vibe_session', broke it silently: 'vibe_session' > 'reading_group'
 * alphabetically, which would have promoted a vibe session over a paper
 * discussion. `type_priority` (migration 034) is an explicit generated
 * column — reading_group=2, vibe_session=1, admin=0 — so precedence reads
 * from a number, not from how the type happens to be spelled.
 */
function orderNewestPrep<Q extends { order(col: string, opts: { ascending: boolean }): Q }>(
  q: Q,
): Q {
  return q
    .order("created_at", { ascending: false })
    .order("type_priority", { ascending: false })
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
