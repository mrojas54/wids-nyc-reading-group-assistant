// Paper lookups for /papers/<id>: the catalog row and the Paper Pal
// synthesis gate.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/lib/database.types";
import { logQueryError } from "./shared";

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
    .maybeSingle();
  logQueryError("paperCatalogRow.meeting", meetingError);
  const leaderRow: LeaderOnlyMeetingRow | null = meeting;

  return {
    id: paper.id,
    title: paper.title,
    authors: paper.authors ?? null,
    leader_name: leaderRow?.members?.name ?? null,
  };
}
