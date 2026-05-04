-- migrations/005_revoke_rls_auto_enable.sql
-- Revoke RPC access to public.rls_auto_enable(). It's the function backing
-- the `ensure_rls` event trigger (auto-enables RLS on every new public table).
-- Event triggers fire from the DB engine, not via PostgREST, so revoking
-- EXECUTE does not break the trigger — it only removes /rest/v1/rpc exposure.
BEGIN;

REVOKE EXECUTE ON FUNCTION public.rls_auto_enable()
  FROM PUBLIC, anon, authenticated;

COMMIT;
