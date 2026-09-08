// Server-only DB helpers for the PaperPal Inbox screen.
// Each function maps one of the four sections defined in
// design_handoff/architecture.md → "Inbox query".
//
// Typing: the `<Database>` generic on the client gets `.from()` / `.rpc()` /
// filter-column checking, and each select's *inferred* result flows into a
// mapper whose parameter is a shape built from `Tables<"...">`. That
// assignment is the guard. postgrest-js reports an unknown column inside a
// select string in the result type (the field becomes a `SelectQueryError`),
// so a renamed or dropped column in MEETING_SELECT fails to type-check at the
// mapper call instead of surfacing as `undefined` at runtime.
//
// Deliberately NOT `.returns<T>()` — see the header of lib/queries.ts for
// why that is a cast in postgrest-js 2.x and swallows the diagnostic.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/lib/database.types";

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

// ── Row shapes, built from the generated Row types ──────────────────────────

type PaperEmbed = Pick<
  Tables<"papers">,
  "id" | "title" | "authors" | "venue" | "companion_url"
>;

type MeetingRow = Pick<
  Tables<"meetings">,
  "id" | "status" | "scheduled_at" | "location" | "leader_id"
> & {
  leader: Pick<Tables<"members">, "name"> | null;
  paper: PaperEmbed | null;
};

type SuggestionRow = Pick<
  Tables<"paper_suggestions">,
  "id" | "meeting_id" | "suggested_at" | "notes" | "suggested_by"
> & {
  suggester: Pick<Tables<"members">, "name"> | null;
  // paper_suggestions.meeting_id is NOT NULL, so the embed is never null.
  meeting: Pick<Tables<"meetings">, "leader_id">;
  // paper_id is NOT NULL too, but RLS can hide the papers row; keep the
  // runtime filter below and let the type say so.
  paper: PaperEmbed | null;
};

type SuggestionWithPaper = SuggestionRow & { paper: PaperEmbed };

function mapPaper(p: PaperEmbed | null): InboxPaper | null {
  if (!p) return null;
  return {
    id: p.id,
    title: p.title ?? "",
    authors: p.authors ?? null,
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

function mapSuggestion(r: SuggestionWithPaper, paper: InboxPaper): InboxSuggestion {
  return {
    suggestion_id: r.id,
    meeting_id: r.meeting_id,
    meeting_leader_id: r.meeting.leader_id ?? null,
    suggested_at: r.suggested_at ?? null,
    note: r.notes ?? null,
    suggested_by_id: r.suggested_by ?? null,
    suggested_by_name: r.suggester?.name ?? null,
    paper,
  };
}

const MEETING_SELECT =
  "id, status, scheduled_at, location, leader_id, leader:leader_id(name), paper:paper_id(id, title, authors, venue, companion_url)";

const SUGGESTION_SELECT =
  "id, meeting_id, suggested_at, notes, suggested_by, suggester:suggested_by(name), meeting:meeting_id(leader_id), paper:paper_id(id, title, authors, venue, companion_url)";

export async function getCurrentReading(
  sb: SupabaseClient<Database>,
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
  sb: SupabaseClient<Database>,
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
  sb: SupabaseClient<Database>,
): Promise<InboxSuggestion[]> {
  // paper_suggestions joined to papers + suggester member name; filter out
  // suggestions whose paper already has a meeting with a leader assigned.
  const { data, error } = await sb
    .from("paper_suggestions")
    .select(SUGGESTION_SELECT)
    .order("suggested_at", { ascending: false });
  if (error) {
    throw new Error(
      `getWantToLead: paper_suggestions query failed: ${error.message}`,
    );
  }

  const rows: SuggestionWithPaper[] = (data ?? []).filter(
    (r): r is SuggestionWithPaper => r.paper !== null,
  );
  if (rows.length === 0) return [];

  const paperIds = Array.from(new Set(rows.map((r) => r.paper.id)));
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
  const assigned = new Set((ledMeetings ?? []).map((m) => m.paper_id));

  const out: InboxSuggestion[] = [];
  for (const r of rows) {
    if (assigned.has(r.paper.id)) continue;
    const paper = mapPaper(r.paper);
    if (paper) out.push(mapSuggestion(r, paper));
  }
  return out;
}

// Viewer-scoped facts the Inbox needs to decide which actions to show:
// the current member id and the meetings they've already volunteered for.
export async function getInboxViewer(
  sb: SupabaseClient<Database>,
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
    volunteeredMeetingIds: (data ?? []).map((v) => v.meeting_id),
  };
}

// Catalog papers a member can propose to lead, newest first.
export async function listCatalogPapers(
  sb: SupabaseClient<Database>,
): Promise<CatalogPaper[]> {
  const { data, error } = await sb
    .from("papers")
    .select("id, title")
    .order("added_at", { ascending: false });
  if (error) {
    throw new Error(`listCatalogPapers: papers query failed: ${error.message}`);
  }
  return (data ?? []).map((p) => ({ id: p.id, title: p.title ?? "" }));
}

export async function getRecentlyDiscussed(
  sb: SupabaseClient<Database>,
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

export async function getInbox(sb: SupabaseClient<Database>) {
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
