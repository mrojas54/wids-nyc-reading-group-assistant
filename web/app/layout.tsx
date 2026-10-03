import "./globals.css";
import type { Metadata } from "next";
import localFont from "next/font/local";

// Bundled (latin subset, from @fontsource/newsreader) so builds don't depend on
// the Google Fonts loader.
const newsreader = localFont({
  src: [
    { path: "./fonts/newsreader/newsreader-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/newsreader/newsreader-latin-400-italic.woff2", weight: "400", style: "italic" },
    { path: "./fonts/newsreader/newsreader-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/newsreader/newsreader-latin-500-italic.woff2", weight: "500", style: "italic" },
    { path: "./fonts/newsreader/newsreader-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./fonts/newsreader/newsreader-latin-600-italic.woff2", weight: "600", style: "italic" },
  ],
  variable: "--font-newsreader",
  display: "swap",
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
