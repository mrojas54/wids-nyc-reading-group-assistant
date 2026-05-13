import { TimeoutError } from "./types";

/**
 * Runs `processChunk` over `items` in chunks of `chunkSize`, yielding to the
 * event loop via `setImmediate` between chunks so that pending timers — most
 * importantly `AbortSignal.timeout(...)` — can actually fire.
 *
 * If `signal` is aborted at any chunk boundary (before the first chunk or
 * between chunks), throws `TimeoutError` without starting another chunk. The
 * currently-executing chunk is allowed to complete because we cannot preempt
 * the underlying work (WASM `session.run`) cooperatively — the per-chunk size
 * (typically ~10 items) bounds the worst-case overshoot.
 */
export async function runChunkedWithAbort<T, R>(
  items: T[],
  chunkSize: number,
  signal: AbortSignal | undefined,
  processChunk: (chunk: T[]) => Promise<R[]>,
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    if (signal?.aborted) throw new TimeoutError();
    const chunk = items.slice(i, i + chunkSize);
    const chunkResults = await processChunk(chunk);
    results.push(...chunkResults);
    if (i + chunkSize < items.length) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }
  if (signal?.aborted) throw new TimeoutError();
  return results;
}
