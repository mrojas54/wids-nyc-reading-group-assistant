import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { myAvailabilitySubmitted, myHistory, myStats } from "../queries";

// Regression guard for a defense-in-depth fix: myAvailabilitySubmitted used
// to filter only by meeting_id, relying entirely on RLS to scope rows to the
// current member. If RLS ever loosens (or a service-role client is passed in
// by mistake), the missing member_id filter would silently flip every member
// to "Submitted ✓" once anyone in the cohort had submitted.

type EqCall = { col: string; val: unknown };

function buildSb(opts: {
  count: number;
}): { sb: SupabaseClient; eqCalls: EqCall[]; rpc: ReturnType<typeof vi.fn> } {
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

  const rpc = vi.fn();
  const sb = {
    rpc,
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue(queryBuilder),
    }),
  } as unknown as SupabaseClient;

  return { sb, eqCalls, rpc };
}

describe("myAvailabilitySubmitted", () => {
  it("returns false without querying when there is no current member", async () => {
    const { sb, eqCalls } = buildSb({ count: 99 });
    const result = await myAvailabilitySubmitted(sb, 7, null);
    expect(result).toBe(false);
    // No need to hit the availability table when we know there's no member.
    expect(eqCalls).toEqual([]);
  });

  it("filters by BOTH meeting_id and member_id", async () => {
    const { sb, eqCalls } = buildSb({ count: 1 });
    await myAvailabilitySubmitted(sb, 7, 42);
    expect(eqCalls).toContainEqual({ col: "meeting_id", val: 7 });
    expect(eqCalls).toContainEqual({ col: "member_id", val: 42 });
  });

  it("takes the member id as a parameter — no current_member_id RPC", async () => {
    const { sb, rpc } = buildSb({ count: 1 });
    await myAvailabilitySubmitted(sb, 7, 42);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns true when the current member has at least one row", async () => {
    const { sb } = buildSb({ count: 1 });
    expect(await myAvailabilitySubmitted(sb, 7, 42)).toBe(true);
  });

  it("returns false when the current member has no rows for the meeting", async () => {
    const { sb } = buildSb({ count: 0 });
    expect(await myAvailabilitySubmitted(sb, 7, 42)).toBe(false);
  });
});

// --- myStats -------------------------------------------------------------

function buildStatsSb(opts: { attended: number; led: number }): {
  sb: SupabaseClient;
  rpc: ReturnType<typeof vi.fn>;
  attendedEqs: EqCall[];
  ledEqs: EqCall[];
} {
  const attendedEqs: EqCall[] = [];
  const ledEqs: EqCall[] = [];

  function builder(eqSink: EqCall[], count: number) {
    const b = {
      eq(col: string, val: unknown) {
        eqSink.push({ col, val });
        return b;
      },
      then(resolve: (value: { count: number }) => unknown) {
        return Promise.resolve({ count }).then(resolve);
      },
    };
    return b;
  }

  const rpc = vi.fn();
  const sb = {
    rpc,
    from: vi.fn((table: string) => ({
      select: vi.fn(() =>
        table === "meeting_attendance"
          ? builder(attendedEqs, opts.attended)
          : builder(ledEqs, opts.led),
      ),
    })),
  } as unknown as SupabaseClient;

  return { sb, rpc, attendedEqs, ledEqs };
}

describe("myStats", () => {
  it("threads the member id in — never calls the current_member_id RPC", async () => {
    const { sb, rpc } = buildStatsSb({ attended: 3, led: 1 });
    await myStats(sb, true, 42);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns attended/led counts and passes availability through", async () => {
    const { sb } = buildStatsSb({ attended: 3, led: 1 });
    const stats = await myStats(sb, true, 42);
    expect(stats).toEqual({
      meetingsAttended: 3,
      papersLed: 1,
      availabilitySubmitted: true,
    });
  });

  it("scopes the papers-led query to the member id", async () => {
    const { sb, ledEqs } = buildStatsSb({ attended: 0, led: 2 });
    await myStats(sb, false, 42);
    expect(ledEqs).toContainEqual({ col: "leader_id", val: 42 });
  });

  it("reports zero papers led when there is no current member", async () => {
    const { sb } = buildStatsSb({ attended: 5, led: 9 });
    const stats = await myStats(sb, false, null);
    expect(stats.papersLed).toBe(0);
    expect(stats.meetingsAttended).toBe(5);
  });
});

// --- myHistory -----------------------------------------------------------

function buildHistorySb(rows: unknown[]): {
  sb: SupabaseClient;
  selectArgs: string[];
  eqCalls: EqCall[];
  orderCalls: { col: string; opts: unknown }[];
  limitCalls: number[];
} {
  const selectArgs: string[] = [];
  const eqCalls: EqCall[] = [];
  const orderCalls: { col: string; opts: unknown }[] = [];
  const limitCalls: number[] = [];

  const builder = {
    eq(col: string, val: unknown) {
      eqCalls.push({ col, val });
      return builder;
    },
    order(col: string, opts: unknown) {
      orderCalls.push({ col, opts });
      return builder;
    },
    limit(n: number) {
      limitCalls.push(n);
      return Promise.resolve({ data: rows });
    },
  };

  const sb = {
    from: vi.fn().mockReturnValue({
      select: vi.fn((arg: string) => {
        selectArgs.push(arg);
        return builder;
      }),
    }),
  } as unknown as SupabaseClient;

  return { sb, selectArgs, eqCalls, orderCalls, limitCalls };
}

describe("myHistory", () => {
  it("pushes the done-status filter and ordering into SQL", async () => {
    const { sb, selectArgs, eqCalls, orderCalls, limitCalls } =
      buildHistorySb([]);
    await myHistory(sb, 10);

    // Inner join so the status filter prunes meeting_attendance rows directly.
    expect(selectArgs[0]).toContain("!inner");
    expect(eqCalls).toContainEqual({ col: "rsvp_status", val: "attending" });
    expect(eqCalls).toContainEqual({ col: "meetings.status", val: "done" });

    expect(orderCalls).toEqual([
      {
        col: "scheduled_at",
        opts: { referencedTable: "meetings", ascending: false, nullsFirst: false },
      },
    ]);

    // No `* 2` padding — ask the DB for exactly `limit` rows.
    expect(limitCalls).toEqual([10]);
  });

  it("maps embedded meeting + paper fields into HistoryItem shape", async () => {
    const { sb } = buildHistorySb([
      {
        meetings: {
          id: 5,
          scheduled_at: "2026-04-01T00:00:00Z",
          status: "done",
          papers: { title: "Attention Is All You Need", companion_url: "u" },
        },
      },
    ]);
    const items = await myHistory(sb, 10);
    expect(items).toEqual([
      {
        meeting_id: 5,
        paper_title: "Attention Is All You Need",
        date: "2026-04-01T00:00:00Z",
        companion_url: "u",
      },
    ]);
  });

  it("returns an empty list when there are no attended-done meetings", async () => {
    const { sb } = buildHistorySb([]);
    expect(await myHistory(sb, 10)).toEqual([]);
  });
});
