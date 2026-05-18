-- migrations/017_synthesis_gate_rpc.sql
-- (Originally numbered 016; renumbered to 017 alongside the 015→016 bump.)
--
-- can_synthesize_paper_pal: single source of truth for the Paper Pal
-- synthesis gate, callable from both Node (web/lib/queries.ts) and Deno
-- (supabase/functions/analyze-paper). Replaces the two-query implementation
-- in canSynthesizePaperPal() with one RPC round-trip.
--
-- Spec: docs/superpowers/specs/2026-05-17-paper-pal-edge-functions.md §7
--
-- Semantics: returns { canSynthesize, reason } as JSONB.
--   - reason='owner'  → caller is operator or admin
--   - reason='leader' → caller leads a meeting that uses this paper
--   - reason='none'   → unauthenticated, or no eligible role/leadership
--
-- Schema note: papers.id is INT (migration 001). Spec writes bigint;
-- we use int to match the actual column type. Implicit casts on the
-- JS side still work because Supabase serializes int as JS number.
BEGIN;

CREATE OR REPLACE FUNCTION can_synthesize_paper_pal(p_paper_id int)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_member_id int;
  v_role text;
  v_is_leader boolean;
BEGIN
  v_member_id := current_member_id();
  IF v_member_id IS NULL THEN
    RETURN jsonb_build_object('canSynthesize', false, 'reason', 'none');
  END IF;

  SELECT role INTO v_role FROM members WHERE id = v_member_id;
  IF v_role IN ('operator', 'admin') THEN
    RETURN jsonb_build_object('canSynthesize', true, 'reason', 'owner');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM meetings
    WHERE paper_id = p_paper_id AND leader_id = v_member_id
  ) INTO v_is_leader;
  IF v_is_leader THEN
    RETURN jsonb_build_object('canSynthesize', true, 'reason', 'leader');
  END IF;

  RETURN jsonb_build_object('canSynthesize', false, 'reason', 'none');
END;
$$;

-- Restrict to authenticated callers only — unauthenticated roles can't
-- learn whether a member can synthesize a paper. Service-role bypasses
-- this grant entirely.
REVOKE EXECUTE ON FUNCTION public.can_synthesize_paper_pal(int) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.can_synthesize_paper_pal(int) TO authenticated;

-- ---------------------------------------------------------------------------
-- current_member_role: returns the caller's role string, or NULL if
-- unauthenticated / no member row. SECURITY DEFINER so callers don't
-- depend on whatever RLS the `members` table happens to have at the
-- moment — a tightened SELECT policy on `members.role` would otherwise
-- silently break the admin-override path in analyze-paper.
CREATE OR REPLACE FUNCTION current_member_role()
RETURNS text
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = 'public' AS $$
  SELECT role FROM members WHERE id = current_member_id();
$$;

REVOKE EXECUTE ON FUNCTION public.current_member_role() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.current_member_role() TO authenticated;

COMMIT;
