import { Badge } from "./Badge";

export type MeetingType = "reading_group" | "admin";

const LABEL: Record<MeetingType, string> = {
  reading_group: "Reading group",
  admin: "Admin",
};

// Magenta is the group's voice: the reading-group badge is one of the few
// places it is allowed (design system, Color). Admin meetings stay in sage.
export function MeetingTypeBadge({ type }: { type: MeetingType }) {
  return <Badge tone={type === "reading_group" ? "magenta" : "sage"}>{LABEL[type]}</Badge>;
}
