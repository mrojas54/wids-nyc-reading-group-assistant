import { describe, it, expect } from "vitest";
import { availabilityHref } from "../NextMeetingCard";

// The dashboard surfaces /availability via two CTAs (Vote / Change).
// Both must carry ?meeting=<id> so the portal can scope to the right paper
// instead of falling back to the "latest prep meeting" heuristic — otherwise
// a member viewing the dashboard for paper A could land on the portal for
// paper B if the cycle just rolled over.

describe("availabilityHref", () => {
  it("returns the bare /availability path when no prep meeting is known", () => {
    expect(availabilityHref(null)).toBe("/availability");
    expect(availabilityHref(undefined)).toBe("/availability");
  });

  it("scopes to the specific meeting id when provided", () => {
    expect(availabilityHref(42)).toBe("/availability?meeting=42");
  });

  it("treats 0 as 'no meeting' rather than building ?meeting=0", () => {
    // SERIAL ids start at 1; 0 is a sentinel that means 'falsy' here.
    // If we ever change the schema, this guard will flip and the test will
    // force an explicit decision.
    expect(availabilityHref(0)).toBe("/availability");
  });
});
