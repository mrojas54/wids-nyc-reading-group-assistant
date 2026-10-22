import { Badge } from "./Badge";

export type MeetingType = "reading_group" | "admin" | "vibe_session";

const LABEL: Record<MeetingType, string> = {
  reading_group: "Reading group",
  admin: "Admin",
  vibe_session: "Vibe session",
};

const TONE: Record<MeetingType, "magenta" | "sage" | "neutral"> = {
  reading_group: "magenta",
  admin: "sage",
  vibe_session: "neutral",
};

// Magenta is the group's voice: the reading-group badge is one of the few
// places it is allowed (design system, Color). Admin meetings stay in sage;
// vibe sessions get neutral so they don't read as either bureaucratic or
// paper-discussion business.
export function MeetingTypeBadge({ type }: { type: MeetingType }) {
  return <Badge tone={TONE[type]}>{LABEL[type]}</Badge>;
}
