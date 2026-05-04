import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "WiDS NYC AI Reading Group",
  description: "Member portal",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-zinc-50 text-zinc-900 antialiased">
        <main className="mx-auto max-w-2xl p-4 sm:p-6">{children}</main>
      </body>
    </html>
  );
}
