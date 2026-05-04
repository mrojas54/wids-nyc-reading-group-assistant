import * as React from "react";

type Tone = "info" | "warning" | "success" | "danger";

export type BannerProps = {
  tone?: Tone;
  title?: React.ReactNode;
  children?: React.ReactNode;
};

export function Banner({ tone = "info", title, children }: BannerProps) {
  return (
    <div className={`banner banner-${tone}`} role="status">
      <div style={{ flex: 1 }}>
        {title && <b>{title}</b>}
        {children}
      </div>
    </div>
  );
}
