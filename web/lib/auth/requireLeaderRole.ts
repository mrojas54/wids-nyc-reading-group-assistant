import { UnauthorizedError, ForbiddenError } from "@/lib/suggest/types";

// Allowed roles for /admin/* routes. migrations/014_members_role_leader_admin.sql
// widens members.role to include 'leader' and 'admin'; the original operator
// role remains allowed for owner/admin workflows.
const ALLOWED_ROLES = new Set(["operator", "leader", "admin"] as const);
type AllowedRole = "operator" | "leader" | "admin";

export type LeaderRoleContext = {
  userId: string;
  role: AllowedRole;
};

export async function requireLeaderRole(): Promise<LeaderRoleContext> {
  // Import lazily inside the function so this module can be unit-tested
  // by stubbing the import (or simply not imported in non-server contexts).
  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new UnauthorizedError();

  // CRITICAL: members.id is SERIAL INT; user.id is a UUID. The bridge column
  // is members.auth_user_id (added in migrations/002_member_app.sql). Other
  // role lookups in this codebase (web/app/availability/actions.ts,
  // web/app/dashboard/rsvp-actions.ts) follow the same pattern.
  const { data: member, error } = await supabase
    .from("members")
    .select("role")
    .eq("auth_user_id", user.id)
    .single();
  if (error || !member) throw new ForbiddenError();
  if (!ALLOWED_ROLES.has(member.role as AllowedRole)) throw new ForbiddenError();
  return { userId: user.id, role: member.role as AllowedRole };
}
