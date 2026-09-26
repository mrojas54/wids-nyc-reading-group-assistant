import { UnauthorizedError, ForbiddenError } from "@/lib/suggest/types";
import type { MemberRole } from "@/lib/roles";

// Allowed roles for /admin/* routes. migrations/014_members_role_leader_admin.sql
// widens members.role to include 'leader' and 'admin'; the original operator
// role remains allowed for owner/admin workflows.
const LEADER_ROLES: ReadonlySet<MemberRole> = new Set(["operator", "leader", "admin"]);

export type RoleContext<R extends MemberRole = MemberRole> = {
  userId: string;
  role: R;
  /** members.name — for the "Hi, <name>" greeting, so pages need no second lookup. */
  name: string;
};

export type LeaderRoleContext = RoleContext<"operator" | "leader" | "admin">;

/**
 * Resolve the signed-in member and check their role against `allowed`.
 * Throws UnauthorizedError with no session, ForbiddenError when the member is
 * missing or the role is outside the set. Page-level gates map those to
 * redirects; see /admin/logs for the pattern.
 */
export async function requireRole<R extends MemberRole>(
  allowed: ReadonlySet<R>,
): Promise<RoleContext<R>> {
  // Import lazily inside the function so this module can be unit-tested
  // by stubbing the import (or simply not imported in non-server contexts).
  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const supabase = await createSupabaseServerClient();
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
    .select("role, name")
    .eq("auth_user_id", user.id)
    .single();
  if (error || !member) throw new ForbiddenError();
  if (!allowed.has(member.role as R)) throw new ForbiddenError();
  return { userId: user.id, role: member.role as R, name: member.name };
}

export async function requireLeaderRole(): Promise<LeaderRoleContext> {
  return requireRole(LEADER_ROLES as ReadonlySet<"operator" | "leader" | "admin">);
}
