import { describe, it, expect, vi, beforeEach } from "vitest";

// Capture the row handed to command_log.insert() so we can assert on the exact
// columns logServerAction writes. The service client is the only dependency.
let inserted: Record<string, unknown> | undefined;
vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => ({
    from: (_table: string) => ({
      insert: (row: Record<string, unknown>) => {
        inserted = row;
        return Promise.resolve({ error: null });
      },
    }),
  }),
}));

import { logServerAction } from "../log";

beforeEach(() => {
  inserted = undefined;
});

describe("logServerAction", () => {
  it("writes the core fields with source=server_action", async () => {
    await logServerAction("submitAvailability", "success", "ok");
    expect(inserted).toMatchObject({
      source: "server_action",
      name: "submitAvailability",
      status: "success",
      summary: "ok",
    });
  });

  it("populates the migration-020 enrichment columns when provided", async () => {
    await logServerAction("setRsvp", "success", "done", undefined, {
      durationMs: 42,
      actor: "alice@example.com",
      idempotencyKey: "setRsvp:meeting=7:member=3",
      metadata: { meetingId: 7, memberId: 3 },
    });
    expect(inserted).toMatchObject({
      duration_ms: 42,
      actor: "alice@example.com",
      idempotency_key: "setRsvp:meeting=7:member=3",
      metadata: { meetingId: 7, memberId: 3 },
    });
  });

  it("omits enrichment columns when no extra is passed", async () => {
    await logServerAction("signOut", "success");
    const keys = Object.keys(inserted ?? {});
    expect(keys).not.toContain("duration_ms");
    expect(keys).not.toContain("actor");
    expect(keys).not.toContain("idempotency_key");
    expect(keys).not.toContain("metadata");
  });
});
