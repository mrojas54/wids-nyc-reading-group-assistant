-- migrations/034_meetings_vibe_session_type.sql
-- Adds 'vibe_session' as a third meetings.type: a purely social meeting with
-- no paper and no discussion leader, distinct from 'admin' planning meetings
-- and 'reading_group' paper discussions.
--
-- Also replaces the lexicographic ORDER BY type DESC trick that
-- orderNewestPrep() (web/lib/queries.ts) uses to break same-created_at
-- prep-meeting ties. That trick depended on there being exactly two type
-- values, where 'reading_group' happens to sort after 'admin'. Adding
-- 'vibe_session' — which sorts after 'reading_group' — would silently flip
-- the tiebreak to prefer vibe_session over reading_group. A generated
-- `type_priority` column makes the precedence explicit (reading_group >
-- vibe_session > admin) instead of leaving it to the spelling of the type
-- values.
--
-- Additive: widens a CHECK, adds one generated column. No row rewrite for
-- existing rows — type_priority is computed from `type`, not backfilled.
--
-- Verify after applying:
--
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conrelid = 'meetings'::regclass AND conname = 'meetings_type_check';
--   -- expected: CHECK ((type = ANY (ARRAY['admin', 'reading_group', 'vibe_session'])))
--
--   SELECT type, type_priority FROM meetings ORDER BY type;
--   -- expected: admin=0, reading_group=2, vibe_session=1
--
-- Regenerate web/lib/database.types.ts after applying.

BEGIN;

ALTER TABLE meetings DROP CONSTRAINT meetings_type_check;
ALTER TABLE meetings ADD CONSTRAINT meetings_type_check
  CHECK (type IN ('admin', 'reading_group', 'vibe_session'));

ALTER TABLE meetings ADD COLUMN type_priority SMALLINT GENERATED ALWAYS AS (
  CASE type
    WHEN 'reading_group' THEN 2
    WHEN 'vibe_session' THEN 1
    ELSE 0
  END
) STORED;

COMMENT ON COLUMN meetings.type_priority IS
  'Explicit precedence for orderNewestPrep''s same-created_at tiebreak '
  '(web/lib/queries.ts): reading_group > vibe_session > admin. Order by '
  'this column, not by type text — see migration 034''s header for why.';

COMMIT;
