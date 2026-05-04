-- migrations/004_function_grants.sql
-- Restrict current_member_id() to authenticated callers only.
-- The function is SECURITY DEFINER (it must read members.auth_user_id), but
-- there's no reason for anon to invoke it via /rest/v1/rpc/current_member_id.
-- All RLS policies that call it are scoped TO authenticated, so revoking
-- EXECUTE from anon doesn't break any existing policy evaluation.
BEGIN;

REVOKE EXECUTE ON FUNCTION public.current_member_id() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.current_member_id() TO authenticated;

COMMIT;
