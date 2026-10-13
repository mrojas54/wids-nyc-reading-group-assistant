import { afterEach, describe, expect, it, vi } from "vitest";
import nextConfig from "../../../next.config.mjs";
import { formatMeetingTime } from "../meeting-time";

afterEach(() => vi.unstubAllEnvs());

describe("production Paper Pal routing", () => {
  it("routes only the tutor and hint endpoints to the configured Supabase project", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    expect(await nextConfig.rewrites!()).toEqual([
      { source: "/functions/v1/analyze-hint", destination: "https://example.supabase.co/functions/v1/analyze-hint" },
      { source: "/functions/v1/analyze-socratic", destination: "https://example.supabase.co/functions/v1/analyze-socratic" },
    ]);
  });
});

describe("Eastern meeting labels", () => {
  it("shows October's 23:00 UTC meeting at 7 PM EDT", () => {
    expect(formatMeetingTime("2026-10-28T23:00:00Z")).toBe("Wed, Oct 28, 7:00 PM EDT");
  });
  it("uses EST in winter and the Eastern calendar day across midnight UTC", () => {
    expect(formatMeetingTime("2026-01-29T00:00:00Z")).toBe("Wed, Jan 28, 7:00 PM EST");
  });
});
