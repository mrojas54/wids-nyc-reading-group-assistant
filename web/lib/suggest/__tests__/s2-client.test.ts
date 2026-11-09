import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { fetchPaperWithEmbedding, fetchS2Metadata, s2ApiKey } from "@/lib/suggest/s2-client";
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

  it("does NOT retry on 429 — falls back immediately as 'rate_limited'", async () => {
    let calls = 0;
    server.use(http.get(`${S2}/paper/p4b`, () => {
      calls++;
      return new HttpResponse(null, { status: 429 });
    }));
    const r = await fetchPaperWithEmbedding("p4b", "key");
    expect(calls).toBe(1);
    expect(r.kind).toBe("fallback_needed");
    if (r.kind === "fallback_needed") expect(r.reason).toBe("rate_limited");
  });

  it("falls back as 'rate_limited' if a 5xx retry resolves to 429", async () => {
    let calls = 0;
    server.use(http.get(`${S2}/paper/p4c`, () => {
      calls++;
      return new HttpResponse(null, { status: calls === 1 ? 503 : 429 });
    }));
    const r = await fetchPaperWithEmbedding("p4c", "key");
    expect(calls).toBe(2);
    expect(r.kind).toBe("fallback_needed");
    if (r.kind === "fallback_needed") expect(r.reason).toBe("rate_limited");
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

  it("omits the x-api-key header when apiKey is null", async () => {
    let receivedKey: string | null = null;
    server.use(http.get(`${S2}/paper/p8`, ({ request }) => {
      receivedKey = request.headers.get("x-api-key");
      return HttpResponse.json({ paperId: "p8", title: "T", abstract: "A", embedding: { vector: [1] } });
    }));
    const r = await fetchPaperWithEmbedding("p8", null);
    expect(r.kind).toBe("hit");
    expect(receivedKey).toBeNull();
  });
});

describe("s2ApiKey", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns the key without a warning when it is set", () => {
    vi.stubEnv("S2_API_KEY", "k");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(s2ApiKey()).toBe("k");
    expect(warn).not.toHaveBeenCalled();
  });

  it("returns null and logs s2_api_key_absent when it is missing or empty", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("S2_API_KEY", "");
    expect(s2ApiKey()).toBeNull();
    expect(JSON.parse(warn.mock.calls[0][0] as string)).toMatchObject({ event: "s2_api_key_absent" });
  });
});

describe("fetchS2Metadata", () => {
  it("returns title and abstract, null on a miss, and throws on an auth failure", async () => {
    server.use(
      http.get(`${S2}/paper/hit`, () => HttpResponse.json({ paperId: "hit", title: "T", abstract: "A" })),
      http.get(`${S2}/paper/miss`, () => new HttpResponse(null, { status: 404 })),
      http.get(`${S2}/paper/denied`, () => new HttpResponse(null, { status: 401 })),
    );
    expect(await fetchS2Metadata("hit", null)).toEqual({ paperId: "hit", title: "T", abstract: "A" });
    expect(await fetchS2Metadata("miss", null)).toBeNull();
    await expect(fetchS2Metadata("denied", "k")).rejects.toBeInstanceOf(S2AuthError);
  });
});
