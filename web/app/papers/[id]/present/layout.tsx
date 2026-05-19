// Presenter is full-screen — no portal chrome, no max-width gutter.
import type { ReactNode } from "react";

export default function PresentLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
