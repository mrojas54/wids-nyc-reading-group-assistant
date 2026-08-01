-- migrations/023_members_vouched_by.sql
-- Give the vouching relationship a home in the schema.
--
-- The welcome-and-availability email (assets/emails/template/
-- welcome-availability.*, ported from the Claude Design handoff "Vouched in
-- group email") renders "<name> vouched you in" in three places: the intro,
-- the vouch card, and the footer. Until now that name had no column anywhere
-- in members/meetings/availability/papers and was passed in by the operator at
-- send time, which meant the fact was never recorded — re-sending the same
-- email a month later required remembering who had introduced whom.
--
-- Modelled as a self-referencing FK rather than a TEXT name because the
-- voucher is always an existing member (that is what vouching means here), and
-- a name string would re-type a person as free text: no join, no rename
-- propagation, and two spellings of the same person become two vouchers.
--
-- NULLABLE, and deliberately so. Every one of the eleven existing rows
-- pre-dates the concept, self-serve/operator-added members may have no
-- voucher at all, and the email's vouch card is a per-send toggle that gets
-- switched off precisely when this is NULL. A NOT NULL column would have
-- required inventing a voucher for historical rows.
--
-- ON DELETE SET NULL matches members.auth_user_id (migration 002): removing a
-- member should orphan the reference, never cascade-delete the people they
-- brought in.
--
-- The CHECK blocks self-vouching, which is always a data-entry slip rather
-- than a real relationship.
--
-- No GRANT change. Migration 002 revoked SELECT on members from
-- `authenticated` and re-granted only (id, name, role), so vouched_by is not
-- readable by portal sessions — only by service-role callers (slash commands,
-- server actions). That is the right default: who vouched whom is operator
-- context, not member-facing content. Granting it later is a one-line change
-- if the portal ever needs to show it.
BEGIN;

ALTER TABLE members
  ADD COLUMN IF NOT EXISTS vouched_by INT REFERENCES members(id) ON DELETE SET NULL;

ALTER TABLE members
  DROP CONSTRAINT IF EXISTS members_vouched_by_not_self;
ALTER TABLE members
  ADD CONSTRAINT members_vouched_by_not_self
  CHECK (vouched_by IS NULL OR vouched_by <> id);

-- Supports "who did <member> bring in?" without a sequential scan. The column
-- is sparse, so the partial index stays small.
CREATE INDEX IF NOT EXISTS idx_members_vouched_by
  ON members(vouched_by) WHERE vouched_by IS NOT NULL;

COMMENT ON COLUMN members.vouched_by IS
  'The existing member who vouched this person in. Self-referencing FK, '
  'nullable: NULL means unknown or not applicable (all rows predating '
  'migration 023, plus operator-added members with no voucher). Source for '
  'the {{ vouch.name }} token in welcome-availability; when NULL, render that '
  'email with Blocks(vouch=False) rather than inventing a name.';

COMMIT;
