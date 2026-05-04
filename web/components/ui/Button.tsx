import * as React from "react";
import { Icon, type IconName } from "./Icon";

type Variant = "primary" | "secondary" | "ghost" | "destructive";

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: "sm" | "md";
  block?: boolean;
  iconLeft?: IconName;
  iconRight?: IconName;
};

export function Button({
  variant = "primary",
  size = "md",
  block = false,
  iconLeft,
  iconRight,
  className = "",
  children,
  ...rest
}: ButtonProps) {
  const cls = [
    "btn",
    `btn-${variant}`,
    size === "sm" && "btn-sm",
    block && "btn-block",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button className={cls} {...rest}>
      {iconLeft && <Icon name={iconLeft} size={16} />}
      {children}
      {iconRight && <Icon name={iconRight} size={16} />}
    </button>
  );
}
