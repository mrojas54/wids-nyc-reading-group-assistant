// RED-phase stub. Implementation lands in the GREEN phase.
export async function runChunkedWithAbort<T, R>(
  _items: T[],
  _chunkSize: number,
  _signal: AbortSignal | undefined,
  _processChunk: (chunk: T[]) => Promise<R[]>,
): Promise<R[]> {
  throw new Error("runChunkedWithAbort: not implemented");
}
