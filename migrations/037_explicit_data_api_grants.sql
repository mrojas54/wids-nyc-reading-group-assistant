-- Explicit API access after Supabase removes automatic public-table grants.
-- Forward-only: do not change 001–036 or restore broad default privileges.
-- BYPASSRLS does not bypass SQL grants (including for service_role).
BEGIN;

-- Recreated public schemas also need explicit schema lookup permission.
GRANT USAGE ON SCHEMA public TO authenticated, service_role;

-- These tables previously depended on the out-of-band ensure_rls trigger.
ALTER TABLE public.paper_companions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blackout_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paper_embeddings ENABLE ROW LEVEL SECURITY;

-- Pin the previously implicit browser ceilings to existing RLS operations.
REVOKE ALL ON public.topics, public.papers, public.paper_topics,
  public.volunteers, public.availability, public.paper_suggestions,
  public.paper_companions, public.paper_socratic_turns, public.blackout_periods,
  public.command_log, public.meeting_attendance FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.topics, public.papers, public.paper_topics,
  public.paper_socratic_turns TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.meeting_attendance TO authenticated;
GRANT SELECT, INSERT ON public.paper_suggestions TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.volunteers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.availability,
  public.paper_companions TO authenticated;
-- 008 granted attendance operations but did not revoke historical defaults.
-- 030, 031, 033 and 035 already pin the other browser table grants.

REVOKE ALL ON SEQUENCE public.members_id_seq,
  public.topics_id_seq,
  public.papers_id_seq,
  public.meetings_id_seq,
  public.volunteers_id_seq,
  public.availability_id_seq,
  public.paper_suggestions_id_seq,
  public.command_log_id_seq,
  public.paper_socratic_turns_id_seq,
  public.blackout_periods_id_seq, public.meeting_attendance_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SEQUENCE public.volunteers_id_seq,
  public.availability_id_seq, public.paper_suggestions_id_seq,
  public.meeting_attendance_id_seq TO authenticated;

-- Explicit DML on named application tables only; no TRUNCATE/DDL/default grants.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.members,
  public.topics,
  public.papers,
  public.paper_topics,
  public.meetings,
  public.volunteers,
  public.availability,
  public.meeting_attendance,
  public.paper_suggestions,
  public.command_log,
  public.paper_embeddings,
  public.paper_companions,
  public.paper_socratic_turns,
  public.blackout_periods
TO service_role;
GRANT USAGE ON SEQUENCE
  public.members_id_seq,
  public.topics_id_seq,
  public.papers_id_seq,
  public.meetings_id_seq,
  public.volunteers_id_seq,
  public.availability_id_seq,
  public.meeting_attendance_id_seq,
  public.paper_suggestions_id_seq,
  public.command_log_id_seq,
  public.paper_socratic_turns_id_seq,
  public.blackout_periods_id_seq
TO service_role;
GRANT EXECUTE ON FUNCTION public.upsert_paper_companion(int, jsonb, text, text, int)
  TO service_role;

COMMIT;
