import * as React from "react";

type Variant = "default" | "hero";

export type CardProps = React.HTMLAttributes<HTMLElement> & {
  /**
   * `default` — border-1 + shadow-sm, radius-lg. The everyday surface.
   * `hero` — no border, shadow-md, radius-xl. One per page at most.
   */
  variant?: Variant;
};

// Classes are `ui-card*` rather than the bare `card` a few older components
// hang inline styles off, so defining a real surface here restyles nothing
// that already ships.
export function Card({ variant = "default", className = "", children, ...rest }: CardProps) {
  const cls = ["ui-card", variant === "hero" && "ui-card-hero", className]
    .filter(Boolean)
    .join(" ");
  return (
    <section className={cls} {...rest}>
      {children}
    </section>
  );
}

export function CardHeader({ children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className="ui-card-header" {...rest}>
      {children}
    </div>
  );
}

export function CardBody({ children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className="ui-card-body" {...rest}>
      {children}
    </div>
  );
}

export function CardFooter({ children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className="ui-card-footer" {...rest}>
      {children}
    </div>
  );
}
