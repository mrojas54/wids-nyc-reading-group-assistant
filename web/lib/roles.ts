// Canonical member-role vocabulary. The allowed values are enforced in
// the database by the members_role_check constraint — see
// migrations/014_members_role_leader_admin.sql.
//
// A Deno-side copy lives at supabase/functions/_shared/roles.ts; the two
// runtimes can't share a module, so keep them in sync.

export type MemberRole = "member" | "operator" | "leader" | "admin";

// `role` is typed loosely because callers read it from untyped Supabase
// rows / RPC results; an unknown string simply fails every predicate.
type RoleInput = MemberRole | string | null | undefined;

// Strictly the 'admin' role. Used where admin is a distinct privilege
// from operator (e.g. provider override in analyze-paper).
export function isAdmin(role: RoleInput): boolean {
  return role === "admin";
}

// Roles allowed to search and rank papers for an upcoming meeting.
export function canFindPaper(role: RoleInput): boolean {
  return role === "operator" || role === "leader" || role === "admin";
}
