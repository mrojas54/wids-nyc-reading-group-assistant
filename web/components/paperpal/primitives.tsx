"use client";

import type { CSSProperties, ReactNode } from "react";

// ---------- Eyebrow ----------
// Small uppercase mono label used above tile titles and section heads.

export type EyebrowTone = "muted" | "brand" | "accent" | "indigo" | "on-dark";

export function Eyebrow({
  tone = "muted",
  dot,
  children,
}: {
  tone?: EyebrowTone;
  dot?: boolean;
  children: ReactNode;
}) {
  const dotBg =
    tone === "accent"
      ? "var(--accent)"
      : tone === "indigo"
        ? "var(--color-indigo-700)"
        : "var(--color-sage-500)";
  return (
    <span className={`pp-eyebrow pp-eyebrow-${tone}`}>
      {dot && (
        <span
          aria-hidden
          className="pp-eyebrow-dot"
          style={{ background: dotBg }}
        />
      )}
      {children}
    </span>
  );
}

// ---------- Badge ----------

export type BadgeTone =
  | "neutral"
  | "sage"
  | "magenta"
  | "indigo"
  | "success"
  | "warning"
  | "info";

const BADGE_STYLES: Record<BadgeTone, { bg: string; fg: string; bd: string }> = {
  neutral: {
    bg: "var(--color-paper-100)",
    fg: "var(--color-paper-700)",
    bd: "var(--color-paper-300)",
  },
  sage: {
    bg: "var(--color-sage-50)",
    fg: "var(--color-sage-800)",
    bd: "var(--color-sage-200)",
  },
  magenta: {
    bg: "var(--color-magenta-50)",
    fg: "var(--color-magenta-700)",
    bd: "var(--color-magenta-200)",
  },
  indigo: {
    bg: "var(--color-indigo-100)",
    fg: "var(--color-indigo-700)",
    bd: "rgba(126,139,198,0.4)",
  },
  success: {
    bg: "var(--color-success-50)",
    fg: "var(--color-success-700)",
    bd: "#9ed1ad",
  },
  warning: {
    bg: "var(--color-warning-50)",
    fg: "var(--color-warning-700)",
    bd: "#e0c084",
  },
  info: {
    bg: "var(--color-info-50)",
    fg: "var(--color-info-700)",
    bd: "#9bbedf",
  },
};

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: BadgeTone;
  children: ReactNode;
}) {
  const s = BADGE_STYLES[tone];
  return (
    <span
      className="pp-badge"
      style={{
        background: s.bg,
        color: s.fg,
        borderColor: s.bd,
      }}
    >
      {children}
    </span>
  );
}

// ---------- Tooltip ----------
// Positioned absolutely at viewport coords; clamps to keep it on-screen.

export function Tooltip({
  x,
  y,
  kind,
  visible,
  children,
}: {
  x: number;
  y: number;
  kind?: "" | "mvar";
  visible: boolean;
  children: ReactNode;
}) {
  if (!visible) return null;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
  const vh = typeof window !== "undefined" ? window.innerHeight : 768;
  const style: CSSProperties = {
    position: "fixed",
    left: Math.min(vw - 420, x + 16),
    top: Math.min(vh - 320, y + 18),
    zIndex: 1000,
  };
  return (
    <div className={`pp-tooltip ${kind || ""}`} style={style} role="tooltip">
      {children}
    </div>
  );
}

// ---------- Tile ----------
// Standard bento card shell. Composes a header (icon + title + count) and body.

export function Tile({
  id,
  className = "",
  children,
  style,
}: {
  id?: string;
  className?: string;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div id={id} className={`pp-tile ${className}`.trim()} style={style}>
      {children}
    </div>
  );
}

export function TileHeader({
  title,
  count,
  accent = false,
  right,
}: {
  title: ReactNode;
  count?: ReactNode;
  accent?: boolean;
  right?: ReactNode;
}) {
  return (
    <div className="pp-tile-header">
      <div className="pp-tile-title">
        <h3
          style={{
            color: accent ? "var(--accent-fg)" : "var(--fg-1)",
          }}
        >
          {title}
        </h3>
      </div>
      <div className="pp-tile-header-right">
        {right}
        {count != null && (
          <span
            className="pp-tile-count"
            style={
              accent
                ? {
                    color: "var(--accent-fg)",
                    background: "var(--color-magenta-50)",
                    borderColor: "var(--color-magenta-200)",
                  }
                : undefined
            }
          >
            {count}
          </span>
        )}
      </div>
    </div>
  );
}

// ---------- PaperPalMark ----------
// Simplified product mark — open book with a circuit trace. Use sparingly.

export function PaperPalMark({
  size = 26,
  color = "currentColor",
}: {
  size?: number;
  color?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden
    >
      <path
        d="M5 9c4 0 7 1.5 11 4 4-2.5 7-4 11-4v18c-4 0-7 1.5-11 4-4-2.5-7-4-11-4z"
        stroke={color}
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M16 13v18"
        stroke={color}
        strokeWidth="1.4"
        strokeOpacity=".55"
      />
      <circle cx="22" cy="6" r="1.4" fill={color} />
      <path
        d="M22 7.5v3.5l-3 2"
        stroke={color}
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <circle cx="19" cy="13" r="1.1" fill={color} />
      <path
        d="M10 6.5 13 9"
        stroke={color}
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <circle cx="10" cy="5.5" r="1.1" fill={color} />
    </svg>
  );
}
