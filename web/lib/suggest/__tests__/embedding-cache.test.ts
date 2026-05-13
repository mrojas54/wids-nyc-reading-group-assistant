import { describe, it, expect, vi } from "vitest";
import { getCached, cacheMany } from "@/lib/suggest/embedding-cache";

function makeMockClient(rows: Array<{ paper_id: number; vector: number[] }>) {
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: rows, error: null }),
        }),
      }),
      upsert: vi.fn().mockResolvedValue({ error: null }),
    }),
  };
}

describe("getCached", () => {
  it("returns a Map keyed by paper_id (number) with Float32Array values", async () => {
    const client = makeMockClient([
      { paper_id: 1, vector: [0.1, 0.2, 0.3] },
      { paper_id: 2, vector: [0.4, 0.5, 0.6] },
    ]) as any;
    const m = await getCached(client, [1, 2]);
    expect(m.size).toBe(2);
    const arr1 = Array.from(m.get(1)!);
    expect(arr1).toHaveLength(3);
    expect(arr1[0]).toBeCloseTo(0.1, 5);
    expect(arr1[1]).toBeCloseTo(0.2, 5);
    expect(arr1[2]).toBeCloseTo(0.3, 5);
    const arr2 = Array.from(m.get(2)!);
    expect(arr2).toHaveLength(3);
    expect(arr2[0]).toBeCloseTo(0.4, 5);
    expect(arr2[1]).toBeCloseTo(0.5, 5);
    expect(arr2[2]).toBeCloseTo(0.6, 5);
  });

  it("returns empty Map when nothing cached", async () => {
    const client = makeMockClient([]) as any;
    const m = await getCached(client, [99]);
    expect(m.size).toBe(0);
  });

  it("parses pgvector string form '[v1,v2,...]' returned by PostgREST", async () => {
    // pgvector columns come back from PostgREST as text literals, not JSON arrays.
    // Regression test for: dim mismatch errors when reading cached embeddings.
    const client = makeMockClient([
      { paper_id: 7, vector: "[0.1,0.2,0.3]" as unknown as number[] },
    ]) as any;
    const m = await getCached(client, [7]);
    expect(m.size).toBe(1);
    const arr = Array.from(m.get(7)!);
    expect(arr).toHaveLength(3);
    expect(arr[0]).toBeCloseTo(0.1, 5);
    expect(arr[1]).toBeCloseTo(0.2, 5);
    expect(arr[2]).toBeCloseTo(0.3, 5);
  });

  it("returns empty Map when given empty input", async () => {
    const client = makeMockClient([]) as any;
    const m = await getCached(client, []);
    expect(m.size).toBe(0);
  });
});

describe("cacheMany", () => {
  it("calls upsert with correct payload and onConflict ignore", async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const client = { from: vi.fn().mockReturnValue({ upsert }) } as any;
    await cacheMany(client, [
      { paperId: 1, vector: Float32Array.from([0.1, 0.2]) },
      { paperId: 2, vector: Float32Array.from([0.3, 0.4]) },
    ]);
    expect(upsert).toHaveBeenCalledOnce();
    const args = upsert.mock.calls[0];
    const payload = args[0] as Array<{ paper_id: number; model: string; vector: number[] }>;
    expect(payload).toHaveLength(2);
    expect(payload[0].paper_id).toBe(1);
    expect(payload[0].model).toBe("specter_v2");
    expect(payload[0].vector).toHaveLength(2);
    expect(payload[0].vector[0]).toBeCloseTo(0.1, 5);
    expect(payload[0].vector[1]).toBeCloseTo(0.2, 5);
    expect(payload[1].paper_id).toBe(2);
    expect(payload[1].model).toBe("specter_v2");
    expect(payload[1].vector).toHaveLength(2);
    expect(payload[1].vector[0]).toBeCloseTo(0.3, 5);
    expect(payload[1].vector[1]).toBeCloseTo(0.4, 5);
    expect(args[1]).toEqual({ onConflict: "paper_id,model", ignoreDuplicates: true });
  });

  it("is a no-op for empty array", async () => {
    const upsert = vi.fn();
    const client = { from: vi.fn().mockReturnValue({ upsert }) } as any;
    await cacheMany(client, []);
    expect(upsert).not.toHaveBeenCalled();
  });
});
