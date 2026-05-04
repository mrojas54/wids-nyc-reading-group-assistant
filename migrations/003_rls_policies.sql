-- migrations/003_rls_policies.sql
-- Adds RLS policies for tables previously enabled via the dashboard.
-- command_log is intentionally left without a policy: it's an audit log
-- written only via the service-role client (web/lib/log.ts). Browser readers
-- are blocked by design; the corresponding INFO lint is accepted.
BEGIN;

-- 1. Re-declare RLS so migrations match dashboard state (idempotent).
ALTER TABLE topics             ENABLE ROW LEVEL SECURITY;
ALTER TABLE paper_topics       ENABLE ROW LEVEL SECURITY;
ALTER TABLE paper_suggestions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE volunteers         ENABLE ROW LEVEL SECURITY;
ALTER TABLE command_log        ENABLE ROW LEVEL SECURITY;

-- 2. topics — reference data, all members can read.
CREATE POLICY topics_select ON topics FOR SELECT TO authenticated
  USING (true);

-- 3. paper_topics — join table, all members can read.
CREATE POLICY paper_topics_select ON paper_topics FOR SELECT TO authenticated
  USING (true);

-- 4. paper_suggestions — all members read; insert only as self.
CREATE POLICY paper_suggestions_select ON paper_suggestions FOR SELECT TO authenticated
  USING (true);
CREATE POLICY paper_suggestions_insert_own ON paper_suggestions FOR INSERT TO authenticated
  WITH CHECK (suggested_by = current_member_id());

-- 5. volunteers — all members read; insert/delete own row only.
CREATE POLICY volunteers_select ON volunteers FOR SELECT TO authenticated
  USING (true);
CREATE POLICY volunteers_insert_own ON volunteers FOR INSERT TO authenticated
  WITH CHECK (member_id = current_member_id());
CREATE POLICY volunteers_delete_own ON volunteers FOR DELETE TO authenticated
  USING (member_id = current_member_id());

COMMIT;
