import type { ReactNode } from "react";
import { Brandmark } from "@/components/ui";

export default function PapersLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[var(--color-paper-50)] text-[var(--color-paper-800)]">
      <header
        className="border-b border-[var(--color-paper-200)] bg-white/60"
        style={{ backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }}
      >
        <div className="mx-auto max-w-3xl px-4 py-3 flex items-center justify-between">
          <Brandmark />
          <a
            href="/"
            className="text-sm hover:underline text-[var(--color-sage-700)]"
          >
            Sign in
          </a>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8">{children}</main>
    </div>
  );
}
