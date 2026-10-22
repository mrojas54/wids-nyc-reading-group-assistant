import { beforeEach, describe, expect, it, vi } from "vitest";
import { call, fail, fakeSupabase, has, ok, type Query, type Response } from "@/lib/schedule/__tests__/fakeSupabase";
import { nyDayAtTime, nyDayKey } from "@/lib/time";

// actions.ts pulls in next/cache, the operator gate, the service client and
// the command_log writer: all mocked, so these tests exercise only the
// action's own validation, write order and logging.
const { logServerAction, revalidatePath, requireOperatorRole } = vi.hoisted(() => ({
  logServerAction: vi.fn(),
  revalidatePath: vi.fn(),
  requireOperatorRole: vi.fn(),
}));
vi.mock("@/lib/log", () => ({ logServerAction }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/auth/requireOperatorRole", () => ({ requireOperatorRole }));

let svc: ReturnType<typeof fakeSupabase>;
vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => svc.client,
}));

import { requestAvailabilityReminder, scheduleMeeting } from "../actions";

const PREP_MEETING = {
  id: 41,
  type: "reading_group",
  status: "prep",
  leader_id: 1,
  paper_id: 7,
  planned_by_admin_id: 3,
  members: { name: "Maya" },
  papers: { title: "Attention Is All You Need" },
};
// Availability rows store 6 PM New York as range_start.
const OCT_15_6PM = "2026-10-15T22:00:00.000Z";
const ROSTER = [
  { id: 1, email: "maya@example.org" },
  { id: 2, email: "priya@example.org" },
];
const INPUT = { meetingId: 41, day: "2026-10-15", time: "7:00 PM", location: "  Think Coffee  " };

type Overrides = Partial<{
  meeting: Response;
  availability: Response;
  blackouts: Response;
  update: Response;
  roster: Response;
  attendance: Response;
}>;

function setup(o: Overrides = {}) {
  svc = fakeSupabase((q: Query) => {
    if (q.table === "meetings") {
      if (has(q, "update")) return o.update ?? ok([{ id: 41 }]);
      return o.meeting ?? ok(PREP_MEETING);
    }
    if (q.table === "availability") return o.availability ?? ok([{ range_start: OCT_15_6PM }]);
    if (q.table === "blackout_periods") return o.blackouts ?? ok([]);
    if (q.table === "members") return o.roster ?? ok(ROSTER);
    if (q.table === "meeting_attendance") return o.attendance ?? ok(null);
    throw new Error(`unexpected table ${q.table}`);
  });
}

const queriesOn = (table: string) => svc.queries.filter((q) => q.table === table);
const updateQuery = () => queriesOn("meetings").find((q) => has(q, "update"));

beforeEach(() => {
  logServerAction.mockReset();
  revalidatePath.mockReset();
  requireOperatorRole.mockReset();
  requireOperatorRole.mockResolvedValue({ userId: "u-1" });
  setup();
});

describe("scheduleMeeting", () => {
  it("refuses anyone the operator gate rejects, before touching the database", async () => {
    requireOperatorRole.mockRejectedValue(new Error("forbidden"));
    const r = await scheduleMeeting(INPUT);
    expect(r).toEqual({ ok: false, message: "Only the operator can schedule meetings." });
    expect(svc.queries).toHaveLength(0);
  });

  it.each([
    [{ day: "Oct 15" }, "Pick an evening from the poll first."],
    [{ time: "evening" }, "Enter a start time like 7:00 PM."],
    [{ location: "   " }, "Enter a location."],
  ])("rejects bad input %o without a query", async (patch, message) => {
    const r = await scheduleMeeting({ ...INPUT, ...patch });
    expect(r).toEqual({ ok: false, message });
    expect(svc.queries).toHaveLength(0);
  });

  it("books the evening: guarded update, one attendance row per member, needs_action log", async () => {
    const r = await scheduleMeeting(INPUT);
    const scheduledAt = nyDayAtTime("2026-10-15", 19, 0);
    expect(r).toEqual({ ok: true, scheduledAt, inviteSent: false, total: 2 });

    const update = updateQuery();
    expect(call(update, "update")).toEqual([
      { scheduled_at: scheduledAt, location: "Think Coffee", status: "scheduled" },
    ]);
    // status='prep' in the WHERE is what makes a double submit a no-op.
    expect(update?.calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([
      ["id", 41],
      ["status", "prep"],
    ]);

    expect(call(queriesOn("meeting_attendance")[0], "upsert")).toEqual([
      [
        { meeting_id: 41, member_id: 1, rsvp_status: "no_response" },
        { meeting_id: 41, member_id: 2, rsvp_status: "no_response" },
      ],
      { onConflict: "meeting_id,member_id", ignoreDuplicates: true },
    ]);

    expect(logServerAction).toHaveBeenCalledTimes(1);
    const [name, status, summary, , extra] = logServerAction.mock.calls[0];
    expect([name, status]).toEqual(["scheduleMeeting", "needs_action"]);
    expect(summary).toContain("NOT sent");
    expect(extra).toMatchObject({
      actor: "member:u-1",
      metadata: { kind: "schedule_meeting", meeting_id: 41, invite_sent: false, attendees: 2 },
    });
    expect(revalidatePath.mock.calls.map((c) => c[0])).toEqual([
      "/dashboard",
      "/me/rsvps",
      "/admin/schedule",
    ]);
  });

  it("skips the attendance upsert when the roster is empty", async () => {
    setup({ roster: ok([]) });
    const r = await scheduleMeeting(INPUT);
    expect(r).toMatchObject({ ok: true, total: 0 });
    expect(queriesOn("meeting_attendance")).toHaveLength(0);
  });

  it.each<[string, Overrides, string]>([
    ["the meeting is missing", { meeting: ok(null) }, "We couldn't find that meeting."],
    ["the meeting read fails", { meeting: fail("boom") }, "We couldn't find that meeting."],
    [
      "the meeting is already scheduled",
      { meeting: ok({ ...PREP_MEETING, status: "scheduled" }) },
      "This meeting isn't waiting to be scheduled.",
    ],
    [
      "it is a member's proposePaper placeholder",
      { meeting: ok({ ...PREP_MEETING, planned_by_admin_id: null }) },
      "This meeting isn't waiting to be scheduled.",
    ],
    [
      "it is not a reading group",
      { meeting: ok({ ...PREP_MEETING, type: "admin" }) },
      "This meeting isn't waiting to be scheduled.",
    ],
    ["no leader is picked", { meeting: ok({ ...PREP_MEETING, leader_id: null }) }, "Pick a leader and paper first."],
    ["no paper is picked", { meeting: ok({ ...PREP_MEETING, paper_id: null }) }, "Pick a leader and paper first."],
    [
      "the evening is not in the poll",
      { availability: ok([{ range_start: "2026-10-16T22:00:00.000Z" }]) },
      "That evening isn't in the poll.",
    ],
    ["the poll read fails", { availability: fail("boom") }, "We couldn't read the poll — try again."],
    [
      "the blackout read fails",
      { blackouts: fail("boom") },
      "We couldn't read the blackout windows — try again.",
    ],
    [
      "the evening falls in a blackout",
      { blackouts: ok([{ range_start: "2026-10-15T21:00:00.000Z", range_end: "2026-10-16T03:00:00.000Z" }]) },
      "That evening falls in a blackout window.",
    ],
  ])("refuses when %s, without writing", async (_label, overrides, message) => {
    setup(overrides);
    const r = await scheduleMeeting(INPUT);
    expect(r).toEqual({ ok: false, message });
    expect(updateQuery()).toBeUndefined();
    expect(logServerAction).not.toHaveBeenCalled();
  });

  it("treats zero updated rows as someone else booking first", async () => {
    setup({ update: ok([]) });
    const r = await scheduleMeeting(INPUT);
    expect(r).toEqual({ ok: false, message: "This meeting was already scheduled." });
    expect(queriesOn("members")).toHaveLength(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it.each<[string, Overrides, string, string]>([
    ["the update fails", { update: fail("update died") }, "We couldn't save the meeting — try again.", "meeting 41"],
    [
      "the roster read fails",
      { roster: fail("roster died") },
      "Saved the date, but couldn't read the roster for the invite.",
      "meeting 41: roster",
    ],
    [
      "the attendance upsert fails",
      { attendance: fail("upsert died") },
      "Saved the date, but couldn't open RSVPs — check the event log.",
      "meeting 41: attendance rows",
    ],
  ])("logs a failure row when %s", async (_label, overrides, message, summary) => {
    setup(overrides);
    const r = await scheduleMeeting(INPUT);
    expect(r).toEqual({ ok: false, message });
    expect(logServerAction).toHaveBeenCalledTimes(1);
    expect(logServerAction.mock.calls[0].slice(0, 3)).toEqual(["scheduleMeeting", "failure", summary]);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("requestAvailabilityReminder", () => {
  it("refuses anyone the operator gate rejects", async () => {
    requireOperatorRole.mockRejectedValue(new Error("forbidden"));
    const r = await requestAvailabilityReminder(41);
    expect(r).toEqual({ ok: false, message: "Only the operator can schedule meetings." });
    expect(svc.queries).toHaveLength(0);
  });

  it.each([
    ["missing", ok(null)],
    ["no longer in prep", ok({ id: 41, status: "scheduled" })],
  ])("refuses when the meeting is %s", async (_label, meeting) => {
    setup({ meeting });
    const r = await requestAvailabilityReminder(41);
    expect(r).toEqual({ ok: false, message: "This poll isn't open any more." });
    expect(logServerAction).not.toHaveBeenCalled();
  });

  it("logs one needs_action row per meeting per NY day", async () => {
    setup({ meeting: ok({ id: 41, status: "prep" }) });
    const r = await requestAvailabilityReminder(41);
    expect(r).toEqual({ ok: true, mode: "logged" });
    expect(logServerAction).toHaveBeenCalledTimes(1);
    const [name, status, , , extra] = logServerAction.mock.calls[0];
    expect([name, status]).toEqual(["requestAvailabilityReminder", "needs_action"]);
    expect(extra).toMatchObject({
      actor: "member:u-1",
      idempotencyKey: `availability-reminder-request:meeting=41:day=${nyDayKey(new Date())}`,
      metadata: { kind: "availability_reminder_requested", meeting_id: 41 },
    });
  });
});
