import "./globals.css";
import type { Metadata } from "next";
import localFont from "next/font/local";

const geistSans = localFont({
  src: [{ path: "./fonts/GeistVF.woff", weight: "100 900", style: "normal" }],
  variable: "--font-sans",
  display: "swap",
});

const geistMono = localFont({
  src: [{ path: "./fonts/GeistMonoVF.woff", weight: "100 900", style: "normal" }],
  variable: "--font-mono",
  display: "swap",
});

const serifFallback = localFont({
  src: [{ path: "./fonts/GeistVF.woff", weight: "100 900", style: "normal" }],
  variable: "--font-newsreader",
  display: "swap",
});

export const metadata: Metadata = {
  title: "WiDS NYC AI Reading Group",
  description: "Member portal",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${serifFallback.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
