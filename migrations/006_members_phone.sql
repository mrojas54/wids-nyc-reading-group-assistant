-- migrations/006_members_phone.sql
-- Adds E.164 format CHECK constraints to existing members.phone and
-- members.whatsapp columns (added in 001_initial_schema.sql but never
-- validated). Both columns stay nullable; values must be E.164
-- (+ then 1-15 digits, first non-zero) or NULL.
BEGIN;

ALTER TABLE members ADD CONSTRAINT members_phone_e164_check
  CHECK (phone IS NULL OR phone ~ '^\+[1-9][0-9]{1,14}$');

ALTER TABLE members ADD CONSTRAINT members_whatsapp_e164_check
  CHECK (whatsapp IS NULL OR whatsapp ~ '^\+[1-9][0-9]{1,14}$');

COMMENT ON COLUMN members.phone IS
  'E.164 format (e.g. +14155551212). Used for member contact and future SMS OTP auth.';

COMMENT ON COLUMN members.whatsapp IS
  'E.164 format (e.g. +14155551212). Used for WhatsApp contact.';

COMMIT;
