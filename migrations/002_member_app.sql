-- migrations/002_member_app.sql
-- Adds member-facing app schema: auth linkage, companion url, RLS, helpers.
BEGIN;

-- 1. Link members to Supabase Auth users
ALTER TABLE members ADD COLUMN auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX members_auth_user_id_idx ON members(auth_user_id) WHERE auth_user_id IS NOT NULL;

-- 2. Companion URL on papers
ALTER TABLE papers ADD COLUMN companion_url TEXT;

-- 3. Helper: resolve current member id from auth.uid()
CREATE FUNCTION current_member_id() RETURNS INT
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = 'public' AS $$
  SELECT id FROM members WHERE auth_user_id = auth.uid()
$$;

-- 4. Extend command_log.source to allow server actions
ALTER TABLE command_log DROP CONSTRAINT command_log_source_check;
ALTER TABLE command_log ADD CONSTRAINT command_log_source_check
  CHECK (source IN ('slash_command', 'scheduled_task', 'server_action'));

-- 5. Enable RLS on portal-touched tables
ALTER TABLE members             ENABLE ROW LEVEL SECURITY;
ALTER TABLE meetings            ENABLE ROW LEVEL SECURITY;
ALTER TABLE papers              ENABLE ROW LEVEL SECURITY;
ALTER TABLE availability        ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_attendance  ENABLE ROW LEVEL SECURITY;

-- 6. Read policies (authenticated members can read these tables)
CREATE POLICY members_select ON members FOR SELECT TO authenticated
  USING (true);
CREATE POLICY meetings_select ON meetings FOR SELECT TO authenticated
  USING (true);
CREATE POLICY papers_select ON papers FOR SELECT TO authenticated
  USING (true);

-- 7. Availability — own rows only
CREATE POLICY availability_select_own ON availability FOR SELECT TO authenticated
  USING (member_id = current_member_id());
CREATE POLICY availability_insert_own ON availability FOR INSERT TO authenticated
  WITH CHECK (member_id = current_member_id());
CREATE POLICY availability_update_own ON availability FOR UPDATE TO authenticated
  USING (member_id = current_member_id())
  WITH CHECK (member_id = current_member_id());
CREATE POLICY availability_delete_own ON availability FOR DELETE TO authenticated
  USING (member_id = current_member_id());

-- 8. Meeting attendance — own rows, no delete
CREATE POLICY attendance_select_own ON meeting_attendance FOR SELECT TO authenticated
  USING (member_id = current_member_id());
CREATE POLICY attendance_insert_own ON meeting_attendance FOR INSERT TO authenticated
  WITH CHECK (member_id = current_member_id());
CREATE POLICY attendance_update_own ON meeting_attendance FOR UPDATE TO authenticated
  USING (member_id = current_member_id())
  WITH CHECK (member_id = current_member_id());

-- 9. Column-level access on members: restrict authenticated reads to safe columns.
-- Service-role queries (slash commands, server actions using service key) bypass GRANTs.
REVOKE SELECT ON members FROM authenticated;
GRANT SELECT (id, name, role) ON members TO authenticated;

COMMIT;
