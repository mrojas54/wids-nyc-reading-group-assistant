// Synthesis gate + role helpers used by analyze-paper / analyze-hint /
// analyze-socratic. All three need at least one of:
//   - the synthesis gate (analyze-paper: write privilege)
//   - the looser "attending member" gate (analyze-hint / analyze-socratic)
import type { SupabaseClient } from "@supabase/supabase-js";

// Discriminated union mirrors web/lib/queries.ts — makes the illegal
// state `{canSynthesize: true, reason: "none"}` a compile error.
export type SynthesisGate =
  | { canSynthesize: true; reason: "owner" | "leader" }
  | { canSynthesize: false; reason: "none" };

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

export async function currentMemberId(sb: SupabaseClient): Promise<number | null> {
  const { data } = await sb.rpc("current_member_id");
  return (data as number | null) ?? null;
}

/**
 * Returns the caller's role via the current_member_role SECURITY DEFINER
 * RPC (migration 016). The RPC reads `members.role` with definer rights,
 * so this works even if the `members` SELECT policy is tightened to
 * exclude the `role` column from regular authenticated reads.
 *
 * memberId parameter is unused but kept for call-site stability — the RPC
 * already derives identity from auth.uid().
 */
export async function getMemberRole(
  sb: SupabaseClient,
  _memberId: number,
): Promise<string | null> {
  const { data, error } = await sb.rpc("current_member_role");
  if (error) {
    console.error("[gate] current_member_role RPC failed:", error.message);
    return null;
  }
  return (data as string | null) ?? null;
}

// Looser gate for hint/socratic — any signed-in member with an 'attending'
// RSVP for a meeting using this paper. Owners and leaders pass too (a
// leader is by definition attending the meeting they lead).
export async function canRequestHint(
  sb: SupabaseClient,
  paperId: number,
  memberId: number,
): Promise<boolean> {
  // Owners always pass.
  const role = await getMemberRole(sb, memberId);
  if (role === "operator" || role === "admin") return true;

  // Anyone with an attending RSVP for a meeting that uses this paper.
  const { data, error } = await sb
    .from("meeting_attendance")
    .select("meeting_id, meetings!inner(paper_id)")
    .eq("member_id", memberId)
    .eq("rsvp_status", "attending")
    .eq("meetings.paper_id", paperId)
    .limit(1);
  if (error) {
    // Surface the error so a DB issue (RLS regression, network) doesn't
    // present to the user as a 403 "not_attending" — caller still gets
    // false here, but the on-call signal exists in logs.
    console.error("[gate] canRequestHint attendance query failed:", error);
    return false;
  }
  return (data?.length ?? 0) > 0;
}
