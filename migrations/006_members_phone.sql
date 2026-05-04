-- migrations/006_members_phone.sql
-- Adds phone number column to members. E.164 format (e.g. +14155551212).
-- Nullable; phones are backfilled after this migration runs (manually or
-- via a follow-up bootstrap update). Data plumbing only — no SMS auth flow yet.
BEGIN;

ALTER TABLE members ADD COLUMN phone TEXT;

ALTER TABLE members ADD CONSTRAINT members_phone_e164_check
  CHECK (phone IS NULL OR phone ~ '^\+[1-9][0-9]{1,14}$');

COMMENT ON COLUMN members.phone IS
  'E.164 format (e.g. +14155551212). Used for member contact and future SMS OTP auth.';

COMMIT;
