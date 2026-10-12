-- Run only against a disposable database seeded with the local fixture below.
-- The name guard prevents accidental execution against a live Supabase project.
\set ON_ERROR_STOP on
DO $$ BEGIN IF current_database() <> 'paperpal_retrieval_test' THEN
  RAISE EXCEPTION 'This test requires the disposable paperpal_retrieval_test database'; END IF; END $$;
BEGIN;
INSERT INTO auth.users(id) SELECT ('00000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid FROM generate_series(1,5) i;
INSERT INTO public.members(id,name,email,role,auth_user_id) VALUES
  (1,'Admin','admin@example.invalid','admin','00000000-0000-0000-0000-000000000001'),
  (2,'Attendee','attendee@example.invalid','member','00000000-0000-0000-0000-000000000002'),
  (3,'Declined','declined@example.invalid','member','00000000-0000-0000-0000-000000000003'),
  (4,'Leader','leader@example.invalid','member','00000000-0000-0000-0000-000000000004'),
  (5,'Other','other@example.invalid','member','00000000-0000-0000-0000-000000000005');
INSERT INTO public.papers(id,title) VALUES (41,'Synthetic paper'),(42,'Other paper');
-- 42 is upcoming. 43 was cancelled and 44 already happened; neither grants access.
INSERT INTO public.meetings(id,type,status,paper_id,leader_id,scheduled_at) VALUES
  (42,'reading_group','scheduled',41,4,now() + interval '7 days'),
  (43,'reading_group','cancelled',41,4,now() + interval '14 days'),
  (44,'reading_group','scheduled',41,4,now() - interval '30 days');
INSERT INTO public.meeting_attendance(meeting_id,member_id,rsvp_status) VALUES (42,2,'attending'),(42,3,'declined');

CREATE FUNCTION pg_temp.unit_vector(n int) RETURNS vector LANGUAGE sql AS $$
  SELECT array_agg(CASE WHEN i=n THEN 1::real ELSE 0::real END ORDER BY i)::vector FROM generate_series(1,384) i
$$;
CREATE FUNCTION pg_temp.payload() RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_array(
    jsonb_build_object('id','formal','page',1,'text','Formal verification checks mathematical specifications.','start',0,'end',55,'embedding',pg_temp.unit_vector(1)::text::jsonb),
    jsonb_build_object('id','fruit','page',2,'text','Apples grow on trees.','start',0,'end',20,'embedding',pg_temp.unit_vector(2)::text::jsonb))
$$;

SET LOCAL ROLE service_role;
SELECT public.index_paper_passages(41,repeat('a',64),'gte-small-93b36ff-mean-normalized-v1',pg_temp.payload());
SELECT public.index_paper_passages(41,repeat('a',64),'gte-small-93b36ff-mean-normalized-v1',pg_temp.payload());
SELECT public.index_paper_passages(41,repeat('b',64),'gte-small-93b36ff-mean-normalized-v1',pg_temp.payload());
SELECT public.index_paper_passages(42,repeat('a',64),'gte-small-93b36ff-mean-normalized-v1',pg_temp.payload());
-- Ten passages share the phrase; only the last one is about it.
SELECT public.index_paper_passages(41,repeat('f',64),'gte-small-93b36ff-mean-normalized-v1',(
  SELECT jsonb_agg(jsonb_build_object('id','k'||i,'page',i,'text',t,'start',0,'end',length(t),'embedding',pg_temp.unit_vector(i)::text::jsonb) ORDER BY i)
  FROM generate_series(1,10) i,
    LATERAL (SELECT CASE WHEN i = 10
      THEN 'The faithfulness gap is the faithfulness gap between the explanation and the model; the faithfulness gap shrinks.'
      ELSE 'Background on training data, with one aside on the faithfulness gap and many other unrelated details about setup ' || i || '.' END AS t) x));
DO $$ BEGIN
  IF (SELECT count(*) FROM public.paper_passages) <> 16 THEN RAISE EXCEPTION 'Retry duplicated rows'; END IF;
  BEGIN
    PERFORM public.index_paper_passages(41,repeat('a',64),'gte-small-93b36ff-mean-normalized-v1',
      jsonb_set(pg_temp.payload(),'{0,text}','"Mutated citation"'));
    RAISE EXCEPTION 'Expected immutable-source rejection';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Source version is immutable' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.index_paper_passages(41,repeat('c',64),'gte-small-93b36ff-mean-normalized-v1',
      jsonb_set(pg_temp.payload(),'{1,page}','0'));
    RAISE EXCEPTION 'Expected invalid page rejection';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF EXISTS (SELECT 1 FROM public.paper_passage_sources WHERE source_version=repeat('c',64)) THEN
    RAISE EXCEPTION 'Failed import published a partial source'; END IF;
END $$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
DO $$ DECLARE hit record; BEGIN
  IF (SELECT count(*) FROM public.paper_passages) <> 14 THEN RAISE EXCEPTION 'Attendee RLS failed'; END IF;
  SELECT * INTO hit FROM public.match_paper_passages(41,repeat('a',64),'formal verification',pg_temp.unit_vector(1),1);
  IF hit.id IS DISTINCT FROM 'formal' OR hit.source_version <> repeat('a',64) THEN RAISE EXCEPTION 'Ranking/scope failure'; END IF;
  IF EXISTS (SELECT 1 FROM public.match_paper_passages(42,repeat('a',64),'formal',pg_temp.unit_vector(1),8)) THEN
    RAISE EXCEPTION 'Other paper leaked'; END IF;
  IF EXISTS (SELECT 1 FROM public.match_paper_passages(41,repeat('d',64),'formal',pg_temp.unit_vector(1),8)) THEN
    RAISE EXCEPTION 'Other version leaked'; END IF;
  IF (SELECT id FROM public.match_paper_passage_keywords(41,repeat('f',64),'"faithfulness gap"',3) LIMIT 1) IS DISTINCT FROM 'k10' THEN
    RAISE EXCEPTION 'Keyword candidates are not ranked by relevance'; END IF;
  IF (SELECT count(*) FROM public.match_paper_passage_keywords(41,repeat('f',64),'"faithfulness gap"',8)) <> 8 THEN
    RAISE EXCEPTION 'Keyword limit ignored'; END IF;
  IF EXISTS (SELECT 1 FROM public.match_paper_passage_keywords(42,repeat('a',64),'formal',8)) THEN
    RAISE EXCEPTION 'Other paper leaked through keywords'; END IF;
  BEGIN
    PERFORM public.index_paper_passages(41,repeat('e',64),'gte-small-93b36ff-mean-normalized-v1',pg_temp.payload());
    RAISE EXCEPTION 'Member can ingest';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE public.paper_passages SET text='Tampered citation';
    RAISE EXCEPTION 'Member can update';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',true);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.paper_passages) THEN RAISE EXCEPTION 'Declined member leaked'; END IF;
  IF EXISTS (SELECT 1 FROM public.match_paper_passage_keywords(41,repeat('f',64),'"faithfulness gap"',8)) THEN
    RAISE EXCEPTION 'Declined member leaked through keywords'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',true);
DO $$ BEGIN IF (SELECT count(*) FROM public.paper_passages) <> 14 THEN RAISE EXCEPTION 'Leader without RSVP blocked'; END IF; END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000005',true);
DO $$ BEGIN IF EXISTS (SELECT 1 FROM public.paper_passages) THEN RAISE EXCEPTION 'Non-attendee leaked'; END IF; END $$;
-- Members write their own RSVPs, so a self-RSVP to a cancelled or past meeting
-- must not unlock the paper.
INSERT INTO public.meeting_attendance(meeting_id,member_id,rsvp_status) VALUES (43,5,'attending'),(44,5,'attending');
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.paper_passages) THEN RAISE EXCEPTION 'Self-RSVP to a cancelled or past meeting leaked'; END IF;
  IF EXISTS (SELECT 1 FROM public.match_paper_passages(41,repeat('a',64),'formal',pg_temp.unit_vector(1),8)) THEN
    RAISE EXCEPTION 'Self-RSVP to a cancelled or past meeting leaked through search'; END IF;
END $$;
-- Every active member is invited to an upcoming meeting, so RSVPing to one is
-- the intended way in.
INSERT INTO public.meeting_attendance(meeting_id,member_id,rsvp_status) VALUES (42,5,'attending');
DO $$ BEGIN IF (SELECT count(*) FROM public.paper_passages) <> 14 THEN RAISE EXCEPTION 'Upcoming attendee blocked'; END IF; END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
DO $$ BEGIN IF (SELECT count(*) FROM public.paper_passages) <> 16 THEN RAISE EXCEPTION 'Admin blocked'; END IF; END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-999999999999',true);
DO $$ BEGIN IF EXISTS (SELECT 1 FROM public.paper_passages) THEN RAISE EXCEPTION 'Unlinked user leaked'; END IF; END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM * FROM public.paper_passages; RAISE EXCEPTION 'Anon table access';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.match_paper_passages(41,repeat('a',64),'formal',pg_temp.unit_vector(1),8); RAISE EXCEPTION 'Anon RPC access';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.match_paper_passage_keywords(41,repeat('a',64),'formal',8); RAISE EXCEPTION 'Anon keyword RPC access';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;
\echo 'PASS: atomic ingestion, immutable retry, hybrid and keyword search, RLS and grants'
