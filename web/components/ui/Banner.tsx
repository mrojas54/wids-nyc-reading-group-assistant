import * as React from "react";

type Tone = "info" | "warning" | "success" | "danger";

export type BannerProps = {
  tone?: Tone;
  title?: React.ReactNode;
  children?: React.ReactNode;
  /** A trailing control — a small secondary Button, typically. */
  action?: React.ReactNode;
};

export function Banner({ tone = "info", title, children, action }: BannerProps) {
  return (
    <div className={`banner banner-${tone}`} role="status">
      <div style={{ flex: 1 }}>
        {title && <strong className="banner-title">{title}</strong>}
        {children}
      </div>
      {action && <div className="banner-action">{action}</div>}
    </div>
  );
}
