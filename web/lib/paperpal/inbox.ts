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
  meeting_id: number;
  meeting_leader_id: number | null;
  suggested_at: string | null;
  note: string | null;
  suggested_by_id: number | null;
  suggested_by_name: string | null;
  paper: InboxPaper;
};

export type CatalogPaper = { id: number; title: string };

export type InboxViewer = {
  memberId: number | null;
  volunteeredMeetingIds: number[];
};

function mapPaper(p: any): InboxPaper | null {
  if (!p) return null;
  return {
    id: p.id,
    title: p.title ?? "",
    authors: Array.isArray(p.authors) ? p.authors : p.authors ? [p.authors] : null,
    venue: p.venue ?? null,
    companion_url: p.companion_url ?? null,
  };
}

function mapMeeting(m: any): InboxMeeting {
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
  const { data, error } = await sb
    .from("meetings")
    .select(MEETING_SELECT)
    .eq("status", "scheduled")
    .gte("scheduled_at", nowIso)
    .order("scheduled_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(`getCurrentReading: meetings query failed: ${error.message}`);
  }
  return data ? mapMeeting(data) : null;
}

export async function getUpcomingPicks(
  sb: SupabaseClient,
): Promise<InboxMeeting[]> {
  const nowIso = new Date().toISOString();
  const { data, error } = await sb
    .from("meetings")
    .select(MEETING_SELECT)
    .eq("status", "scheduled")
    .gt("scheduled_at", nowIso)
    .not("leader_id", "is", null)
    .order("scheduled_at", { ascending: true });
  if (error) {
    throw new Error(`getUpcomingPicks: meetings query failed: ${error.message}`);
  }
  return (data ?? []).map(mapMeeting);
}

export async function getWantToLead(
  sb: SupabaseClient,
): Promise<InboxSuggestion[]> {
  // paper_suggestions joined to papers + suggester member name; filter out
  // suggestions whose paper already has a meeting with a leader assigned.
  const { data, error } = await sb
    .from("paper_suggestions")
    .select(
      "id, meeting_id, suggested_at, notes, suggested_by, suggester:suggested_by(name), meeting:meeting_id(leader_id), paper:paper_id(id, title, authors, venue, companion_url)",
    )
    .order("suggested_at", { ascending: false });
  if (error) {
    throw new Error(
      `getWantToLead: paper_suggestions query failed: ${error.message}`,
    );
  }

  const rows = (data ?? []).filter((r: any) => r.paper);
  if (rows.length === 0) return [];

  const paperIds = Array.from(new Set(rows.map((r: any) => r.paper.id)));
  const { data: ledMeetings, error: ledMeetingsError } = await sb
    .from("meetings")
    .select("paper_id")
    .in("paper_id", paperIds)
    .not("leader_id", "is", null);
  if (ledMeetingsError) {
    throw new Error(
      `getWantToLead: meetings query failed: ${ledMeetingsError.message}`,
    );
  }
  const assigned = new Set((ledMeetings ?? []).map((m: any) => m.paper_id));

  return rows
    .filter((r: any) => !assigned.has(r.paper.id))
    .map((r: any) => ({
      suggestion_id: r.id,
      meeting_id: r.meeting_id,
      meeting_leader_id: r.meeting?.leader_id ?? null,
      suggested_at: r.suggested_at ?? null,
      note: r.notes ?? null,
      suggested_by_id: r.suggested_by ?? null,
      suggested_by_name: r.suggester?.name ?? null,
      paper: mapPaper(r.paper)!,
    }));
}

// Viewer-scoped facts the Inbox needs to decide which actions to show:
// the current member id and the meetings they've already volunteered for.
export async function getInboxViewer(
  sb: SupabaseClient,
): Promise<InboxViewer> {
  const { data: memberId } = await sb.rpc("current_member_id");
  if (typeof memberId !== "number") {
    return { memberId: null, volunteeredMeetingIds: [] };
  }
  const { data, error } = await sb
    .from("volunteers")
    .select("meeting_id")
    .eq("member_id", memberId);
  if (error) {
    throw new Error(`getInboxViewer: volunteers query failed: ${error.message}`);
  }
  return {
    memberId,
    volunteeredMeetingIds: (data ?? []).map((v: any) => v.meeting_id),
  };
}

// Catalog papers a member can propose to lead, newest first.
export async function listCatalogPapers(
  sb: SupabaseClient,
): Promise<CatalogPaper[]> {
  const { data, error } = await sb
    .from("papers")
    .select("id, title")
    .order("added_at", { ascending: false });
  if (error) {
    throw new Error(`listCatalogPapers: papers query failed: ${error.message}`);
  }
  return (data ?? []).map((p: any) => ({ id: p.id, title: p.title ?? "" }));
}

export async function getRecentlyDiscussed(
  sb: SupabaseClient,
  limit = 10,
): Promise<InboxMeeting[]> {
  const nowIso = new Date().toISOString();
  const { data, error } = await sb
    .from("meetings")
    .select(MEETING_SELECT)
    .or(`status.eq.done,and(status.neq.cancelled,scheduled_at.lt.${nowIso})`)
    .order("scheduled_at", { ascending: false })
    .limit(limit);
  if (error) {
    throw new Error(
      `getRecentlyDiscussed: meetings query failed: ${error.message}`,
    );
  }
  return (data ?? []).map(mapMeeting);
}

export async function getInbox(sb: SupabaseClient) {
  const [reading, upcoming, suggestions, past, viewer, catalogPapers] =
    await Promise.all([
      getCurrentReading(sb),
      getUpcomingPicks(sb),
      getWantToLead(sb),
      getRecentlyDiscussed(sb),
      getInboxViewer(sb),
      listCatalogPapers(sb),
    ]);
  // Drop the "reading now" meeting from "upcoming picks" so it isn't listed twice.
  const filteredUpcoming = reading
    ? upcoming.filter((m) => m.meeting_id !== reading.meeting_id)
    : upcoming;
  return {
    reading,
    upcoming: filteredUpcoming,
    suggestions,
    past,
    viewer,
    catalogPapers,
  };
}
