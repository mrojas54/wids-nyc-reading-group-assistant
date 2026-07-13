-- migrations/021_blackout_periods.sql
-- Operator-defined blackout windows: date ranges in which no meeting may be
-- scheduled and no member may submit availability. Half-open [range_start,
-- range_end) in America/New_York.
--
-- RLS note: the out-of-band `ensure_rls` event trigger auto-enables RLS on
-- this table. We intentionally add NO policies — every reader is server-side
-- (the scheduler via the Supabase service role, and the availability portal
-- via createSupabaseServiceClient()). This mirrors the command_log exception:
-- service-role-only, never read by the browser.

BEGIN;

CREATE TABLE blackout_periods (
  id          SERIAL PRIMARY KEY,
  range_start TIMESTAMPTZ NOT NULL,
  range_end   TIMESTAMPTZ NOT NULL,   -- half-open: [range_start, range_end)
  reason      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (range_end > range_start)
);

INSERT INTO blackout_periods (range_start, range_end, reason) VALUES
  ('2026-07-12 00:00 America/New_York',
   '2026-08-01 00:00 America/New_York',   -- exclusive → Jul 31 last blocked, Aug 1 bookable
   'Summer break part 1 (Jul 12 – Jul 31, 2026)'),
  ('2026-08-21 00:00 America/New_York',
   '2026-09-08 00:00 America/New_York',   -- exclusive → Sep 7 last blocked, Sep 8 bookable
   'Summer break part 2 (Aug 21 – Sep 7, 2026)');

COMMIT;
