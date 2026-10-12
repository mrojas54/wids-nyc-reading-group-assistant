import { beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { call, fail, fakeSupabase, has, ok, type Query, type Response } from "./fakeSupabase";
import { loadSchedulePoll, pollClosesAt } from "../loadPoll";

const PREP_ROW = {
  id: 41,
  created_at: "2026-09-27T14:00:00.000Z",
  leader_id: 1,
  paper_id: 7,
  members: { name: "Maya" },
  papers: {
    id: 7,
    title: "Attention Is All You Need",
    authors: ["Ashish Vaswani"],
    year: 2017,
    url: "https://arxiv.org/abs/1706.03762",
    paper_companions: [{ paper_id: 7 }],
  },
};
const MEMBERS = [
  { id: 1, name: "Maya" },
  { id: 2, name: "Priya" },
];
// 6 PM New York, as availability rows store it.
const AVAILABILITY = [
  { member_id: 1, range_start: "2026-10-06T22:00:00.000Z" },
  { member_id: 2, range_start: "2026-10-06T22:00:00.000Z" },
  { member_id: 2, range_start: "2026-11-03T23:00:00.000Z" },
];
const OCT_6_BLACKOUT = { range_start: "2026-10-06T21:00:00.000Z", range_end: "2026-10-07T03:00:00.000Z" };

type Overrides = Partial<{
  meeting: Response;
  members: Response;
  venue: Response;
  availability: Response;
  blackouts: Response;
}>;

let svc: ReturnType<typeof fakeSupabase>;

function setup(o: Overrides = {}) {
  svc = fakeSupabase((q: Query) => {
    if (q.table === "meetings") {
      // The venue lookup is the only meetings query that filters status with .in().
      if (has(q, "in")) return o.venue ?? ok({ location: "Think Coffee" });
      return o.meeting ?? ok(PREP_ROW);
    }
    if (q.table === "members") return o.members ?? ok(MEMBERS);
    if (q.table === "availability") return o.availability ?? ok(AVAILABILITY);
    if (q.table === "blackout_periods") return o.blackouts ?? ok([]);
    throw new Error(`unexpected table ${q.table}`);
  });
}

const load = () => loadSchedulePoll(svc.client as unknown as SupabaseClient<Database>);

beforeEach(() => setup());

describe("pollClosesAt", () => {
  it("is a week after the poll opened", () => {
    expect(pollClosesAt({ created_at: "2026-09-27T14:00:00.000Z" })).toBe("2026-10-04T14:00:00.000Z");
  });
});

describe("loadSchedulePoll", () => {
  it("reads only the cycle's canonical reading group in prep", async () => {
    await load();
    const meetingQuery = svc.queries.find((q) => q.table === "meetings" && !has(q, "in"));
    expect(meetingQuery?.calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([
      ["type", "reading_group"],
      ["status", "prep"],
    ]);
    // Never a member's proposePaper placeholder, which is also reading_group + prep.
    expect(call(meetingQuery, "not")).toEqual(["planned_by_admin_id", "is", null]);
  });

  it("shapes the meeting, answers, poll window and default venue", async () => {
    const data = await load();
    expect(data.meeting).toEqual({
      id: 41,
      created_at: "2026-09-27T14:00:00.000Z",
      leader_id: 1,
      leader_name: "Maya",
      paper: {
        id: 7,
        title: "Attention Is All You Need",
        authors: ["Ashish Vaswani"],
        year: 2017,
        url: "https://arxiv.org/abs/1706.03762",
        hasPaperPal: true,
      },
    });
    expect(data.members).toEqual(MEMBERS);
    expect(data.responses).toEqual([
      { member_id: 1, day: "2026-10-06" },
      { member_id: 2, day: "2026-10-06" },
      { member_id: 2, day: "2026-11-03" },
    ]);
    expect(data.excludedDays).toEqual([]);
    // Opened Sep 27, so the window runs to the end of October, stretched to a later answer.
    expect(data.pollWindow).toEqual({ start: "2026-09-27", end: "2026-11-03" });
    expect(data.defaultLocation).toBe("Think Coffee");
    expect(data.pollClosesAt).toBe("2026-10-04T14:00:00.000Z");
  });

  it.each([
    ["a single embedded row", { paper_id: 7 }, true],
    ["an empty list", [], false],
    ["null", null, false],
  ])("reads Paper Pal as %s", async (_label, embed, expected) => {
    setup({ meeting: ok({ ...PREP_ROW, papers: { ...PREP_ROW.papers, paper_companions: embed } }) });
    const data = await load();
    expect(data.meeting?.paper?.hasPaperPal).toBe(expected);
  });

  it("returns no meeting, but still the roster and venue, when nothing is in prep", async () => {
    setup({ meeting: ok(null) });
    const data = await load();
    expect(data).toEqual({
      meeting: null,
      members: MEMBERS,
      responses: [],
      excludedDays: [],
      pollWindow: null,
      defaultLocation: "Think Coffee",
      pollClosesAt: null,
    });
    expect(svc.queries.some((q) => q.table === "availability")).toBe(false);
  });

  it("drops blacked-out evenings from the window and lists them as excluded", async () => {
    setup({ blackouts: ok([OCT_6_BLACKOUT]) });
    const data = await load();
    expect(data.excludedDays).toEqual(["2026-10-06"]);
    // Responses keep the excluded day; only the window and the calendar's greying change.
    expect(data.responses).toHaveLength(3);
    expect(data.pollWindow).toEqual({ start: "2026-09-27", end: "2026-11-03" });
  });

  it("treats a failed blackout read as no greying, not an error", async () => {
    setup({ blackouts: fail("boom") });
    const data = await load();
    expect(data.excludedDays).toEqual([]);
  });

  it("falls back to no default venue when none is booked yet", async () => {
    setup({ venue: ok(null) });
    expect((await load()).defaultLocation).toBeNull();
  });

  it.each<[string, Overrides, string]>([
    ["meeting", { meeting: fail("m") }, "loadSchedulePoll.meeting: m"],
    ["members", { members: fail("r") }, "loadSchedulePoll.members: r"],
    ["availability", { availability: fail("a") }, "loadSchedulePoll.availability: a"],
  ])("throws when the %s read fails", async (_label, overrides, message) => {
    setup(overrides);
    await expect(load()).rejects.toThrow(message);
  });
});
