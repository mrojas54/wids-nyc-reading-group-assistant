import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { myAvailabilitySubmitted } from "../queries";

// Regression guard for a defense-in-depth fix: myAvailabilitySubmitted used
// to filter only by meeting_id, relying entirely on RLS to scope rows to the
// current member. If RLS ever loosens (or a service-role client is passed in
// by mistake), the missing member_id filter would silently flip every member
// to "Submitted ✓" once anyone in the cohort had submitted.

type EqCall = { col: string; val: unknown };

function buildSb(opts: {
  memberId: number | null;
  count: number;
}): { sb: SupabaseClient; eqCalls: EqCall[] } {
  const eqCalls: EqCall[] = [];

  const queryBuilder = {
    eq(col: string, val: unknown) {
      eqCalls.push({ col, val });
      return this;
    },
    then(resolve: (value: { count: number }) => unknown) {
      return Promise.resolve({ count: opts.count }).then(resolve);
    },
  };

  const sb = {
    rpc: vi.fn().mockResolvedValue({ data: opts.memberId }),
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue(queryBuilder),
    }),
  } as unknown as SupabaseClient;

  return { sb, eqCalls };
}

describe("myAvailabilitySubmitted", () => {
  it("returns false without querying when there is no current member", async () => {
    const { sb, eqCalls } = buildSb({ memberId: null, count: 99 });
    const result = await myAvailabilitySubmitted(sb, 7);
    expect(result).toBe(false);
    // No need to hit the availability table when we know there's no member.
    expect(eqCalls).toEqual([]);
  });

  it("filters by BOTH meeting_id and member_id", async () => {
    const { sb, eqCalls } = buildSb({ memberId: 42, count: 1 });
    await myAvailabilitySubmitted(sb, 7);
    expect(eqCalls).toContainEqual({ col: "meeting_id", val: 7 });
    expect(eqCalls).toContainEqual({ col: "member_id", val: 42 });
  });

  it("returns true when the current member has at least one row", async () => {
    const { sb } = buildSb({ memberId: 42, count: 1 });
    expect(await myAvailabilitySubmitted(sb, 7)).toBe(true);
  });

  it("returns false when the current member has no rows for the meeting", async () => {
    const { sb } = buildSb({ memberId: 42, count: 0 });
    expect(await myAvailabilitySubmitted(sb, 7)).toBe(false);
  });
});
