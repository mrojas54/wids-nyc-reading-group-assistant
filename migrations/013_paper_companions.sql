-- migrations/013_paper_companions.sql
-- Paper Pal companion payload table. Stores the structured
-- ResearchPaperAnalysis JSON returned by the AI generator, keyed by paper.
-- Replaces the static HTML/JSON companion artifacts produced by the now-
-- deprecated /wids-make-companion + /wids-make-guide flows.
BEGIN;

CREATE TABLE paper_companions (
  paper_id      INT PRIMARY KEY REFERENCES papers(id) ON DELETE CASCADE,
  payload       JSONB NOT NULL,
  generated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  generated_by  INT REFERENCES members(id) ON DELETE SET NULL,
  model         TEXT NOT NULL
);

-- ensure_rls event trigger will turn RLS on automatically; policies must
-- exist before the browser can read anything.

-- Read: any active member with an auth session
CREATE POLICY paper_companions_select ON paper_companions
  FOR SELECT TO authenticated
  USING (current_member_id() IS NOT NULL);

-- Write: operators only (members.role = 'operator')
CREATE POLICY paper_companions_insert ON paper_companions
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM members
      WHERE members.id = current_member_id()
        AND members.role = 'operator'
    )
  );

CREATE POLICY paper_companions_update ON paper_companions
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM members
      WHERE members.id = current_member_id()
        AND members.role = 'operator'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM members
      WHERE members.id = current_member_id()
        AND members.role = 'operator'
    )
  );

CREATE POLICY paper_companions_delete ON paper_companions
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM members
      WHERE members.id = current_member_id()
        AND members.role = 'operator'
    )
  );

COMMIT;
