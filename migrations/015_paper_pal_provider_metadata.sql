-- migrations/015_paper_pal_provider_metadata.sql
-- Adds provider/rate-limit/telemetry columns to paper_companions, and
-- creates paper_socratic_turns for analyze-socratic transcript history.
--
-- Spec: docs/superpowers/specs/2026-05-17-paper-pal-edge-functions.md §6
--
-- Schema notes vs. spec §6:
--   - generated_at, model, generated_by already exist on paper_companions
--     (migration 013). They are NOT re-added here.
--   - The spec writes generated_by_member_id; we reuse the existing
--     `generated_by` column (also bigint REFERENCES members) for the same
--     intent. Edge Function SQL in §13.6 reads from `generated_by`.
BEGIN;

-- Step 1: add `provider` with 'manual' as the historical-truth default.
-- Pre-migration paper_companions rows were written by /wids-make-companion
-- (operator session). Defaulting to 'gemini' here would silently
-- misattribute every backfilled row. After the ALTER, every existing row
-- has provider='manual'; future inserts then get DEFAULT 'gemini'.
ALTER TABLE paper_companions
  ADD COLUMN provider text NOT NULL DEFAULT 'manual'
    CHECK (provider IN ('gemini', 'claude', 'manual'));

ALTER TABLE paper_companions ALTER COLUMN provider SET DEFAULT 'gemini';

-- Rate-limit cursor read by analyze-paper (§11 Q2 + Q5).
-- Distinct from generated_at because we may later separate "last attempt"
-- from "last successful write"; for now they move together in the UPSERT.
ALTER TABLE paper_companions
  ADD COLUMN last_synthesis_at timestamptz;

-- Telemetry only — incremented atomically in the UPSERT (§13.6).
-- Not used for enforcement; rate-limit cap is wall-clock, not count.
ALTER TABLE paper_companions
  ADD COLUMN regeneration_count integer NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- paper_socratic_turns — transcript log for analyze-socratic.
-- SERIAL surrogate to match project convention (papers/members/meetings
-- are all SERIAL); paper_companions itself is paper_id-keyed (no surrogate).
CREATE TABLE paper_socratic_turns (
  id serial PRIMARY KEY,
  paper_id int NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  member_id int NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  prompt_id text NOT NULL,
  turn_number integer NOT NULL,
  user_response text NOT NULL,
  ai_next_question text,
  ai_summary text,
  provider text NOT NULL CHECK (provider IN ('gemini', 'claude')),
  model text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX paper_socratic_turns_paper_member
  ON paper_socratic_turns(paper_id, member_id);

ALTER TABLE paper_socratic_turns ENABLE ROW LEVEL SECURITY;

-- Members can read their own turn history ("resume Socratic session" UX).
CREATE POLICY paper_socratic_turns_select ON paper_socratic_turns
  FOR SELECT TO authenticated
  USING (member_id = current_member_id());

-- Inserts via the analyze-socratic Edge Function use the service role,
-- which bypasses RLS. This policy ensures direct member-context inserts
-- (e.g. accidental client-side write, Supabase dashboard query, a future
-- RPC that forgets to drop privileges) are rejected.
CREATE POLICY paper_socratic_turns_block_member_insert ON paper_socratic_turns
  FOR INSERT TO authenticated
  WITH CHECK (false);

-- ---------------------------------------------------------------------------
-- upsert_paper_companion: atomic write for analyze-paper (spec §13.6).
--
-- The Edge Function MUST call this rather than two separate statements
-- (insert + increment) so a crash mid-write can't desync
-- regeneration_count from payload. SECURITY DEFINER because Edge Function
-- already uses the service role — definer drop is here for future RPC
-- callers that might run with weaker grants.
CREATE OR REPLACE FUNCTION upsert_paper_companion(
  p_paper_id     int,
  p_payload      jsonb,
  p_provider     text,
  p_model        text,
  p_generated_by int
) RETURNS void
LANGUAGE SQL SECURITY DEFINER SET search_path = 'public' AS $$
  INSERT INTO paper_companions
    (paper_id, payload, provider, model, generated_by,
     generated_at, last_synthesis_at, regeneration_count)
  VALUES
    (p_paper_id, p_payload, p_provider, p_model, p_generated_by,
     now(), now(), 1)
  ON CONFLICT (paper_id) DO UPDATE SET
    payload            = EXCLUDED.payload,
    provider           = EXCLUDED.provider,
    model              = EXCLUDED.model,
    generated_by       = EXCLUDED.generated_by,
    generated_at       = now(),
    last_synthesis_at  = now(),
    regeneration_count = paper_companions.regeneration_count + 1;
$$;

-- Locked down to the service role. The Edge Function uses the service-role
-- client which bypasses these GRANTs entirely; this REVOKE just makes
-- sure nobody else can call it via the PostgREST endpoint.
REVOKE EXECUTE ON FUNCTION public.upsert_paper_companion(int, jsonb, text, text, int)
  FROM PUBLIC, anon, authenticated;

COMMIT;
