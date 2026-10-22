-- Supabase passage search. Separate from the whole-paper SPECTER2 cache.
-- Generated with `supabase migration new`, moved to the repository's numeric
-- root migrations convention. Not applied to production by this change.
BEGIN;
SET LOCAL search_path = public, extensions;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

CREATE FUNCTION public.can_read_paper_passages(p_paper_id int)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, extensions AS $$
  SELECT public.current_member_id() IS NOT NULL AND (
    public.current_member_role() IN ('operator', 'admin')
    OR EXISTS (SELECT 1 FROM public.meetings m
      WHERE m.paper_id = p_paper_id AND m.leader_id = public.current_member_id())
    OR EXISTS (SELECT 1 FROM public.meeting_attendance a JOIN public.meetings m ON m.id = a.meeting_id
      WHERE m.paper_id = p_paper_id AND a.member_id = public.current_member_id() AND a.rsvp_status = 'attending')
  );
$$;
REVOKE ALL ON FUNCTION public.can_read_paper_passages(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_paper_passages(int) TO authenticated, service_role;

CREATE TABLE public.paper_passage_sources (
  paper_id int NOT NULL REFERENCES public.papers(id) ON DELETE CASCADE,
  source_version text NOT NULL CHECK (source_version ~ '^[a-f0-9]{64}$'),
  embedding_model text NOT NULL CHECK (embedding_model = 'gte-small-93b36ff-mean-normalized-v1'),
  passage_count int NOT NULL CHECK (passage_count BETWEEN 1 AND 2000),
  indexed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (paper_id, source_version)
);
CREATE TABLE public.paper_passages (
  paper_id int NOT NULL,
  source_version text NOT NULL,
  id text NOT NULL CHECK (id ~ '^[a-zA-Z0-9_-]{1,64}$'),
  page int NOT NULL CHECK (page > 0),
  text text NOT NULL CHECK (length(btrim(text)) > 0 AND length(text) <= 8000),
  start_offset int NOT NULL CHECK (start_offset >= 0),
  end_offset int NOT NULL CHECK (end_offset > start_offset),
  embedding vector(384) NOT NULL CHECK (vector_norm(embedding) > 0),
  fts tsvector GENERATED ALWAYS AS (to_tsvector('english', text)) STORED,
  PRIMARY KEY (paper_id, source_version, id),
  FOREIGN KEY (paper_id, source_version) REFERENCES public.paper_passage_sources ON DELETE CASCADE
);
CREATE INDEX paper_passages_fts ON public.paper_passages USING gin(fts);
ALTER TABLE public.paper_passage_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paper_passages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.paper_passage_sources, public.paper_passages FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.paper_passage_sources, public.paper_passages TO authenticated;
GRANT ALL ON public.paper_passage_sources, public.paper_passages TO service_role;
CREATE POLICY paper_passage_sources_read ON public.paper_passage_sources FOR SELECT TO authenticated
  USING (public.can_read_paper_passages(paper_id));
CREATE POLICY paper_passages_read ON public.paper_passages FOR SELECT TO authenticated
  USING (public.can_read_paper_passages(paper_id));

-- Service-role ingestion only; inserts the source and every passage atomically.
-- Existing versions are immutable. Identical retries return without rewriting.
CREATE FUNCTION public.index_paper_passages(p_paper_id int, p_source_version text, p_model text, p_passages jsonb)
RETURNS int LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, extensions AS $$
DECLARE n int; existing_count int;
BEGIN
  IF p_paper_id IS NULL OR p_paper_id <= 0 OR p_source_version IS NULL
    OR p_source_version !~ '^[a-f0-9]{64}$'
    OR p_model IS DISTINCT FROM 'gte-small-93b36ff-mean-normalized-v1' THEN
    RAISE EXCEPTION 'Invalid passage source or model';
  END IF;
  IF jsonb_typeof(p_passages) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Expected passage array'; END IF;
  n := jsonb_array_length(p_passages);
  IF n < 1 OR n > 2000 THEN RAISE EXCEPTION 'Invalid passage count'; END IF;
  -- Serializes concurrent retries even before the parent row exists.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_paper_id::text || ':' || p_source_version, 0));
  SELECT passage_count INTO existing_count FROM public.paper_passage_sources
    WHERE paper_id = p_paper_id AND source_version = p_source_version;
  IF FOUND THEN
    IF existing_count <> n OR EXISTS (
      SELECT 1 FROM public.paper_passage_sources WHERE paper_id = p_paper_id AND source_version = p_source_version AND embedding_model <> p_model
    ) OR EXISTS (
      SELECT 1 FROM jsonb_to_recordset(p_passages) AS x(id text, page int, text text, start int, "end" int)
      LEFT JOIN public.paper_passages p ON p.paper_id = p_paper_id AND p.source_version = p_source_version AND p.id = x.id
      WHERE p.id IS NULL OR p.page IS DISTINCT FROM x.page OR p.text IS DISTINCT FROM x.text
        OR p.start_offset IS DISTINCT FROM x.start OR p.end_offset IS DISTINCT FROM x."end"
    ) OR (SELECT count(DISTINCT x->>'id') FROM jsonb_array_elements(p_passages) x) <> n THEN
      RAISE EXCEPTION 'Source version is immutable';
    END IF;
    RETURN n;
  END IF;
  INSERT INTO public.paper_passage_sources VALUES (p_paper_id, p_source_version, p_model, n, now());
  INSERT INTO public.paper_passages(paper_id, source_version, id, page, text, start_offset, end_offset, embedding)
  SELECT p_paper_id, p_source_version, x.id, x.page, x.text, x.start, x."end", x.embedding::text::vector
  FROM jsonb_to_recordset(p_passages) AS x(id text, page int, text text, start int, "end" int, embedding jsonb);
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.index_paper_passages(int, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.index_paper_passages(int, text, text, jsonb) TO service_role;

-- Exact vector search is adequate for one paper's passages and avoids ANN
-- post-filter recall loss. Both ranked sets inherit caller RLS.
CREATE FUNCTION public.match_paper_passages(p_paper_id int, p_source_version text,
  p_question text, p_query_embedding vector(384), p_limit int DEFAULT 8)
RETURNS TABLE(id text, paper_id int, source_version text, page int, text text,
  start_offset int, end_offset int, score double precision)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, extensions AS $$
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR p_question IS NULL
    OR length(btrim(p_question)) = 0 OR length(p_question) > 4000
    OR p_query_embedding IS NULL OR vector_dims(p_query_embedding) <> 384
    OR vector_norm(p_query_embedding) = 0 THEN RAISE EXCEPTION 'Invalid passage query'; END IF;
  RETURN QUERY
  WITH candidates AS MATERIALIZED (
    SELECT p.* FROM public.paper_passages p WHERE p.paper_id = p_paper_id AND p.source_version = p_source_version
  ), semantic AS (
    SELECT p.id, row_number() OVER (ORDER BY p.embedding <=> p_query_embedding, p.id) AS rank
    FROM candidates p ORDER BY p.embedding <=> p_query_embedding, p.id LIMIT p_limit * 3
  ), lexical AS (
    SELECT p.id, row_number() OVER (ORDER BY ts_rank_cd(p.fts, websearch_to_tsquery('english', p_question)) DESC, p.id) AS rank
    FROM candidates p WHERE p.fts @@ websearch_to_tsquery('english', p_question)
    ORDER BY ts_rank_cd(p.fts, websearch_to_tsquery('english', p_question)) DESC, p.id LIMIT p_limit * 3
  ), fused AS (
    SELECT coalesce(s.id, l.id) AS id, (coalesce(1.0 / (60 + s.rank), 0) + coalesce(1.0 / (60 + l.rank), 0))::double precision AS score
    FROM semantic s FULL OUTER JOIN lexical l ON l.id = s.id
  )
  SELECT p.id, p.paper_id, p.source_version, p.page, p.text, p.start_offset, p.end_offset, f.score
  FROM fused f JOIN candidates p ON p.id = f.id ORDER BY f.score DESC, p.id LIMIT p_limit;
END;
$$;
REVOKE ALL ON FUNCTION public.match_paper_passages(int, text, text, vector, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_paper_passages(int, text, text, vector, int) TO authenticated, service_role;
COMMIT;
