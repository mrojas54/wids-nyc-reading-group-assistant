-- Follow-up to 035, which is already applied in production; 035 stays as is.
--
-- 1. Passage access. Members write their own meeting_attendance rows
--    (002 attendance_insert_own / attendance_update_own), so under 035 a member
--    could RSVP 'attending' to any meeting for a paper, including a cancelled or
--    past one, and read every passage. An attending RSVP now counts only for a
--    meeting that is still 'scheduled' and started no more than 24 hours ago.
--    Every active member is invited to a scheduled meeting (scheduleMeeting
--    opens a no_response row for each), so this keeps real attendees in.
--    Operators, admins, and the paper's meeting leader are unchanged.
--
-- 2. Keyword candidates. The Node adapter read keyword matches through REST
--    ordered by page, so a phrase with more than eight matches only ever
--    surfaced the earliest pages. match_paper_passage_keywords ranks matches by
--    ts_rank_cd, keeping page order only as the tie-break.
BEGIN;
SET LOCAL search_path = public, extensions;

CREATE OR REPLACE FUNCTION public.can_read_paper_passages(p_paper_id int)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, extensions AS $$
  SELECT public.current_member_id() IS NOT NULL AND (
    public.current_member_role() IN ('operator', 'admin')
    OR EXISTS (SELECT 1 FROM public.meetings m
      WHERE m.paper_id = p_paper_id AND m.leader_id = public.current_member_id())
    OR EXISTS (SELECT 1 FROM public.meeting_attendance a JOIN public.meetings m ON m.id = a.meeting_id
      WHERE m.paper_id = p_paper_id AND a.member_id = public.current_member_id() AND a.rsvp_status = 'attending'
        AND m.status = 'scheduled' AND m.scheduled_at > now() - interval '24 hours')
  );
$$;
REVOKE ALL ON FUNCTION public.can_read_paper_passages(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_paper_passages(int) TO authenticated, service_role;

-- p_query is websearch syntax, matching the adapter's former wfts(english) filter.
-- Caller RLS applies, as in match_paper_passages.
CREATE FUNCTION public.match_paper_passage_keywords(p_paper_id int, p_source_version text,
  p_query text, p_limit int DEFAULT 8)
RETURNS TABLE(id text, paper_id int, source_version text, page int, text text,
  start_offset int, end_offset int, score double precision)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, extensions AS $$
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR p_query IS NULL
    OR length(btrim(p_query)) = 0 OR length(p_query) > 4000 THEN RAISE EXCEPTION 'Invalid passage query'; END IF;
  RETURN QUERY
  SELECT p.id, p.paper_id, p.source_version, p.page, p.text, p.start_offset, p.end_offset,
    ts_rank_cd(p.fts, q.query)::double precision AS score
  FROM public.paper_passages p, websearch_to_tsquery('english', p_query) AS q(query)
  WHERE p.paper_id = p_paper_id AND p.source_version = p_source_version AND p.fts @@ q.query
  ORDER BY score DESC, p.page, p.start_offset, p.id
  LIMIT p_limit;
END;
$$;
REVOKE ALL ON FUNCTION public.match_paper_passage_keywords(int, text, text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_paper_passage_keywords(int, text, text, int) TO authenticated, service_role;
COMMIT;
