// Inline SVG icons for /admin/logs — 1.5px stroke, currentColor, Lucide-derived.
// Matches the design system's "no icon library, inline SVG" rule.
import type { CSSProperties, ReactNode } from "react";
import type { LogSource } from "@/lib/logs";

type IconProps = { size?: number; sw?: number; style?: CSSProperties };

function OIcon({ size = 16, sw = 1.5, children, style }: IconProps & { children: ReactNode }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={style}
    >
      {children}
    </svg>
  );
}

export const IconCheckCircle = (p: IconProps) => (
  <OIcon {...p}><circle cx="12" cy="12" r="9" /><path d="m8.5 12 2.5 2.5 4.5-5" /></OIcon>
);
export const IconDot = ({ size = 14, color = "currentColor" }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="5" fill={color} /></svg>
);
export const IconTriangle = (p: IconProps) => (
  <OIcon {...p}><path d="M12 4.5 21 19H3z" /><path d="M12 10v4" /><path d="M12 16.5h.01" /></OIcon>
);
export const IconAlert = (p: IconProps) => (
  <OIcon {...p}><circle cx="12" cy="12" r="9" /><path d="M12 8v4.5" /><path d="M12 16h.01" /></OIcon>
);
export const IconArrowRight = (p: IconProps) => (
  <OIcon {...p}><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></OIcon>
);
export const IconSearch = (p: IconProps) => (
  <OIcon {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.2-3.2" /></OIcon>
);
export const IconChevDown = (p: IconProps) => (
  <OIcon {...p}><path d="m6 9 6 6 6-6" /></OIcon>
);
export const IconChevRight = (p: IconProps) => (
  <OIcon {...p}><path d="m9 6 6 6-6 6" /></OIcon>
);
export const IconCopy = (p: IconProps) => (
  <OIcon {...p}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h8" /></OIcon>
);
export const IconRefresh = (p: IconProps) => (
  <OIcon {...p}><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 4v5h-5" /></OIcon>
);
export const IconInbox = (p: IconProps) => (
  <OIcon {...p}><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.5 6h13l3.5 6v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z" /></OIcon>
);

// source-type icons
const IconServerAction = (p: IconProps) => (
  <OIcon {...p}><rect x="3" y="4" width="18" height="7" rx="1.6" /><rect x="3" y="13" width="18" height="7" rx="1.6" /><path d="M7 7.5h.01M7 16.5h.01" /></OIcon>
);
const IconEdgeFunction = (p: IconProps) => (
  <OIcon {...p}><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18" /></OIcon>
);
const IconScheduled = (p: IconProps) => (
  <OIcon {...p}><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 1.5" /><path d="M9 2h6" /></OIcon>
);
const IconSlash = (p: IconProps) => (
  <OIcon {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m8 9 3 3-3 3" /><path d="M13 15h3" /></OIcon>
);

export const SOURCE_META: Record<LogSource, { label: string; short: string; Icon: (p: IconProps) => ReactNode }> = {
  server_action: { label: "server_action", short: "Server action", Icon: IconServerAction },
  edge_function: { label: "edge_function", short: "Edge function", Icon: IconEdgeFunction },
  scheduled_task: { label: "scheduled_task", short: "Scheduled task", Icon: IconScheduled },
  slash_command: { label: "slash_command", short: "Slash command", Icon: IconSlash },
};
