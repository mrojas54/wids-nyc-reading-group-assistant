import { describe, it, expect } from "vitest";
import { mmr, cosineSim } from "@/lib/suggest/mmr";

const v = (arr: number[]) => Float32Array.from(arr);

describe("cosineSim", () => {
  it("returns 1.0 for identical vectors", () => {
    expect(cosineSim(v([1, 0, 0]), v([1, 0, 0]))).toBeCloseTo(1.0, 6);
  });

  it("returns 0.0 for orthogonal vectors", () => {
    expect(cosineSim(v([1, 0, 0]), v([0, 1, 0]))).toBeCloseTo(0.0, 6);
  });

  it("returns -1.0 for opposite vectors", () => {
    expect(cosineSim(v([1, 0, 0]), v([-1, 0, 0]))).toBeCloseTo(-1.0, 6);
  });
});

describe("mmr", () => {
  const query = v([1, 0]);
  // Three candidates: A is closest to query, B is second, C is far + diverse from A
  const candidates = [v([0.9, 0.1]), v([0.8, 0.2]), v([0.1, 0.9])];

  it("with lambda=1 (pure relevance) ranks by similarity to query", () => {
    const order = mmr(query, candidates, 1.0, 3);
    expect(order.map(o => o.index)).toEqual([0, 1, 2]);
  });

  it("with lambda=0 (pure diversity) picks the most-similar first then most-different from selected", () => {
    const order = mmr(query, candidates, 0.0, 3);
    // First pick is still argmax sim(query) when nothing's selected yet; then diversity dominates
    expect(order[0].index).toBe(0);
    expect(order[1].index).toBe(2);  // C is farther from A than B is
  });

  it("returns the MMR score that won each pick", () => {
    const order = mmr(query, candidates, 1.0, 3);
    // λ=1 → score reduces to cosineSim(query, candidate), so scores must match queryRel
    // and be monotonically non-increasing across picks.
    expect(order[0].score).toBeCloseTo(cosineSim(query, candidates[0]), 6);
    expect(order[1].score).toBeCloseTo(cosineSim(query, candidates[1]), 6);
    expect(order[2].score).toBeCloseTo(cosineSim(query, candidates[2]), 6);
    expect(order[0].score).toBeGreaterThanOrEqual(order[1].score);
    expect(order[1].score).toBeGreaterThanOrEqual(order[2].score);
    for (const o of order) expect(Number.isFinite(o.score)).toBe(true);
  });

  it("k smaller than candidates returns exactly k items", () => {
    const order = mmr(query, candidates, 0.6, 2);
    expect(order).toHaveLength(2);
  });

  it("k larger than candidates returns all candidates", () => {
    const order = mmr(query, candidates, 0.6, 100);
    expect(order).toHaveLength(3);
    expect(new Set(order.map(o => o.index))).toEqual(new Set([0, 1, 2]));
  });

  it("empty candidates returns empty array", () => {
    expect(mmr(query, [], 0.6, 5)).toEqual([]);
  });

  it("single candidate returns [{index:0, ...}]", () => {
    const order = mmr(query, [v([0.5, 0.5])], 0.6, 1);
    expect(order).toHaveLength(1);
    expect(order[0].index).toBe(0);
  });
});
