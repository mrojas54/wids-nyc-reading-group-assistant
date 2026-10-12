import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// requireOperatorRole pulls in the session client; only its role set is under test.
vi.mock("@/lib/auth/requireLeaderRole", () => ({ requireRole: vi.fn() }));

import { canFindPaper, canScheduleMeeting, isAdmin, type MemberRole } from "../roles";
import { OPERATOR_ROLES } from "../auth/requireOperatorRole";

// __dirname = web/lib/__tests__ → repo root is three levels up.
const read = (path: string) => readFileSync(resolve(__dirname, "../../..", path), "utf8");

// Everything after the header comment, which names the other copy and so must differ.
function body(source: string): string {
  const marker = "export type MemberRole";
  const i = source.indexOf(marker);
  if (i < 0) throw new Error(`no "${marker}" in roles.ts`);
  return source.slice(i);
}

const ROLES: MemberRole[] = ["member", "operator", "leader", "admin"];

describe("roles.ts", () => {
  it("matches its Deno copy below the header", () => {
    expect(body(read("supabase/functions/_shared/roles.ts"))).toBe(body(read("web/lib/roles.ts")));
  });

  it("covers the roles members_role_check allows (migration 014)", () => {
    const migration = read("migrations/014_members_role_leader_admin.sql");
    const check = migration.match(/CHECK \(role IN \(([^)]*)\)\)/);
    if (!check) throw new Error("no CHECK (role IN (...)) in migration 014");
    const allowed = [...check[1].matchAll(/'(\w+)'/g)].map((m) => m[1]);
    expect(new Set(allowed)).toEqual(new Set(ROLES));
  });

  it("keeps the /admin/schedule gate in step with canScheduleMeeting", () => {
    for (const role of ROLES) {
      expect(OPERATOR_ROLES.has(role as "operator" | "admin"), role).toBe(canScheduleMeeting(role));
    }
  });

  it.each([
    ["member", false, false, false],
    ["operator", false, true, true],
    ["leader", false, true, false],
    ["admin", true, true, true],
    ["unknown", false, false, false],
    [null, false, false, false],
  ])("%s: isAdmin=%s canFindPaper=%s canScheduleMeeting=%s", (role, admin, find, schedule) => {
    expect([isAdmin(role), canFindPaper(role), canScheduleMeeting(role)]).toEqual([admin, find, schedule]);
  });
});
