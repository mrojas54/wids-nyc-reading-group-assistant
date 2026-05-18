-- 20260518040000_015_availability_created_at.sql
--
-- Add `availability.created_at` so we can answer operator questions like
-- "has anyone submitted today?" and "did anyone respond after the last
-- reminder went out?" Currently the table records only `range_start` /
-- `range_end` (the time window the member is available), with no record
-- of when the row itself was inserted — surfaced 2026-05-17 when the
-- operator asked exactly that question during the availability-chase
-- cycle for meeting #6 and the data simply wasn't there.
--
-- Backfill behavior: existing rows receive `now()` at migration time.
-- That's safe because the column is only used for forward-looking
-- queries ("submitted after last reminder", "submitted in the last
-- 24h"), not historical analysis where the real submission time would
-- matter. If anyone ever needs accurate historical submission times,
-- there's no way to reconstruct them — those events were never recorded.
--
-- The composite (meeting_id, created_at) index supports the chase
-- task's typical access pattern: "any rows submitted after a given
-- timestamp for a given meeting."

ALTER TABLE public.availability
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS availability_meeting_created_at_idx
  ON public.availability (meeting_id, created_at);

-- RLS note: the existing availability_* policies (availability_select_own,
-- availability_insert_own, availability_update_own, availability_delete_own)
-- gate on member_id = current_member_id() and do not reference any other
-- columns, so they apply unchanged to rows with the new created_at column.
-- No policy changes needed.
