import { describe, it, expect, vi } from "vitest";
import { runChunkedWithAbort } from "@/lib/suggest/abortable";
import { TimeoutError } from "@/lib/suggest/types";

describe("runChunkedWithAbort", () => {
  it("processes all items in chunks when no signal is provided", async () => {
    const results = await runChunkedWithAbort(
      [1, 2, 3, 4, 5],
      2,
      undefined,
      async (chunk) => chunk.map((n) => n * 10),
    );
    expect(results).toEqual([10, 20, 30, 40, 50]);
  });

  it("processes all items when signal never aborts", async () => {
    const controller = new AbortController();
    const results = await runChunkedWithAbort(
      [1, 2, 3],
      2,
      controller.signal,
      async (chunk) => chunk.map((n) => n * 2),
    );
    expect(results).toEqual([2, 4, 6]);
  });

  it("throws TimeoutError without invoking processChunk when signal is pre-aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const processChunk = vi.fn(async (chunk: number[]) => chunk);
    await expect(
      runChunkedWithAbort([1, 2, 3], 2, controller.signal, processChunk),
    ).rejects.toBeInstanceOf(TimeoutError);
    expect(processChunk).not.toHaveBeenCalled();
  });

  it("throws TimeoutError after the current chunk completes when aborted mid-iteration", async () => {
    const controller = new AbortController();
    const seen: number[] = [];
    const promise = runChunkedWithAbort(
      [1, 2, 3, 4, 5, 6],
      2,
      controller.signal,
      async (chunk) => {
        seen.push(...chunk);
        if (chunk[0] === 3) controller.abort();
        return chunk;
      },
    );
    await expect(promise).rejects.toBeInstanceOf(TimeoutError);
    // Chunk [1,2] completed; chunk [3,4] completed (and aborted during it);
    // chunk [5,6] never started because the abort check fires at the boundary.
    expect(seen).toEqual([1, 2, 3, 4]);
  });

  it("yields between chunks so AbortSignal.timeout can fire", async () => {
    // 10ms budget vs 8 chunks × 5ms each: without setImmediate between chunks
    // the timer queue cannot drain and the signal never aborts. With the yield,
    // the timer fires after a few chunks.
    const signal = AbortSignal.timeout(10);
    let chunksProcessed = 0;
    const promise = runChunkedWithAbort(
      [1, 2, 3, 4, 5, 6, 7, 8],
      1,
      signal,
      async (chunk) => {
        chunksProcessed++;
        await new Promise((r) => setTimeout(r, 5));
        return chunk;
      },
    );
    await expect(promise).rejects.toBeInstanceOf(TimeoutError);
    expect(chunksProcessed).toBeLessThan(8);
  });
});
