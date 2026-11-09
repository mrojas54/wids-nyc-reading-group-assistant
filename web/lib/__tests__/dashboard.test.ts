// Unit tests for the /dashboard loader. The page used to make these show/hide
// decisions inline with no direct test.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { NextMeeting, Stats } from "@/lib/queries";
import { loadDashboard } from "../dashboard";

const q = vi.hoisted(() => ({
  nextMeeting: vi.fn(),
  myHistory: vi.fn(),
  currentMemberId: vi.fn(),
  myAvailabilitySubmitted: vi.fn(),
  myRsvp: vi.fn(),
  myStats: vi.fn(),
}));
vi.mock("@/lib/queries", () => q);

const stats: Stats = { meetingsAttended: 3, papersLed: 1, availabilitySubmitted: true };

const meeting = (patch: Partial<NextMeeting> = {}): NextMeeting => ({
  id: 9,
  type: "reading_group",
  status: "scheduled",
  scheduled_at: "2026-11-12T23:30:00Z",
  location: "Room 4",
  leader_name: "Ada",
  paper_id: 12,
  paper_title: "Attention",
  companion_url: "/papers/12",
  ...patch,
});

/** Fake client: a signed-in user whose members row is `member` (or signed out). */
function buildSb(member: { name: string | null; role: string } | null) {
  const eq = vi.fn().mockReturnValue({
    single: () => Promise.resolve({ data: member }),
  });
  const from = vi.fn().mockReturnValue({ select: () => ({ eq }) });
  const sb = {
    auth: {
      getUser: () =>
        Promise.resolve({ data: { user: member ? { id: "uuid-1" } : null } }),
    },
    from,
  } as unknown as SupabaseClient<Database>;
  return { sb, from, eq };
}

beforeEach(() => {
  vi.clearAllMocks();
  q.nextMeeting.mockResolvedValue(meeting());
  q.myHistory.mockResolvedValue([]);
  q.currentMemberId.mockResolvedValue(42);
  q.myAvailabilitySubmitted.mockResolvedValue(false);
  q.myRsvp.mockResolvedValue("attending");
  q.myStats.mockResolvedValue(stats);
});

describe("loadDashboard", () => {
  it("loads a scheduled meeting with the member's RSVP and first name", async () => {
    const { sb, eq } = buildSb({ name: "Grace Hopper", role: "member" });
    const data = await loadDashboard(sb);
    expect(data).toMatchObject({
      rsvp: "attending",
      availabilityStatus: null,
      prepMeetingId: null,
      companionHref: "/papers/12",
      showFindPaper: false,
      showSchedule: false,
      firstName: "Grace",
      stats,
    });
    expect(q.myRsvp).toHaveBeenCalledWith(sb, 9);
    expect(q.myAvailabilitySubmitted).not.toHaveBeenCalled();
    expect(q.myStats).toHaveBeenCalledWith(sb, true, 42);
    expect(eq).toHaveBeenCalledWith("auth_user_id", "uuid-1");
  });

  it("asks for availability during a prep meeting until the member submits", async () => {
    q.nextMeeting.mockResolvedValue(meeting({ status: "prep", paper_id: null }));
    const { sb } = buildSb({ name: "Grace", role: "member" });
    const needed = await loadDashboard(sb);
    expect(needed).toMatchObject({
      availabilityStatus: "needed",
      prepMeetingId: 9,
      rsvp: null,
    });
    expect(q.myAvailabilitySubmitted).toHaveBeenCalledWith(sb, 9, 42);
    expect(q.myRsvp).not.toHaveBeenCalled();
    expect(q.myStats).toHaveBeenCalledWith(sb, false, 42);

    q.myAvailabilitySubmitted.mockResolvedValue(true);
    expect((await loadDashboard(sb)).availabilityStatus).toBe("submitted");
  });

  it("shows Find a paper to leaders only while the reading group has no paper", async () => {
    q.nextMeeting.mockResolvedValue(meeting({ paper_id: null }));
    expect((await loadDashboard(buildSb({ name: "L", role: "leader" }).sb)).showFindPaper).toBe(true);
    expect((await loadDashboard(buildSb({ name: "M", role: "member" }).sb)).showFindPaper).toBe(false);

    q.nextMeeting.mockResolvedValue(meeting());
    expect((await loadDashboard(buildSb({ name: "L", role: "leader" }).sb)).showFindPaper).toBe(false);

    q.nextMeeting.mockResolvedValue(meeting({ type: "vibe_session", paper_id: null }));
    expect((await loadDashboard(buildSb({ name: "L", role: "leader" }).sb)).showFindPaper).toBe(false);
  });

  it("shows no banners or links without an upcoming meeting", async () => {
    q.nextMeeting.mockResolvedValue(null);
    const data = await loadDashboard(buildSb({ name: "O", role: "operator" }).sb);
    expect(data).toMatchObject({
      meeting: null,
      showFindPaper: false,
      showSchedule: false,
      companionHref: null,
      availabilityStatus: null,
    });
  });

  it("shows Schedule to operators and admins during a reading-group prep only", async () => {
    q.nextMeeting.mockResolvedValue(meeting({ status: "prep" }));
    expect((await loadDashboard(buildSb({ name: "O", role: "operator" }).sb)).showSchedule).toBe(true);
    expect((await loadDashboard(buildSb({ name: "A", role: "admin" }).sb)).showSchedule).toBe(true);
    expect((await loadDashboard(buildSb({ name: "L", role: "leader" }).sb)).showSchedule).toBe(false);

    q.nextMeeting.mockResolvedValue(meeting({ status: "prep", type: "admin" }));
    expect((await loadDashboard(buildSb({ name: "O", role: "operator" }).sb)).showSchedule).toBe(false);
  });

  it("drops an unsafe companion link", async () => {
    q.nextMeeting.mockResolvedValue(meeting({ companion_url: "javascript:alert(1)" }));
    expect((await loadDashboard(buildSb({ name: "G", role: "member" }).sb)).companionHref).toBeNull();
  });

  it("skips the member lookup when signed out", async () => {
    const { sb, from } = buildSb(null);
    const data = await loadDashboard(sb);
    expect(data.firstName).toBeNull();
    expect(from).not.toHaveBeenCalled();
  });
});
