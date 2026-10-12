// A query-builder stand-in for the schedule tests. Every call on a chain is
// recorded, and the chain resolves (on await, or on .maybeSingle()) to
// whatever the test's `respond` returns for that table and call list, so a
// test can assert both the result handling and the exact filters applied.
export type Call = { method: string; args: unknown[] };
export type Query = { table: string; calls: Call[] };
export type Response = { data: unknown; error: { message: string } | null };

const CHAIN_METHODS = ["select", "eq", "in", "not", "order", "limit", "update", "upsert", "insert"];

export function fakeSupabase(respond: (q: Query) => Response) {
  const queries: Query[] = [];
  function from(table: string) {
    const q: Query = { table, calls: [] };
    queries.push(q);
    const chain: Record<string, unknown> = {};
    for (const method of CHAIN_METHODS) {
      chain[method] = (...args: unknown[]) => {
        q.calls.push({ method, args });
        return chain;
      };
    }
    chain.maybeSingle = () => {
      q.calls.push({ method: "maybeSingle", args: [] });
      return Promise.resolve(respond(q));
    };
    chain.then = (resolve: (r: Response) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(respond(q)).then(resolve, reject);
    return chain;
  }
  return { client: { from }, queries };
}

/** The first call named `method` on `q`, for asserting its arguments. */
export function call(q: Query | undefined, method: string): unknown[] | undefined {
  return q?.calls.find((c) => c.method === method)?.args;
}

export function has(q: Query, method: string): boolean {
  return q.calls.some((c) => c.method === method);
}

export const ok = (data: unknown): Response => ({ data, error: null });
export const fail = (message: string): Response => ({ data: null, error: { message } });
