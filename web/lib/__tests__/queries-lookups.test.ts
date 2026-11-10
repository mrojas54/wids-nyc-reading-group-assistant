// Tests for the two single-row lookups in lib/queries that had none:
// paperCatalogRow (papers.ts) and myRsvp (member.ts).
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { myRsvp, paperCatalogRow } from "@/lib/queries";
import { call, fail, fakeSupabase, ok, type Query, type Response } from "../schedule/__tests__/fakeSupabase";

afterEach(() => vi.restoreAllMocks());

function client(respond: (q: Query) => Response) {
  const fake = fakeSupabase(respond);
  return { sb: fake.client as unknown as SupabaseClient<Database>, queries: fake.queries };
}

describe("paperCatalogRow", () => {
  it("returns the paper with the leader of its most recent meeting", async () => {
    const { sb, queries } = client((q) =>
      q.table === "papers"
        ? ok({ id: 41, title: "Misery", authors: ["Ladner", "Althoff"] })
        : ok({ members: { name: "Michelle Rojas" } }),
    );
    expect(await paperCatalogRow(sb, 41)).toEqual({
      id: 41,
      title: "Misery",
      authors: ["Ladner", "Althoff"],
      leader_name: "Michelle Rojas",
    });
    const meeting = queries.find((q) => q.table === "meetings");
    expect(call(meeting, "eq")).toEqual(["paper_id", 41]);
    expect(call(meeting, "order")).toEqual([
      "scheduled_at",
      { ascending: false, nullsFirst: false },
    ]);
  });

  it("returns null without a meeting lookup when the paper does not exist", async () => {
    const { sb, queries } = client(() => ok(null));
    expect(await paperCatalogRow(sb, 999)).toBeNull();
    expect(queries.map((q) => q.table)).toEqual(["papers"]);
  });

  it("leaves leader and authors null when there is no meeting or author list", async () => {
    const { sb } = client((q) =>
      q.table === "papers" ? ok({ id: 7, title: "T", authors: null }) : ok(null),
    );
    expect(await paperCatalogRow(sb, 7)).toEqual({
      id: 7,
      title: "T",
      authors: null,
      leader_name: null,
    });
  });

  it("logs a failed paper query and returns null", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { sb } = client(() => fail("permission denied"));
    expect(await paperCatalogRow(sb, 7)).toBeNull();
    expect(log.mock.calls[0][0]).toContain('"fn":"paperCatalogRow.paper"');
  });
});

describe("myRsvp", () => {
  it("returns the caller's RSVP for the meeting", async () => {
    const { sb, queries } = client(() => ok({ rsvp_status: "tentative" }));
    expect(await myRsvp(sb, 12)).toBe("tentative");
    expect(queries[0].table).toBe("meeting_attendance");
    expect(call(queries[0], "eq")).toEqual(["meeting_id", 12]);
  });

  it("returns null when the caller has not answered", async () => {
    const { sb } = client(() => ok(null));
    expect(await myRsvp(sb, 12)).toBeNull();
  });
});
