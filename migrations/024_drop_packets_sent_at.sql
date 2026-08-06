-- 024_drop_packets_sent_at.sql
--
-- Drops meetings.packets_sent_at. The PDF-packet flow it tracked
-- (/wids-send-packets, /wids-make-guide) is deprecated, superseded by Paper Pal.
--
-- Safe to drop: the column is NULL on every row in the table — it was never
-- written in production. Verify before applying:
--
--   SELECT count(*) AS nonnull FROM meetings WHERE packets_sent_at IS NOT NULL;
--   -- expected: 0
--
-- NOT adding meetings.paper_pal_generated_at. That timestamp already exists as
-- paper_companions.generated_at (NOT NULL, default now()), keyed by paper_id.
-- Duplicating it onto meetings would create two sources of truth that drift the
-- first time a companion is regenerated. Derive it instead:
--
--   SELECT m.id, m.scheduled_at, pc.generated_at AS paper_pal_generated_at
--   FROM meetings m
--   LEFT JOIN paper_companions pc ON pc.paper_id = m.paper_id
--   WHERE m.type = 'reading_group';
--
-- A meeting is "Paper Pal ready" when that join yields a non-NULL generated_at.

ALTER TABLE meetings DROP COLUMN IF EXISTS packets_sent_at;

-- After applying, regenerate the portal's generated types so
-- web/lib/database.types.ts stops declaring the dropped column:
--   npx supabase gen types typescript --project-id dmyulakudbdegwkqgelx > web/lib/database.types.ts
