import { requireRole, type RoleContext } from "./requireLeaderRole";

// Operator-only surfaces: booking the meeting (/admin/schedule). `admin` is the
// owner-level role (see canSynthesizePaperPal's "owner" reason), so it rides
// along; `leader` deliberately does not — see canScheduleMeeting in lib/roles.
const OPERATOR_ROLES: ReadonlySet<"operator" | "admin"> = new Set(["operator", "admin"]);

export type OperatorRoleContext = RoleContext<"operator" | "admin">;

export async function requireOperatorRole(): Promise<OperatorRoleContext> {
  return requireRole(OPERATOR_ROLES);
}
