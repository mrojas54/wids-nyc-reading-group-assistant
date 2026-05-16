-- migrations/015_paper_companions_role_widening.sql
-- Widens paper_companions write policies to match the role widening in
-- migration 014 (member | operator | leader | admin). After this:
--   • operator (singleton) and admin (uncapped) can write any companion
--   • leader can write the companion for the paper they're assigned to
--     lead via meetings.leader_id
--   • member cannot write
-- Read policy from migration 013 stays as-is (any active member can read).
BEGIN;

DROP POLICY IF EXISTS paper_companions_insert ON paper_companions;
DROP POLICY IF EXISTS paper_companions_update ON paper_companions;
DROP POLICY IF EXISTS paper_companions_delete ON paper_companions;

CREATE POLICY paper_companions_insert ON paper_companions
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM members m
      WHERE m.id = current_member_id()
        AND (
          m.role IN ('operator', 'admin')
          OR EXISTS (
            SELECT 1 FROM meetings mt
            WHERE mt.paper_id = paper_companions.paper_id
              AND mt.leader_id = m.id
          )
        )
    )
  );

CREATE POLICY paper_companions_update ON paper_companions
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM members m
      WHERE m.id = current_member_id()
        AND (
          m.role IN ('operator', 'admin')
          OR EXISTS (
            SELECT 1 FROM meetings mt
            WHERE mt.paper_id = paper_companions.paper_id
              AND mt.leader_id = m.id
          )
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM members m
      WHERE m.id = current_member_id()
        AND (
          m.role IN ('operator', 'admin')
          OR EXISTS (
            SELECT 1 FROM meetings mt
            WHERE mt.paper_id = paper_companions.paper_id
              AND mt.leader_id = m.id
          )
        )
    )
  );

CREATE POLICY paper_companions_delete ON paper_companions
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM members m
      WHERE m.id = current_member_id()
        AND (
          m.role IN ('operator', 'admin')
          OR EXISTS (
            SELECT 1 FROM meetings mt
            WHERE mt.paper_id = paper_companions.paper_id
              AND mt.leader_id = m.id
          )
        )
    )
  );

COMMIT;
