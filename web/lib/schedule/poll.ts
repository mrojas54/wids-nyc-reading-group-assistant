// The availability poll as the operator sees it: which evenings are in play,
// who is free on each, and where the paper's leader stands. Pure and
// JSON-shaped on both sides so the server can load the raw rows and the
// client can derive every cell, count and name list from the SAME data —
// the cell's "7 free", the details card's "Free (7)" list and the leader
// check cannot disagree because they are all read off one CandidateDay.
import { daysInMonth, formatDayShort, parseDayKey, toDayKey } from "./format";

export type PollMember = { id: number; name: string };

/** One row per (member, evening) — availability.range_start collapsed to its NY day. */
export type PollResponse = { member_id: number; day: string };

export type PollInput = {
  /** The active roster, in display order. */
  members: PollMember[];
  responses: PollResponse[];
  /** meetings.leader_id, or null while no leader is picked. */
  leaderId: number | null;
  /** Days to drop from the poll even if marked — blackout windows. */
  excludedDays?: readonly string[];
};

/**
 * free    — the leader marked this evening.
 * busy    — the leader answered the poll but did not mark this evening.
 * unknown — no leader yet, or the leader has not answered; nothing to warn about.
 */
export type LeaderStatus = "free" | "busy" | "unknown";

export type AvailabilityTier = 0 | 1 | 2 | 3;

export type CandidateDay = {
  day: string;
  freeCount: number;
  freeNames: string[];
  /** Answered the poll, did not mark this evening. */
  busyNames: string[];
  leader: LeaderStatus;
  tier: AvailabilityTier;
};

export type Poll = {
  total: number;
  answered: number;
  unansweredNames: string[];
  leaderName: string | null;
  leaderAnswered: boolean;
  /** Sorted by day. Only evenings at least one member marked. */
  candidates: CandidateDay[];
};

/**
 * Heat tiers are absolute counts, as the design fixes them: the legend reads
 * "3 or fewer", "4 to 5", "6", "7 or more" whatever the roster size.
 */
export function availabilityTier(freeCount: number): AvailabilityTier {
  if (freeCount >= 7) return 3;
  if (freeCount >= 6) return 2;
  if (freeCount >= 4) return 1;
  return 0;
}

export function buildPoll(input: PollInput): Poll {
  const { members, responses, leaderId } = input;
  const excluded = new Set(input.excludedDays ?? []);
  const roster = new Map(members.map((m) => [m.id, m.name]));

  // Only active members count. A row from someone since removed from the
  // roster is dropped rather than counted as an anonymous "free".
  const freeByDay = new Map<string, Set<number>>();
  const answeredIds = new Set<number>();
  for (const r of responses) {
    if (!roster.has(r.member_id)) continue;
    answeredIds.add(r.member_id);
    if (excluded.has(r.day)) continue;
    let set = freeByDay.get(r.day);
    if (!set) {
      set = new Set();
      freeByDay.set(r.day, set);
    }
    set.add(r.member_id);
  }

  const leaderName = leaderId != null ? (roster.get(leaderId) ?? null) : null;
  const leaderAnswered = leaderId != null && answeredIds.has(leaderId);

  const candidates: CandidateDay[] = [...freeByDay.keys()].sort().map((day) => {
    const free = freeByDay.get(day)!;
    const freeNames: string[] = [];
    const busyNames: string[] = [];
    for (const m of members) {
      if (!answeredIds.has(m.id)) continue;
      (free.has(m.id) ? freeNames : busyNames).push(m.name);
    }
    const leader: LeaderStatus = !leaderAnswered
      ? "unknown"
      : free.has(leaderId!)
        ? "free"
        : "busy";
    return {
      day,
      freeCount: free.size,
      freeNames,
      busyNames,
      leader,
      tier: availabilityTier(free.size),
    };
  });

  return {
    total: members.length,
    answered: answeredIds.size,
    unansweredNames: members.filter((m) => !answeredIds.has(m.id)).map((m) => m.name),
    leaderName,
    leaderAnswered,
    candidates,
  };
}

/**
 * The evening the page opens on: the most-free evening the leader can make,
 * earliest wins a tie. Only when the leader is busy on every candidate does
 * the pick fall back to the most-free evening overall — the operator will see
 * the dashed border and the heads-up note either way.
 */
export function bestCandidate(poll: Poll): string | null {
  const preferred = poll.candidates.filter((c) => c.leader !== "busy");
  const pool = preferred.length > 0 ? preferred : poll.candidates;
  let best: CandidateDay | null = null;
  for (const c of pool) {
    // Candidates arrive sorted by day, so a strict ">" keeps the earliest of equals.
    if (!best || c.freeCount > best.freeCount) best = c;
  }
  return best?.day ?? null;
}

export type PollWindow = { start: string; end: string };

/**
 * The evenings members were offered: the /availability calendar runs from
 * the day the poll opened through the end of the FOLLOWING month
 * (MonthCalendar's endOfNextMonth). Stretched to cover any marked evening
 * outside that — a member who answered late saw a later window.
 */
export function pollWindowFrom(openedDay: string, candidateDays: readonly string[]): PollWindow {
  const opened = parseDayKey(openedDay);
  if (!opened) {
    const sorted = [...candidateDays].sort();
    return { start: sorted[0] ?? openedDay, end: sorted[sorted.length - 1] ?? openedDay };
  }
  const nextY = opened.m === 12 ? opened.y + 1 : opened.y;
  const nextM = opened.m === 12 ? 1 : opened.m + 1;
  let start = openedDay;
  let end = toDayKey({ y: nextY, m: nextM, d: daysInMonth(nextY, nextM) });
  for (const d of candidateDays) {
    if (d < start) start = d;
    if (d > end) end = d;
  }
  return { start, end };
}

export function findCandidate(poll: Poll, day: string | null): CandidateDay | null {
  if (day == null) return null;
  return poll.candidates.find((c) => c.day === day) ?? null;
}

/**
 * "Thu, Oct 15: 7 of 8 free, Maya who leads is not free, selected" — the
 * whole cell in one screen-reader sentence, in the order a sighted operator
 * scans it: when, how many, the leader caveat, the state.
 */
export function cellAriaLabel(
  c: CandidateDay,
  poll: Pick<Poll, "answered" | "leaderName">,
  selected: boolean,
): string {
  let label = `${formatDayShort(c.day)}: ${c.freeCount} of ${poll.answered} free`;
  if (c.leader === "busy" && poll.leaderName) {
    label += `, ${poll.leaderName} who leads is not free`;
  }
  if (selected) label += ", selected";
  return label;
}
