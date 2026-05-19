// Server-only DB helpers for the PaperPal Inbox screen.
// Each function maps one of the four sections defined in
// design_handoff/architecture.md → "Inbox query".
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type InboxPaper = {
  id: number;
  title: string;
  authors: string[] | null;
  venue: string | null;
  companion_url: string | null;
};

export type InboxMeeting = {
  meeting_id: number;
  scheduled_at: string | null;
  location: string | null;
  status: string;
  leader_id: number | null;
  leader_name: string | null;
  paper: InboxPaper | null;
};

export type InboxSuggestion = {
  suggestion_id: number;
  suggested_at: string | null;
  note: string | null;
  suggested_by_id: number | null;
  suggested_by_name: string | null;
  paper: InboxPaper;
};

// Row shapes for the joins below. PostgREST returns single-row foreign-key
// joins as the row itself (not an array) when the FK is non-multivalued.
type PaperRow = {
  id: number;
  title: string | null;
  authors: string[] | string | null;
  venue: string | null;
  companion_url: string | null;
};

type MeetingRow = {
  id: number;
  status: string;
  scheduled_at: string | null;
  location: string | null;
  leader_id: number | null;
  leader: { name: string | null } | null;
  paper: PaperRow | null;
};

type SuggestionRow = {
  id: number;
  created_at: string | null;
  note: string | null;
  suggested_by: number | null;
  suggester: { name: string | null } | null;
  paper: PaperRow | null;
};

function mapPaper(p: PaperRow | null | undefined): InboxPaper | null {
  if (!p) return null;
  return {
    id: p.id,
    title: p.title ?? "",
    authors: Array.isArray(p.authors) ? p.authors : p.authors ? [p.authors] : null,
    venue: p.venue ?? null,
    companion_url: p.companion_url ?? null,
  };
}

function mapMeeting(m: MeetingRow): InboxMeeting {
  return {
    meeting_id: m.id,
    scheduled_at: m.scheduled_at ?? null,
    location: m.location ?? null,
    status: m.status,
    leader_id: m.leader_id ?? null,
    leader_name: m.leader?.name ?? null,
    paper: mapPaper(m.paper),
  };
}

const MEETING_SELECT =
  "id, status, scheduled_at, location, leader_id, leader:leader_id(name), paper:paper_id(id, title, authors, venue, companion_url)";

export async function getCurrentReading(
  sb: SupabaseClient,
): Promise<InboxMeeting | null> {
  const nowIso = new Date().toISOString();
  const { data } = await sb
    .from("meetings")
    .select(MEETING_SELECT)
    .eq("status", "scheduled")
    .gte("scheduled_at", nowIso)
    .order("scheduled_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data ? mapMeeting(data as unknown as MeetingRow) : null;
}

export async function getUpcomingPicks(
  sb: SupabaseClient,
): Promise<InboxMeeting[]> {
  const nowIso = new Date().toISOString();
  const { data } = await sb
    .from("meetings")
    .select(MEETING_SELECT)
    .eq("status", "scheduled")
    .gt("scheduled_at", nowIso)
    .not("leader_id", "is", null)
    .order("scheduled_at", { ascending: true });
  return ((data ?? []) as unknown as MeetingRow[]).map(mapMeeting);
}

export async function getWantToLead(
  sb: SupabaseClient,
): Promise<InboxSuggestion[]> {
  // paper_suggestions joined to papers + suggester member name; filter out
  // suggestions whose paper already has a meeting with a leader assigned.
  const { data } = await sb
    .from("paper_suggestions")
    .select(
      "id, created_at, note, suggested_by, suggester:suggested_by(name), paper:paper_id(id, title, authors, venue, companion_url)",
    )
    .order("created_at", { ascending: false });

  const rows = ((data ?? []) as unknown as SuggestionRow[]).filter(
    (r): r is SuggestionRow & { paper: PaperRow } => r.paper != null,
  );
  if (rows.length === 0) return [];

  const paperIds = Array.from(new Set(rows.map((r) => r.paper.id)));
  const { data: ledMeetings } = await sb
    .from("meetings")
    .select("paper_id")
    .in("paper_id", paperIds)
    .not("leader_id", "is", null);
  const assigned = new Set(
    ((ledMeetings ?? []) as { paper_id: number }[]).map((m) => m.paper_id),
  );

  return rows
    .filter((r) => !assigned.has(r.paper.id))
    .map((r) => ({
      suggestion_id: r.id,
      suggested_at: r.created_at ?? null,
      note: r.note ?? null,
      suggested_by_id: r.suggested_by ?? null,
      suggested_by_name: r.suggester?.name ?? null,
      paper: mapPaper(r.paper)!,
    }));
}

export async function getRecentlyDiscussed(
  sb: SupabaseClient,
  limit = 10,
): Promise<InboxMeeting[]> {
  const nowIso = new Date().toISOString();
  const { data } = await sb
    .from("meetings")
    .select(MEETING_SELECT)
    .or(`status.eq.done,and(status.neq.cancelled,scheduled_at.lt.${nowIso})`)
    .order("scheduled_at", { ascending: false })
    .limit(limit);
  return ((data ?? []) as unknown as MeetingRow[]).map(mapMeeting);
}

export async function getInbox(sb: SupabaseClient) {
  const [reading, upcoming, suggestions, past] = await Promise.all([
    getCurrentReading(sb),
    getUpcomingPicks(sb),
    getWantToLead(sb),
    getRecentlyDiscussed(sb),
  ]);
  // Drop the "reading now" meeting from "upcoming picks" so it isn't listed twice.
  const filteredUpcoming = reading
    ? upcoming.filter((m) => m.meeting_id !== reading.meeting_id)
    : upcoming;
  return { reading, upcoming: filteredUpcoming, suggestions, past };
}
