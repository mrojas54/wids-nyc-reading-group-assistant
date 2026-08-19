import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { TimeoutError } from "./types";
import { mmr } from "./mmr";
import type {
  S2Result,
  SuggestRequest,
  SuggestResponse,
  RankedResult,
  ResolvedPaper,
} from "./types";

export type OrchestratorDeps = {
  apiKey: string | null;
  client?: SupabaseClient<Database>;
  getCached: (client: SupabaseClient<Database> | undefined, ids: number[]) => Promise<Map<number, Float32Array>>;
  cacheMany: (
    client: SupabaseClient<Database> | undefined,
    rows: Array<{ paperId: number; vector: Float32Array }>,
  ) => Promise<void>;
  fetchPaperWithEmbedding: (s2PaperId: string, apiKey: string | null) => Promise<S2Result>;
  embedBatch: (
    items: Array<{ title: string; abstract: string }>,
    signal?: AbortSignal,
  ) => Promise<Float32Array[]>;
  isModelWarm: () => boolean;
};

function meanVec(vectors: Float32Array[]): Float32Array {
  if (vectors.length === 0) throw new Error("meanVec: empty input");
  const dim = vectors[0].length;
  const out = new Float32Array(dim);
  for (const v of vectors) for (let i = 0; i < dim; i++) out[i] += v[i];
  for (let i = 0; i < dim; i++) out[i] /= vectors.length;
  return out;
}

/**
 * Cancellation: when `signal` is provided, this function throws `TimeoutError`
 * if the signal is already aborted at entry and forwards the signal to
 * `embedBatch`, which checks it between WASM chunks. Async I/O phases (cache
 * lookup, S2 fetch) are not actively cancelled here — they have their own
 * per-request timeouts inside their respective clients.
 */
export async function orchestrate(
  req: SuggestRequest,
  deps: OrchestratorDeps,
  signal?: AbortSignal,
): Promise<SuggestResponse> {
  if (signal?.aborted) throw new TimeoutError();
  const t0 = Date.now();
  const wasWarm = deps.isModelWarm();

  const allPapers: ResolvedPaper[] = [...req.candidates, ...req.past_picks];
  const allIds = allPapers.map(p => p.id);

  // 1. Cache lookup
  const cached = await deps.getCached(deps.client, allIds);
  const missing = allPapers.filter(p => !cached.has(p.id));

  // 2. S2 fetch for misses
  let s2Fetched = 0;
  const fallbackQueue: Array<{ id: number; title: string; abstract: string }> = [];
  const newCacheRows: Array<{ paperId: number; vector: Float32Array }> = [];

  if (missing.length > 0) {
    const results = await Promise.all(
      missing.map(p => deps.fetchPaperWithEmbedding(p.s2_paper_id, deps.apiKey)),
    );
    for (let i = 0; i < missing.length; i++) {
      const r = results[i];
      const paper = missing[i];
      if (r.kind === "hit") {
        cached.set(paper.id, r.vector);
        newCacheRows.push({ paperId: paper.id, vector: r.vector });
        s2Fetched++;
      } else if (r.kind === "fallback_needed") {
        fallbackQueue.push({
          id: paper.id,
          title: r.title || paper.title,
          abstract: r.abstract || paper.abstract,
        });
      }
      // r.kind === 'error' should not occur — s2-client throws for non-recoverable statuses.
    }
  }

  // 3. WASM fallback batch
  let fallbackUsed = 0;
  if (fallbackQueue.length > 0) {
    const vecs = await deps.embedBatch(
      fallbackQueue.map(f => ({ title: f.title, abstract: f.abstract })),
      signal,
    );
    for (let i = 0; i < fallbackQueue.length; i++) {
      cached.set(fallbackQueue[i].id, vecs[i]);
      newCacheRows.push({ paperId: fallbackQueue[i].id, vector: vecs[i] });
    }
    fallbackUsed = fallbackQueue.length;
  }

  // 4. Cache writes (best-effort)
  if (newCacheRows.length > 0) {
    await deps.cacheMany(deps.client, newCacheRows).catch(e => {
      console.error(JSON.stringify({ event: "cache_write_failed", error: String(e) }));
    });
  }

  // 5. MMR
  const candidateVecs = req.candidates.map(p => cached.get(p.id)!);
  const pastPickVecs = req.past_picks.map(p => cached.get(p.id)!);
  const queryVec = meanVec(pastPickVecs);
  const order = mmr(queryVec, candidateVecs, req.lambda, req.k);

  // 6. Build response
  const ranked: RankedResult[] = order.map(({ index, score }) => ({
    paper_id: req.candidates[index].id,
    title: req.candidates[index].title,
    mmr_score: score,
  }));

  return {
    ranked,
    diagnostics: {
      cache_hits: cached.size - newCacheRows.length,
      s2_fetched: s2Fetched,
      fallback_used: fallbackUsed,
      cold_start: !wasWarm && fallbackUsed > 0,
      total_ms: Date.now() - t0,
    },
  };
}
