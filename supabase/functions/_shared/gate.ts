// Synthesis gate + role helpers used by analyze-paper / analyze-hint /
// analyze-socratic. All three need at least one of:
//   - the synthesis gate (analyze-paper: write privilege)
//   - the looser "attending member" gate (analyze-hint / analyze-socratic)
import type { SupabaseClient } from "@supabase/supabase-js";

export type SynthesisGate = {
  canSynthesize: boolean;
  reason: "owner" | "leader" | "none";
};

export async function canSynthesizePaperPal(
  sb: SupabaseClient,
  paperId: number,
): Promise<SynthesisGate> {
  const { data, error } = await sb.rpc("can_synthesize_paper_pal", {
    p_paper_id: paperId,
  });
  if (error || !data) return { canSynthesize: false, reason: "none" };
  const row = data as { canSynthesize?: boolean; reason?: SynthesisGate["reason"] };
  return {
    canSynthesize: Boolean(row.canSynthesize),
    reason: (row.reason ?? "none") as SynthesisGate["reason"],
  };
}

export async function currentMemberId(sb: SupabaseClient): Promise<number | null> {
  const { data } = await sb.rpc("current_member_id");
  return (data as number | null) ?? null;
}

export async function getMemberRole(
  sb: SupabaseClient,
  memberId: number,
): Promise<string | null> {
  const { data } = await sb.from("members").select("role").eq("id", memberId).maybeSingle();
  return (data?.role as string | null) ?? null;
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
  const { data } = await sb
    .from("meeting_attendance")
    .select("meeting_id, meetings!inner(paper_id)")
    .eq("member_id", memberId)
    .eq("rsvp_status", "attending")
    .eq("meetings.paper_id", paperId)
    .limit(1);
  return (data?.length ?? 0) > 0;
}
