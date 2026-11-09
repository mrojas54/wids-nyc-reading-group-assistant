// Unit tests for resolvePapers, the work behind POST /api/admin/resolve-papers.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { S2AuthError } from "@/lib/suggest/types";
import { resolvePapers } from "@/lib/suggest/resolve-papers";
import { call, fail, fakeSupabase, ok, type Query, type Response } from "@/lib/schedule/__tests__/fakeSupabase";

const arxiv = vi.hoisted(() => ({ fetchArxivBatch: vi.fn() }));
vi.mock("@/lib/suggest/resolve-helpers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/suggest/resolve-helpers")>()),
  fetchArxivBatch: arxiv.fetchArxivBatch,
}));

const S2 = "https://api.semanticscholar.org/graph/v1";
const server = setupServer();
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

beforeEach(() => {
  arxiv.fetchArxivBatch.mockReset().mockResolvedValue(new Map());
});

const row = (id: number, s2: string | null, title = `T${id}`) => ({
  id,
  s2_paper_id: s2,
  title,
  abstract: `A${id}`,
});

/** Lookup answers with `existing`; the upsert echoes its rows back with new ids. */
function db(existing: ReturnType<typeof row>[], upsertError?: string) {
  return fakeSupabase((q: Query): Response => {
    const upsert = call(q, "upsert");
    if (upsert) {
      if (upsertError) return fail(upsertError);
      const rows = upsert[0] as Array<{ s2_paper_id: string; title: string; abstract: string }>;
      return ok(rows.map((r, i) => ({ id: 100 + i, ...r })));
    }
    return ok(existing);
  });
}

const asClient = (c: unknown) => c as SupabaseClient<Database>;

describe("resolvePapers", () => {
  it("reports when no input parses as a paper id", async () => {
    const { client, queries } = db([]);
    const r = await resolvePapers(asClient(client), ["not a paper", "javascript:alert(1)"], null);
    expect(r).toEqual({ kind: "no_valid_urls" });
    expect(queries).toEqual([]);
  });

  it("returns existing papers in input order, once each", async () => {
    const { client, queries } = db([row(2, "DOI:10.1234/b"), row(1, "ARXIV:1706.03762")]);
    const r = await resolvePapers(
      asClient(client),
      ["https://arxiv.org/abs/1706.03762", "doi:10.1234/b", "1706.03762", "nonsense"],
      "key",
    );
    expect(r).toEqual({
      kind: "resolved",
      resolved: [
        { id: 1, s2_paper_id: "ARXIV:1706.03762", title: "T1", abstract: "A1" },
        { id: 2, s2_paper_id: "DOI:10.1234/b", title: "T2", abstract: "A2" },
      ],
    });
    expect(call(queries[0], "in")).toEqual(["s2_paper_id", ["ARXIV:1706.03762", "DOI:10.1234/b"]]);
    expect(queries).toHaveLength(1);
  });

  it("creates missing papers from S2, sending the API key", async () => {
    let seenKey: string | null = null;
    server.use(
      http.get(`${S2}/paper/:id`, ({ request }) => {
        seenKey = request.headers.get("x-api-key");
        return HttpResponse.json({ paperId: "DOI:10.1234/new", title: "", abstract: "Abs" });
      }),
    );
    const { client, queries } = db([]);
    const r = await resolvePapers(asClient(client), ["10.1234/new"], "key");
    expect(seenKey).toBe("key");
    expect(call(queries[1], "upsert")).toEqual([
      [{ s2_paper_id: "DOI:10.1234/new", title: "(untitled)", abstract: "Abs" }],
      { onConflict: "s2_paper_id" },
    ]);
    expect(r).toEqual({
      kind: "resolved",
      resolved: [{ id: 100, s2_paper_id: "DOI:10.1234/new", title: "(untitled)", abstract: "Abs" }],
    });
  });

  it("falls back to arXiv for arXiv ids S2 doesn't have, and drops the rest", async () => {
    server.use(http.get(`${S2}/paper/:id`, () => new HttpResponse(null, { status: 404 })));
    arxiv.fetchArxivBatch.mockResolvedValue(
      new Map([["ARXIV:2401.00001", { paperId: "ARXIV:2401.00001", title: "From arXiv", abstract: "X" }]]),
    );
    const { client } = db([]);
    const r = await resolvePapers(asClient(client), ["2401.00001", "10.1234/gone"], null);
    expect(arxiv.fetchArxivBatch).toHaveBeenCalledWith(["ARXIV:2401.00001"]);
    expect(r).toEqual({
      kind: "resolved",
      resolved: [{ id: 100, s2_paper_id: "ARXIV:2401.00001", title: "From arXiv", abstract: "X" }],
    });
  });

  it("skips the upsert when nothing new was found", async () => {
    server.use(http.get(`${S2}/paper/:id`, () => new HttpResponse(null, { status: 404 })));
    const { client, queries } = db([]);
    const r = await resolvePapers(asClient(client), ["10.1234/gone"], null);
    expect(r).toEqual({ kind: "resolved", resolved: [] });
    expect(queries).toHaveLength(1);
    expect(arxiv.fetchArxivBatch).not.toHaveBeenCalled();
  });

  it("drops a row whose s2_paper_id is null", async () => {
    server.use(http.get(`${S2}/paper/:id`, () => new HttpResponse(null, { status: 404 })));
    const { client } = db([row(5, null)]);
    const r = await resolvePapers(asClient(client), ["10.1234/x"], null);
    expect(r).toEqual({ kind: "resolved", resolved: [] });
  });

  it("surfaces an S2 auth failure and database errors", async () => {
    server.use(http.get(`${S2}/paper/:id`, () => new HttpResponse(null, { status: 403 })));
    await expect(resolvePapers(asClient(db([]).client), ["10.1234/x"], "bad")).rejects.toBeInstanceOf(S2AuthError);

    server.use(http.get(`${S2}/paper/:id`, () => HttpResponse.json({ paperId: "DOI:10.1234/x", title: "T", abstract: "" })));
    await expect(
      resolvePapers(asClient(db([], "upsert failed").client), ["10.1234/x"], null),
    ).rejects.toMatchObject({ message: "upsert failed" });

    const lookupFails = fakeSupabase(() => fail("lookup failed"));
    await expect(resolvePapers(asClient(lookupFails.client), ["10.1234/x"], null)).rejects.toMatchObject({
      message: "lookup failed",
    });
  });
});
