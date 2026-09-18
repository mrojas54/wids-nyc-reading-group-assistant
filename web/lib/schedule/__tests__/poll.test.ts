import { describe, it, expect } from "vitest";
import {
  availabilityTier,
  bestCandidate,
  buildPoll,
  cellAriaLabel,
  findCandidate,
  pollWindowFrom,
} from "../poll";
import { CANDIDATE_DAYS, LEADER_ID, MEMBERS, OCT, RESPONSES } from "./fixture";

const poll = () => buildPoll({ members: MEMBERS, responses: RESPONSES, leaderId: LEADER_ID });

describe("availabilityTier", () => {
  it("uses the design's absolute thresholds: ≤3, 4–5, 6, ≥7", () => {
    expect(availabilityTier(0)).toBe(0);
    expect(availabilityTier(3)).toBe(0);
    expect(availabilityTier(4)).toBe(1);
    expect(availabilityTier(5)).toBe(1);
    expect(availabilityTier(6)).toBe(2);
    expect(availabilityTier(7)).toBe(3);
    expect(availabilityTier(8)).toBe(3);
    expect(availabilityTier(12)).toBe(3);
  });
});

describe("buildPoll", () => {
  it("counts answers against the active roster and names who is missing", () => {
    const p = poll();
    expect(p.total).toBe(10);
    expect(p.answered).toBe(8);
    expect(p.unansweredNames).toEqual(["Kim", "Lin"]);
    expect(p.leaderName).toBe("Maya");
    expect(p.leaderAnswered).toBe(true);
  });

  it("only evenings someone marked are candidates, sorted by day", () => {
    expect(poll().candidates.map((c) => c.day)).toEqual(CANDIDATE_DAYS);
  });

  it("reproduces the design's counts and tiers", () => {
    const p = poll();
    const by = Object.fromEntries(p.candidates.map((c) => [c.day, c]));
    expect(by[OCT(15)]).toMatchObject({ freeCount: 7, tier: 3, leader: "free" });
    expect(by[OCT(8)]).toMatchObject({ freeCount: 6, tier: 2, leader: "free" });
    expect(by[OCT(1)]).toMatchObject({ freeCount: 4, tier: 1, leader: "free" });
    expect(by[OCT(27)]).toMatchObject({ freeCount: 2, tier: 0, leader: "busy" });
  });

  it("marks the leader busy on evenings she answered but did not pick", () => {
    const by = Object.fromEntries(poll().candidates.map((c) => [c.day, c]));
    expect(by[OCT(6)]).toMatchObject({ freeCount: 5, leader: "busy" });
    expect(by[OCT(13)]).toMatchObject({ freeCount: 3, leader: "busy" });
    expect(by[OCT(20)]).toMatchObject({ freeCount: 5, leader: "busy" });
  });

  it("derives the free and not-free lists from the same rows as the count", () => {
    const p = poll();
    const answered = MEMBERS.filter((m) => !p.unansweredNames.includes(m.name)).map((m) => m.name);
    for (const c of p.candidates) {
      expect(c.freeNames).toHaveLength(c.freeCount);
      // Every answered member is in exactly one of the two lists, in roster order.
      expect([...c.freeNames, ...c.busyNames].sort()).toEqual([...answered].sort());
      expect(c.freeNames.includes("Maya")).toBe(c.leader === "free");
    }
    expect(p.candidates.find((c) => c.day === OCT(15))!.freeNames).toEqual([
      "Maya", "Priya", "Jules", "Anaïs", "Sofia", "Renée", "Tasha",
    ]);
    expect(p.candidates.find((c) => c.day === OCT(15))!.busyNames).toEqual(["Dana"]);
  });

  it("counts the leader like any other member — her answer is in the poll", () => {
    const withoutLeader = buildPoll({
      members: MEMBERS,
      responses: RESPONSES.filter((r) => r.member_id !== LEADER_ID),
      leaderId: LEADER_ID,
    });
    const oct15 = withoutLeader.candidates.find((c) => c.day === OCT(15))!;
    expect(oct15.freeCount).toBe(6); // 7 minus Maya
    expect(withoutLeader.answered).toBe(7);
  });

  it("reports the leader as unknown when she has not answered, never as busy", () => {
    const p = buildPoll({
      members: MEMBERS,
      responses: RESPONSES.filter((r) => r.member_id !== LEADER_ID),
      leaderId: LEADER_ID,
    });
    expect(p.leaderAnswered).toBe(false);
    expect(p.unansweredNames).toContain("Maya");
    expect(new Set(p.candidates.map((c) => c.leader))).toEqual(new Set(["unknown"]));
  });

  it("reports unknown when no leader is picked yet", () => {
    const p = buildPoll({ members: MEMBERS, responses: RESPONSES, leaderId: null });
    expect(p.leaderName).toBeNull();
    expect(p.candidates.every((c) => c.leader === "unknown")).toBe(true);
  });

  it("drops excluded (blacked-out) evenings but still counts those members as answered", () => {
    const p = buildPoll({
      members: MEMBERS,
      responses: RESPONSES,
      leaderId: LEADER_ID,
      excludedDays: [OCT(15), OCT(27)],
    });
    expect(p.candidates.map((c) => c.day)).not.toContain(OCT(15));
    expect(p.candidates.map((c) => c.day)).not.toContain(OCT(27));
    expect(p.answered).toBe(8); // Renée's only other day was 27 — still an answer
  });

  it("ignores rows from members no longer on the active roster", () => {
    const p = buildPoll({
      members: MEMBERS.filter((m) => m.name !== "Dana"),
      responses: RESPONSES,
      leaderId: LEADER_ID,
    });
    expect(p.total).toBe(9);
    expect(p.answered).toBe(7);
    expect(p.candidates.find((c) => c.day === OCT(27))!.freeCount).toBe(1);
  });
});

describe("bestCandidate — the evening the page opens on", () => {
  it("picks the most-free evening the leader can make", () => {
    expect(bestCandidate(poll())).toBe(OCT(15));
  });

  it("breaks ties toward the earliest evening", () => {
    const p = buildPoll({
      members: MEMBERS,
      responses: RESPONSES.filter((r) => r.day !== OCT(15)),
      leaderId: LEADER_ID,
    });
    // Oct 8, 22 and 29 are all 6-free with Maya free; Oct 8 comes first.
    expect(bestCandidate(p)).toBe(OCT(8));
  });

  it("skips a busier evening when the leader is not free that night", () => {
    // Oct 20 becomes everyone-but-Maya (7 of 8); Oct 15 drops to 6. The
    // busiest evening the leader CAN make is now a four-way tie at 6, so the
    // earliest of those (Oct 8) wins — never the leader-busy 7.
    const extra = [4, 6].map((id) => ({ member_id: id, day: OCT(20) }));
    const responses = [...RESPONSES, ...extra].filter(
      (r) => !(r.member_id === 6 && r.day === OCT(15)),
    );
    const p = buildPoll({ members: MEMBERS, responses, leaderId: LEADER_ID });
    const by = Object.fromEntries(p.candidates.map((c) => [c.day, c]));
    expect(by[OCT(20)]).toMatchObject({ freeCount: 7, leader: "busy" });
    expect(Math.max(...p.candidates.filter((c) => c.leader === "free").map((c) => c.freeCount))).toBe(6);
    expect(bestCandidate(p)).toBe(OCT(8));
  });

  it("falls back to the most-free evening overall when the leader is busy everywhere", () => {
    const p = buildPoll({
      members: MEMBERS,
      responses: RESPONSES.filter((r) => r.member_id !== LEADER_ID).concat([
        { member_id: LEADER_ID, day: OCT(30) },
      ]),
      leaderId: LEADER_ID,
      excludedDays: [OCT(30)],
    });
    expect(p.leaderAnswered).toBe(true);
    expect(p.candidates.every((c) => c.leader === "busy")).toBe(true);
    // Without Maya, Oct 8 / 15 / 22 / 29 tie at 6 (15 has Priya, Jules, Anaïs, Sofia, Renée, Tasha).
    expect(bestCandidate(p)).toBe(OCT(15));
  });

  it("returns null with nothing in the poll", () => {
    expect(bestCandidate(buildPoll({ members: MEMBERS, responses: [], leaderId: LEADER_ID }))).toBeNull();
  });
});

describe("pollWindowFrom — what members could pick from", () => {
  it("runs from the day the poll opened through the end of the following month", () => {
    expect(pollWindowFrom("2026-09-27", CANDIDATE_DAYS)).toEqual({ start: "2026-09-27", end: "2026-10-31" });
    expect(pollWindowFrom("2026-12-05", [])).toEqual({ start: "2026-12-05", end: "2027-01-31" });
  });
  it("stretches to cover a marked evening a late answerer saw", () => {
    expect(pollWindowFrom("2026-09-27", [...CANDIDATE_DAYS, "2026-11-03"])).toEqual({
      start: "2026-09-27",
      end: "2026-11-03",
    });
  });
});

describe("cellAriaLabel", () => {
  it("reads when, how many, the leader caveat and the state in that order", () => {
    const p = poll();
    expect(cellAriaLabel(findCandidate(p, OCT(15))!, p, true)).toBe(
      "Thu, Oct 15: 7 of 8 free, selected",
    );
    expect(cellAriaLabel(findCandidate(p, OCT(6))!, p, false)).toBe(
      "Tue, Oct 6: 5 of 8 free, Maya who leads is not free",
    );
    expect(cellAriaLabel(findCandidate(p, OCT(13))!, p, true)).toBe(
      "Tue, Oct 13: 3 of 8 free, Maya who leads is not free, selected",
    );
  });
});
