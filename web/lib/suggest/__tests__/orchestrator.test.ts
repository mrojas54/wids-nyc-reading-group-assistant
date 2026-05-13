import { describe, it, expect, vi, beforeEach } from "vitest";
import { orchestrate, type OrchestratorDeps } from "@/lib/suggest/orchestrator";
import { S2AuthError, TimeoutError } from "@/lib/suggest/types";

const v = (n: number) => Float32Array.from(Array(768).fill(n));
const paper = (id: number, s2: string, title = "T", abstract = "A") => ({
  id,
  s2_paper_id: s2,
  title,
  abstract,
});

const baseDeps: OrchestratorDeps = {
  apiKey: "test-key",
  client: undefined,
  getCached: vi.fn(),
  cacheMany: vi.fn().mockResolvedValue(undefined),
  fetchPaperWithEmbedding: vi.fn(),
  embedBatch: vi.fn(),
  isModelWarm: () => false,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("orchestrate", () => {
  it("all-cache-hit path: no S2 calls, no fallback, returns ranked", async () => {
    const cached = new Map([[1, v(0.1)], [2, v(0.2)], [3, v(0.5)], [4, v(0.5)]]);
    const deps = {
      ...baseDeps,
      getCached: vi.fn().mockResolvedValue(cached),
    };
    const result = await orchestrate(
      {
        candidates: [paper(1, "s2-1"), paper(2, "s2-2")],
        past_picks: [paper(3, "s2-3"), paper(4, "s2-4")],
        lambda: 0.6,
        k: 2,
      },
      deps,
    );
    expect(deps.fetchPaperWithEmbedding).not.toHaveBeenCalled();
    expect(deps.embedBatch).not.toHaveBeenCalled();
    expect(result.diagnostics.cache_hits).toBe(4);
    expect(result.diagnostics.s2_fetched).toBe(0);
    expect(result.diagnostics.fallback_used).toBe(0);
    expect(result.ranked).toHaveLength(2);
  });

  it("all-S2-fetch path: cache miss, S2 returns hits, no fallback", async () => {
    const deps = {
      ...baseDeps,
      getCached: vi.fn().mockResolvedValue(new Map()),
      fetchPaperWithEmbedding: vi.fn().mockImplementation(async (s2id: string) => ({
        kind: "hit", paperId: s2id, vector: v(0.1), title: "T", abstract: "A",
      })),
    };
    const result = await orchestrate(
      {
        candidates: [paper(1, "s2-1")],
        past_picks: [paper(2, "s2-2")],
        lambda: 0.6,
        k: 1,
      },
      deps,
    );
    expect(deps.fetchPaperWithEmbedding).toHaveBeenCalledTimes(2);
    expect(deps.embedBatch).not.toHaveBeenCalled();
    expect(deps.cacheMany).toHaveBeenCalled();
    expect(result.diagnostics.s2_fetched).toBe(2);
    expect(result.diagnostics.fallback_used).toBe(0);
  });

  it("mixed-fallback path: S2 returns no_embedding for one paper, WASM fills it in", async () => {
    const deps = {
      ...baseDeps,
      getCached: vi.fn().mockResolvedValue(new Map()),
      fetchPaperWithEmbedding: vi.fn().mockImplementation(async (s2id: string) => {
        if (s2id === "s2-1") return { kind: "fallback_needed", paperId: s2id, reason: "no_embedding", title: "Tc", abstract: "Ac" };
        return { kind: "hit", paperId: s2id, vector: v(0.1), title: "Tp", abstract: "Ap" };
      }),
      embedBatch: vi.fn().mockResolvedValue([v(0.7)]),
    };
    const result = await orchestrate(
      {
        candidates: [paper(1, "s2-1", "TitleC", "AbstractC")],
        past_picks: [paper(2, "s2-2", "TitleP", "AbstractP")],
        lambda: 0.6,
        k: 1,
      },
      deps,
    );
    expect(deps.embedBatch).toHaveBeenCalledOnce();
    // The orchestrator may use the title/abstract from the S2 response OR from the ResolvedPaper input.
    // Either is acceptable as long as a non-empty value reaches embedBatch.
    const callArg = (deps.embedBatch as any).mock.calls[0][0];
    expect(callArg).toHaveLength(1);
    expect(callArg[0].title.length).toBeGreaterThan(0);
    expect(result.diagnostics.fallback_used).toBe(1);
    expect(result.diagnostics.s2_fetched).toBe(1);
  });

  it("S2-down path: all transient, all route to WASM, returns successfully", async () => {
    const deps = {
      ...baseDeps,
      getCached: vi.fn().mockResolvedValue(new Map()),
      fetchPaperWithEmbedding: vi.fn().mockImplementation(async (s2id: string) => ({
        kind: "fallback_needed", paperId: s2id, reason: "s2_transient", title: "", abstract: "",
      })),
      embedBatch: vi.fn().mockResolvedValue([v(0.5), v(0.5)]),
    };
    const result = await orchestrate(
      {
        candidates: [paper(1, "s2-1", "T1", "A1")],
        past_picks: [paper(2, "s2-2", "T2", "A2")],
        lambda: 0.6,
        k: 1,
      },
      deps,
    );
    expect(deps.embedBatch).toHaveBeenCalledOnce();
    expect(result.diagnostics.fallback_used).toBe(2);
    expect(result.ranked).toHaveLength(1);
  });

  it("S2 401 → throws S2AuthError, no fallback masking", async () => {
    const deps = {
      ...baseDeps,
      getCached: vi.fn().mockResolvedValue(new Map()),
      fetchPaperWithEmbedding: vi.fn().mockRejectedValue(new S2AuthError("401")),
    };
    await expect(
      orchestrate(
        {
          candidates: [paper(1, "s2-1")],
          past_picks: [paper(2, "s2-2")],
          lambda: 0.6,
          k: 1,
        },
        deps,
      ),
    ).rejects.toBeInstanceOf(S2AuthError);
  });

  it("throws TimeoutError without invoking any phase when signal is pre-aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const deps = {
      ...baseDeps,
      getCached: vi.fn().mockResolvedValue(new Map()),
    };
    await expect(
      orchestrate(
        {
          candidates: [paper(1, "s2-1")],
          past_picks: [paper(2, "s2-2")],
          lambda: 0.6,
          k: 1,
        },
        deps,
        controller.signal,
      ),
    ).rejects.toBeInstanceOf(TimeoutError);
    expect(deps.getCached).not.toHaveBeenCalled();
  });

  it("forwards signal to embedBatch when WASM fallback runs", async () => {
    const controller = new AbortController();
    const deps = {
      ...baseDeps,
      getCached: vi.fn().mockResolvedValue(new Map()),
      fetchPaperWithEmbedding: vi.fn().mockImplementation(async (s2id: string) => ({
        kind: "fallback_needed", paperId: s2id, reason: "no_embedding", title: "T", abstract: "A",
      })),
      embedBatch: vi.fn().mockResolvedValue([v(0.5), v(0.5)]),
    };
    await orchestrate(
      {
        candidates: [paper(1, "s2-1")],
        past_picks: [paper(2, "s2-2")],
        lambda: 0.6,
        k: 1,
      },
      deps,
      controller.signal,
    );
    expect(deps.embedBatch).toHaveBeenCalledWith(expect.any(Array), controller.signal);
  });
});
