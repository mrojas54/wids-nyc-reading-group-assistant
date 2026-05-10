import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { fetchPaperWithEmbedding } from "@/lib/suggest/s2-client";
import { S2AuthError, S2RequestError } from "@/lib/suggest/types";

const S2 = "https://api.semanticscholar.org/graph/v1";

const server = setupServer();
beforeEach(() => server.listen());
afterEach(() => server.resetHandlers());
afterEach(() => server.close());

describe("fetchPaperWithEmbedding", () => {
  it("classifies 200 + valid embedding as 'hit'", async () => {
    server.use(http.get(`${S2}/paper/p1`, () =>
      HttpResponse.json({ paperId: "p1", title: "T", abstract: "A", embedding: { vector: [1, 2, 3] } })
    ));
    const r = await fetchPaperWithEmbedding("p1", "key");
    expect(r.kind).toBe("hit");
    if (r.kind === "hit") expect(Array.from(r.vector)).toEqual([1, 2, 3]);
  });

  it("classifies 200 with null embedding as 'fallback_needed' (no_embedding)", async () => {
    server.use(http.get(`${S2}/paper/p2`, () =>
      HttpResponse.json({ paperId: "p2", title: "T", abstract: "A", embedding: null })
    ));
    const r = await fetchPaperWithEmbedding("p2", "key");
    expect(r.kind).toBe("fallback_needed");
    if (r.kind === "fallback_needed") expect(r.reason).toBe("no_embedding");
  });

  it("classifies 404 as 'fallback_needed' (not_in_corpus)", async () => {
    server.use(http.get(`${S2}/paper/p3`, () => new HttpResponse(null, { status: 404 })));
    const r = await fetchPaperWithEmbedding("p3", "key");
    expect(r.kind).toBe("fallback_needed");
    if (r.kind === "fallback_needed") expect(r.reason).toBe("not_in_corpus");
  });

  it("retries 5xx once, then classifies 's2_transient' fallback if still failing", async () => {
    let calls = 0;
    server.use(http.get(`${S2}/paper/p4`, () => {
      calls++;
      return new HttpResponse(null, { status: 503 });
    }));
    const r = await fetchPaperWithEmbedding("p4", "key");
    expect(calls).toBe(2);
    expect(r.kind).toBe("fallback_needed");
    if (r.kind === "fallback_needed") expect(r.reason).toBe("s2_transient");
  });

  it("treats successful retry-after-5xx as a hit", async () => {
    let calls = 0;
    server.use(http.get(`${S2}/paper/p5`, () => {
      calls++;
      if (calls === 1) return new HttpResponse(null, { status: 503 });
      return HttpResponse.json({ paperId: "p5", title: "T", abstract: "A", embedding: { vector: [4, 5, 6] } });
    }));
    const r = await fetchPaperWithEmbedding("p5", "key");
    expect(calls).toBe(2);
    expect(r.kind).toBe("hit");
  });

  it("throws S2AuthError on 401", async () => {
    server.use(http.get(`${S2}/paper/p6`, () => new HttpResponse(null, { status: 401 })));
    await expect(fetchPaperWithEmbedding("p6", "key")).rejects.toBeInstanceOf(S2AuthError);
  });

  it("throws S2RequestError on 400", async () => {
    server.use(http.get(`${S2}/paper/p7`, () => new HttpResponse(null, { status: 400 })));
    await expect(fetchPaperWithEmbedding("p7", "key")).rejects.toBeInstanceOf(S2RequestError);
  });
});
