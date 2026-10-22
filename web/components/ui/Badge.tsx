import * as React from "react";

export type BadgeTone = "sage" | "magenta" | "warning" | "neutral";

export type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & {
  tone?: BadgeTone;
};

/** Pill label. Sage for roles and admin, magenta for the reading group, warning for pending states. */
export function Badge({ tone = "neutral", className = "", children, ...rest }: BadgeProps) {
  const cls = ["ui-badge", `ui-badge-${tone}`, className].filter(Boolean).join(" ");
  return (
    <span className={cls} {...rest}>
      {children}
    </span>
  );
}
