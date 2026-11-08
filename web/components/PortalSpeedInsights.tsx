"use client";

import { usePathname } from "next/navigation";
import { SpeedInsights } from "@vercel/speed-insights/next";

export function PortalSpeedInsights() {
  const path = usePathname();
  // The preview fixture forbids connections, including performance telemetry.
  if (path === "/preview/paperpal" || path?.startsWith("/preview/paperpal/")) return null;
  return <SpeedInsights />;
}
