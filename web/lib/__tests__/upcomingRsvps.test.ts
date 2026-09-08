import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { upcomingRsvps } from "../queries";

// upcomingRsvps backs /me/rsvps — the page the "Manage your RSVPs" footer link
// in every transactional email lands on. Two things have to hold: a member only
// ever sees their OWN answers (belt-and-braces on top of attendance_select_own),
// and a meeting with no attendance row reads as null rather than as a decline.

type EqCall = { col: string; val: unknown };
type InCall = { col: string; vals: unknown[] };

const MEETING_37 = {
  id: 37,
  type: "reading_group",
  scheduled_at: "2026-08-13T22:00:00Z",
  location: "Prince Tea House - Ktown",
  members: { name: "Michelle" },
  papers: { title: "Attention Is All You Need" },
};

const MEETING_38 = {
  id: 38,
  type: "admin",
  scheduled_at: "2026-08-27T22:00:00Z",
  location: null,
  members: null,
  papers: null,
};

function buildSb(opts: { meetings: unknown[]; attendance?: unknown[] }): {
  sb: SupabaseClient;
  tables: string[];
  eqCalls: EqCall[];
  inCalls: InCall[];
  orderCalls: { col: string; opts: unknown }[];
} {
  const tables: string[] = [];
  const eqCalls: EqCall[] = [];
  const inCalls: InCall[] = [];
  const orderCalls: { col: string; opts: unknown }[] = [];

  // meetings resolves off .order(); meeting_attendance resolves off .in().
  function meetingsBuilder() {
    const b = {
      eq(col: string, val: unknown) {
        eqCalls.push({ col, val });
        return b;
      },
      gte(col: string, val: unknown) {
        eqCalls.push({ col, val });
        return b;
      },
      order(col: string, o: unknown) {
        orderCalls.push({ col, opts: o });
        const result: any = { data: opts.meetings, error: null };
        const p: any = Promise.resolve(result);
        p.returns = () => p;
        return p;
      },
    };
    return b;
  }

  function attendanceBuilder() {
    const b = {
      eq(col: string, val: unknown) {
        eqCalls.push({ col, val });
        return b;
      },
      in(col: string, vals: unknown[]) {
        inCalls.push({ col, vals });
        const result: any = { data: opts.attendance ?? [], error: null };
        const p: any = Promise.resolve(result);
        p.returns = () => p;
        return p;
      },
    };
    return b;
  }

  const sb = {
    from: vi.fn((table: string) => {
      tables.push(table);
      return {
        select: vi.fn(() =>
          table === "meetings" ? meetingsBuilder() : attendanceBuilder(),
        ),
      };
    }),
  } as unknown as SupabaseClient;

  return { sb, tables, eqCalls, inCalls, orderCalls };
}

describe("upcomingRsvps", () => {
  it("filters attendance by member_id, not by RLS alone", async () => {
    // Same defense-in-depth guard as myAvailabilitySubmitted: without this the
    // page would show one member another member's answers the moment RLS
    // loosened or a service-role client was passed in by mistake.
    const { sb, eqCalls } = buildSb({ meetings: [MEETING_37] });
    await upcomingRsvps(sb, 42);
    expect(eqCalls).toContainEqual({ col: "member_id", val: 42 });
  });

  it("asks only for the meetings on screen", async () => {
    const { sb, inCalls } = buildSb({ meetings: [MEETING_37, MEETING_38] });
    await upcomingRsvps(sb, 42);
    expect(inCalls).toEqual([{ col: "meeting_id", vals: [37, 38] }]);
  });

  it("pushes the scheduled-status filter and soonest-first order into SQL", async () => {
    const { sb, eqCalls, orderCalls } = buildSb({ meetings: [MEETING_37] });
    await upcomingRsvps(sb, 42);
    expect(eqCalls).toContainEqual({ col: "status", val: "scheduled" });
    expect(orderCalls).toEqual([
      { col: "scheduled_at", opts: { ascending: true } },
    ]);
  });

  it("joins each meeting to the caller's own answer", async () => {
    const { sb } = buildSb({
      meetings: [MEETING_37, MEETING_38],
      attendance: [{ meeting_id: 38, rsvp_status: "declined" }],
    });
    const rows = await upcomingRsvps(sb, 42);
    expect(rows).toEqual([
      {
        meeting_id: 37,
        type: "reading_group",
        scheduled_at: "2026-08-13T22:00:00Z",
        location: "Prince Tea House - Ktown",
        leader_name: "Michelle",
        paper_title: "Attention Is All You Need",
        rsvp_status: null,
      },
      {
        meeting_id: 38,
        type: "admin",
        scheduled_at: "2026-08-27T22:00:00Z",
        location: null,
        leader_name: null,
        paper_title: null,
        rsvp_status: "declined",
      },
    ]);
  });

  it("reports an un-answered meeting as null, never as a decline", async () => {
    // RsvpButtons seeds its picker from this value; anything non-null collapses
    // the card to "You're …". A wrong default would tell a member they had
    // answered when they hadn't.
    const { sb } = buildSb({ meetings: [MEETING_37], attendance: [] });
    const [row] = await upcomingRsvps(sb, 42);
    expect(row.rsvp_status).toBeNull();
  });

  it("skips the attendance query entirely when the caller is not on the roster", async () => {
    const { sb, tables, inCalls } = buildSb({ meetings: [MEETING_37] });
    const rows = await upcomingRsvps(sb, null);
    expect(tables).toEqual(["meetings"]);
    expect(inCalls).toEqual([]);
    expect(rows[0].rsvp_status).toBeNull();
  });

  it("returns an empty list — and no attendance query — when nothing is scheduled", async () => {
    const { sb, tables } = buildSb({ meetings: [] });
    expect(await upcomingRsvps(sb, 42)).toEqual([]);
    expect(tables).toEqual(["meetings"]);
  });
});
