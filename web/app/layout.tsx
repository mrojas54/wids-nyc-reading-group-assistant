import "./globals.css";
import type { Metadata } from "next";
import { Newsreader } from "next/font/google";

const newsreader = Newsreader({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--font-newsreader",
  display: "swap",
  // Newsreader isn't in next/font's static metric-override table (Next 14.2.x),
  // so the CLS-prevention fallback pass logs `Failed to find font override
  // values for font Newsreader`. Opting out silences the warning; the trade-off
  // is a brief CLS on first paint, mitigated by `display: swap` already.
  adjustFontFallback: false,
});

export const metadata: Metadata = {
  title: "WiDS NYC AI Reading Group",
  description: "Member portal",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={newsreader.variable}>
      <body>{children}</body>
    </html>
  );
}
