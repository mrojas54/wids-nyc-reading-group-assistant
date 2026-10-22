-- Disposable full-replay regression: grants are checked separately from RLS.
\set ON_ERROR_STOP on
DO $$ BEGIN IF current_database() <> 'paperpal_retrieval_test' THEN
  RAISE EXCEPTION 'Requires disposable database'; END IF; END $$;
BEGIN;
DO $$
DECLARE t record; op text; allowed text[]; c text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public' LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid=format('public.%I',t.tablename)::regclass) THEN
      RAISE EXCEPTION 'RLS missing: %', t.tablename;
    END IF;
    allowed := CASE t.tablename
      WHEN 'members' THEN ARRAY[]::text[] -- column grants checked below
      WHEN 'availability' THEN ARRAY['SELECT','INSERT','UPDATE','DELETE']
      WHEN 'paper_companions' THEN ARRAY['SELECT','INSERT','UPDATE','DELETE']
      WHEN 'meeting_attendance' THEN ARRAY['SELECT','INSERT','UPDATE']
      WHEN 'paper_suggestions' THEN ARRAY['SELECT','INSERT']
      WHEN 'volunteers' THEN ARRAY['SELECT','INSERT','DELETE']
      WHEN 'command_log' THEN ARRAY[]::text[]
      WHEN 'blackout_periods' THEN ARRAY[]::text[]
      WHEN 'paper_embeddings' THEN ARRAY[]::text[]
      ELSE ARRAY['SELECT'] END;
    FOREACH op IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
      IF has_table_privilege('anon',format('public.%I',t.tablename),op) THEN
        RAISE EXCEPTION 'anon has % on %',op,t.tablename;
      END IF;
      IF has_table_privilege('authenticated',format('public.%I',t.tablename),op) <> (op=ANY(allowed)) THEN
        RAISE EXCEPTION 'authenticated grant mismatch: % %',t.tablename,op;
      END IF;
      IF op=ANY(ARRAY['SELECT','INSERT','UPDATE','DELETE']) AND
        NOT has_table_privilege('service_role',format('public.%I',t.tablename),op) THEN
        RAISE EXCEPTION 'service_role missing % on %',op,t.tablename;
      END IF;
    END LOOP;
  END LOOP;
  FOR c IN SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='members' LOOP
    IF has_column_privilege('authenticated','public.members',c,'SELECT') <>
      (c=ANY(ARRAY['id','name','role','auth_user_id'])) THEN
      RAISE EXCEPTION 'members column leak/missing grant: %',c;
    END IF;
  END LOOP;
  FOR t IN SELECT sequencename FROM pg_sequences WHERE schemaname='public' LOOP
    IF has_sequence_privilege('anon',format('public.%I',t.sequencename),'USAGE') OR
       NOT has_sequence_privilege('service_role',format('public.%I',t.sequencename),'USAGE') OR
       has_sequence_privilege('authenticated',format('public.%I',t.sequencename),'USAGE') <>
         (t.sequencename=ANY(ARRAY['availability_id_seq','meeting_attendance_id_seq','volunteers_id_seq','paper_suggestions_id_seq'])) THEN
      RAISE EXCEPTION 'sequence grant mismatch: %',t.sequencename;
    END IF;
  END LOOP;
  IF NOT has_function_privilege('service_role','public.upsert_paper_companion(int,jsonb,text,text,int)','EXECUTE') OR
     has_function_privilege('authenticated','public.upsert_paper_companion(int,jsonb,text,text,int)','EXECUTE') OR
     has_function_privilege('anon','public.upsert_paper_companion(int,jsonb,text,text,int)','EXECUTE') THEN
    RAISE EXCEPTION 'upsert RPC role boundary changed';
  END IF;
END $$;

-- Real role-switched operations: BYPASSRLS alone cannot satisfy these grants.
INSERT INTO auth.users(id) VALUES ('00000000-0000-0000-0000-000000000099');
SET LOCAL ROLE service_role;
INSERT INTO public.members(name,email,auth_user_id) VALUES
 ('Grant test','grants@example.invalid','00000000-0000-0000-0000-000000000099');
INSERT INTO public.papers(title) VALUES ('Grant test') RETURNING id AS paper_id \gset
INSERT INTO public.meetings(type,status,paper_id) VALUES ('reading_group','prep',:paper_id) RETURNING id AS meeting_id \gset
SELECT public.upsert_paper_companion(:paper_id,'{}','manual','test',NULL);
INSERT INTO public.command_log(source,name,status) VALUES ('server_action','grants','success');
INSERT INTO public.paper_socratic_turns(paper_id,member_id,prompt_id,turn_number,user_response,provider)
 SELECT :paper_id,id,'test',1,'test','gemini' FROM public.members WHERE email='grants@example.invalid';
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000099',true);
INSERT INTO public.volunteers(meeting_id,member_id) VALUES (:meeting_id,public.current_member_id());
INSERT INTO public.paper_suggestions(meeting_id,paper_id,suggested_by,source)
 VALUES (:meeting_id,:paper_id,public.current_member_id(),'member');
INSERT INTO public.meeting_attendance(meeting_id,member_id) VALUES (:meeting_id,public.current_member_id());
UPDATE public.meeting_attendance SET rsvp_status='attending' WHERE meeting_id=:meeting_id;
SELECT public.replace_my_availability(:meeting_id,ARRAY[now()],ARRAY[now()+interval '1 hour']);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.availability WHERE member_id=public.current_member_id()) <> 1 OR
     (SELECT count(*) FROM public.paper_socratic_turns) <> 1 THEN
    RAISE EXCEPTION 'own-row reads/RPC failed';
  END IF;
  PERFORM title FROM public.papers;
  PERFORM name FROM public.topics;
  PERFORM paper_id FROM public.paper_topics;
  PERFORM payload FROM public.paper_companions;
  BEGIN
    INSERT INTO public.volunteers(meeting_id,member_id)
      SELECT meeting_id,member_id+100000 FROM public.volunteers LIMIT 1;
    RAISE EXCEPTION 'cross-member write accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE public.paper_companions SET payload='{"bad":true}';
    IF FOUND THEN RAISE EXCEPTION 'non-operator companion write accepted'; END IF;
  END;
END $$;
DELETE FROM public.volunteers WHERE meeting_id=:meeting_id;
RESET ROLE;
ROLLBACK;
\echo 'PASS: explicit Data API grants and role boundaries'
