// backfillBatch: which papers it picks, how S2 results split between the cache
// and WASM, and what it reports back.
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { backfillBatch, type BackfillDeps } from "../backfill";
import type { S2Result } from "../types";
import { call, fail, fakeSupabase, ok, type Query } from "../../schedule/__tests__/fakeSupabase";

type Paper = { id: number; s2_paper_id: string | null; title: string | null; abstract: string | null };

function db(papers: Paper[], embeddedIds: number[] = [], papersError?: string) {
  const fake = fakeSupabase((q: Query) => {
    if (q.table === "papers") return papersError ? fail(papersError) : ok(papers);
    return ok(embeddedIds.map(paper_id => ({ paper_id })));
  });
  return { client: fake.client as unknown as SupabaseClient<Database>, queries: fake.queries };
}

const vec = (n: number) => Float32Array.from([n, n]);
const hit = (id: string): S2Result => ({ kind: "hit", paperId: id, vector: vec(1), title: "", abstract: "" });
const fallback = (
  id: string,
  reason: Extract<S2Result, { kind: "fallback_needed" }>["reason"],
  title = "",
): S2Result => ({ kind: "fallback_needed", paperId: id, reason, title, abstract: "" });

function deps(results: Record<string, S2Result>): BackfillDeps & {
  fetchPaperWithEmbedding: ReturnType<typeof vi.fn>;
  embedBatch: ReturnType<typeof vi.fn>;
  cacheMany: ReturnType<typeof vi.fn>;
} {
  return {
    fetchPaperWithEmbedding: vi.fn(async (s2Id: string) => results[s2Id]),
    embedBatch: vi.fn(async (items: unknown[]) => items.map((_, i) => vec(10 + i))),
    cacheMany: vi.fn(async () => {}),
  };
}

const paper = (id: number, title = `T${id}`): Paper => ({
  id,
  s2_paper_id: `S${id}`,
  title,
  abstract: `A${id}`,
});

describe("backfillBatch", () => {
  it("reports nothing to do, without a breakdown, when every paper is embedded", async () => {
    const { client } = db([paper(1), paper(2)], [1, 2]);
    const d = deps({});
    const { result, batchSize } = await backfillBatch(client, 10, null, d);
    expect(result).toEqual({ embedded: 0, remaining: 0, total_eligible: 2 });
    expect(batchSize).toBe(0);
    expect(d.fetchPaperWithEmbedding).not.toHaveBeenCalled();
  });

  it("asks for papers with an S2 id and for specter_v2 embeddings only", async () => {
    const { client, queries } = db([], []);
    await backfillBatch(client, 10, null, deps({}));
    const papers = queries.find(q => q.table === "papers");
    expect(call(papers, "not")).toEqual(["s2_paper_id", "is", null]);
    expect(call(papers, "order")).toEqual(["id", { ascending: true }]);
    expect(call(queries.find(q => q.table === "paper_embeddings"), "eq")).toEqual(["model", "specter_v2"]);
  });

  it("embeds only the first batch of missing papers and counts the rest", async () => {
    const { client } = db([paper(1), paper(2), paper(3), paper(4)], [2]);
    const d = deps({ S1: hit("S1"), S3: hit("S3"), S4: hit("S4") });
    const { result, batchSize } = await backfillBatch(client, 2, "key", d);
    expect(d.fetchPaperWithEmbedding.mock.calls).toEqual([["S1", "key"], ["S3", "key"]]);
    expect(result).toMatchObject({ embedded: 2, remaining: 1, total_eligible: 4 });
    expect(batchSize).toBe(2);
  });

  it("caches S2 hits directly and sends every fallback reason to WASM", async () => {
    const { client } = db([paper(1), paper(2), paper(3), paper(4), paper(5)]);
    const d = deps({
      S1: hit("S1"),
      S2: fallback("S2", "rate_limited", "S2 title"),
      S3: fallback("S3", "no_embedding"),
      S4: fallback("S4", "not_in_corpus"),
      S5: fallback("S5", "s2_transient"),
    });
    const { result } = await backfillBatch(client, 10, null, d);

    expect(result.breakdown).toEqual({
      s2_hits: 1,
      wasm_embedded: 4,
      s2_rate_limited: 1,
      s2_no_embedding: 1,
      s2_not_in_corpus: 1,
      s2_transient: 1,
    });
    // S2's title wins when it has one; otherwise the paper row's.
    expect(d.embedBatch).toHaveBeenCalledWith([
      { title: "S2 title", abstract: "A2" },
      { title: "T3", abstract: "A3" },
      { title: "T4", abstract: "A4" },
      { title: "T5", abstract: "A5" },
    ]);
    expect(d.cacheMany).toHaveBeenCalledWith(client, [
      { paperId: 1, vector: vec(1) },
      { paperId: 2, vector: vec(10) },
      { paperId: 3, vector: vec(11) },
      { paperId: 4, vector: vec(12) },
      { paperId: 5, vector: vec(13) },
    ]);
    expect(result.embedded).toBe(5);
  });

  it("skips WASM when S2 had every embedding", async () => {
    const { client } = db([paper(1)]);
    const d = deps({ S1: hit("S1") });
    await backfillBatch(client, 10, null, d);
    expect(d.embedBatch).not.toHaveBeenCalled();
  });

  it("leaves an S2 error out of the cache but still counts it as attempted", async () => {
    const { client } = db([paper(1), paper(2)]);
    const d = deps({ S1: hit("S1"), S2: { kind: "error", paperId: "S2", status: 500, message: "x" } });
    const { result, batchSize } = await backfillBatch(client, 10, null, d);
    expect(result).toMatchObject({ embedded: 1, remaining: 0 });
    expect(batchSize).toBe(2);
    expect(d.cacheMany).toHaveBeenCalledWith(client, [{ paperId: 1, vector: vec(1) }]);
  });

  it("does not write to the cache when nothing was embedded", async () => {
    const { client } = db([paper(1)]);
    const d = deps({ S1: { kind: "error", paperId: "S1", status: 500, message: "x" } });
    await backfillBatch(client, 10, null, d);
    expect(d.cacheMany).not.toHaveBeenCalled();
  });

  it("uses empty strings for a missing title or abstract", async () => {
    const { client } = db([{ id: 1, s2_paper_id: "S1", title: null, abstract: null }]);
    const d = deps({ S1: fallback("S1", "no_embedding") });
    await backfillBatch(client, 10, null, d);
    expect(d.embedBatch).toHaveBeenCalledWith([{ title: "", abstract: "" }]);
  });

  it("throws when the papers query fails", async () => {
    const { client } = db([], [], "permission denied");
    await expect(backfillBatch(client, 10, null, deps({}))).rejects.toMatchObject({
      message: "permission denied",
    });
  });
});
