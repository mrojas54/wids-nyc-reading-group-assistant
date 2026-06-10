import type { ReactNode } from "react";
import Link from "next/link";
import { Brandmark } from "@/components/ui";
import LensDropdown from "@/components/paperpal/LensDropdown";

export default function PapersLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-paper-50 text-paper-800">
      <header
        className="border-b border-paper-200 bg-white/60"
        style={{ backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }}
      >
        <div className="mx-auto max-w-5xl px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Brandmark />
            <Link
              href="/papers"
              className="text-sm hover:underline text-sage-700"
            >
              Inbox
            </Link>
          </div>
          <div className="flex items-center gap-4">
            <LensDropdown />
            <Link
              href="/dashboard"
              className="text-sm hover:underline text-sage-700"
            >
              Dashboard
            </Link>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}
