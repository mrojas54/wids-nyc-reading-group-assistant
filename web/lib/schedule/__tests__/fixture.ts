// The design canvas's sample poll ("Schedule the next meeting", October
// 2026): ten members, eight answers, Maya leads. Lives only here — the page
// renders real rows — so tests can pin the exact counts the design was
// drawn with: Oct 15 is the best evening (7 of 8, leader free), Oct 6 is a
// leader-busy 5, Oct 13 a leader-busy 3.
import type { PollMember, PollResponse } from "../poll";

export const OCT = (d: number) => `2026-10-${String(d).padStart(2, "0")}`;

const SAMPLE: Array<{ id: number; name: string; free: number[] }> = [
  { id: 1, name: "Maya", free: [1, 8, 15, 22, 29] },
  { id: 2, name: "Priya", free: [6, 8, 13, 15, 20, 22] },
  { id: 3, name: "Jules", free: [1, 6, 15, 20, 29] },
  { id: 4, name: "Anaïs", free: [8, 15, 22, 29] },
  { id: 5, name: "Sofia", free: [1, 6, 8, 15, 20, 22, 29] },
  { id: 6, name: "Renée", free: [15, 22, 27] },
  { id: 7, name: "Tasha", free: [1, 6, 8, 13, 15, 20, 29] },
  { id: 8, name: "Dana", free: [6, 8, 13, 20, 22, 27, 29] },
  { id: 9, name: "Kim", free: [] },
  { id: 10, name: "Lin", free: [] },
];

export const LEADER_ID = 1; // Maya

export const MEMBERS: PollMember[] = SAMPLE.map(({ id, name }) => ({ id, name }));

export const RESPONSES: PollResponse[] = SAMPLE.flatMap((m) =>
  m.free.map((d) => ({ member_id: m.id, day: OCT(d) })),
);

export const CANDIDATE_DAYS = [1, 6, 8, 13, 15, 20, 22, 27, 29].map(OCT);
