// One batch of the "Warm embedding cache" button behind
// POST /api/admin/backfill-embeddings. The route keeps auth, request parsing,
// the log line and status codes; this module picks the papers still missing a
// specter_v2 embedding, embeds one batch (S2 first, WASM for whatever S2 can't
// give) and caches the vectors.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/lib/database.types";
import type { OrchestratorDeps } from "./orchestrator";

export type BackfillDeps = Pick<OrchestratorDeps, "fetchPaperWithEmbedding" | "embedBatch"> & {
  cacheMany: (
    client: SupabaseClient<Database>,
    rows: Array<{ paperId: number; vector: Float32Array }>,
  ) => Promise<void>;
};

export type BackfillBreakdown = {
  s2_hits: number;
  wasm_embedded: number;
  s2_rate_limited: number;
  s2_no_embedding: number;
  s2_not_in_corpus: number;
  s2_transient: number;
};

/** The route's JSON body. `breakdown` is absent when nothing was left to embed. */
export type BackfillResult = {
  embedded: number;
  remaining: number;
  total_eligible: number;
  breakdown?: BackfillBreakdown;
};

// The inferred select results are assigned to these Row-derived shapes so a
// renamed column fails here at compile time rather than as `undefined` in the
// embed input. (Not `.returns<T>()` — see lib/queries/index.ts for why that is a
// cast that would hide exactly this.)
type EligibleRow = Pick<Tables<"papers">, "id" | "s2_paper_id" | "title" | "abstract">;
type CachedRow = Pick<Tables<"paper_embeddings">, "paper_id">;
type Row = { id: number; s2_paper_id: string; title: string; abstract: string };

/** Papers with an s2_paper_id and no specter_v2 embedding, oldest id first. */
async function missingPapers(client: SupabaseClient<Database>) {
  // Two round trips, diffed in memory: pull all eligible papers, then the
  // paper_ids already embedded. Counts are small (tens to low hundreds at WiDS
  // scale).
  const { data: eligible, error: papersErr } = await client
    .from("papers")
    .select("id, s2_paper_id, title, abstract")
    .not("s2_paper_id", "is", null)
    .order("id", { ascending: true });
  if (papersErr) throw papersErr;
  const eligibleRows: EligibleRow[] = eligible ?? [];

  const { data: cached, error: cacheErr } = await client
    .from("paper_embeddings")
    .select("paper_id")
    .eq("model", "specter_v2");
  if (cacheErr) throw cacheErr;
  const cachedRows: CachedRow[] = cached ?? [];

  const cachedIds = new Set(cachedRows.map(r => r.paper_id));
  const missing: Row[] = eligibleRows
    // The filter above excludes NULL s2_paper_id server-side; the guard
    // narrows the generated `string | null` without a cast.
    .filter((r): r is EligibleRow & { s2_paper_id: string } => r.s2_paper_id !== null)
    .filter(r => !cachedIds.has(r.id))
    .map(r => ({
      id: r.id,
      s2_paper_id: r.s2_paper_id,
      title: r.title ?? "",
      abstract: r.abstract ?? "",
    }));
  return { missing, totalEligible: eligibleRows.length };
}

export async function backfillBatch(
  client: SupabaseClient<Database>,
  batchSize: number,
  apiKey: string | null,
  deps: BackfillDeps,
): Promise<{ result: BackfillResult; batchSize: number }> {
  const { missing, totalEligible } = await missingPapers(client);
  if (missing.length === 0) {
    return { result: { embedded: 0, remaining: 0, total_eligible: totalEligible }, batchSize: 0 };
  }

  const batch = missing.slice(0, batchSize);

  // Try S2 for each paper in parallel. Anything S2 doesn't have falls
  // through to WASM. With the 429-no-retry change, this is bounded at
  // ~one S2 round-trip per paper (~400ms wall clock for the whole batch).
  const s2Results = await Promise.all(
    batch.map(p => deps.fetchPaperWithEmbedding(p.s2_paper_id, apiKey)),
  );

  const cacheRows: Array<{ paperId: number; vector: Float32Array }> = [];
  const fallbackQueue: Array<{ id: number; title: string; abstract: string }> = [];
  const breakdown: BackfillBreakdown = {
    s2_hits: 0,
    wasm_embedded: 0,
    s2_rate_limited: 0,
    s2_no_embedding: 0,
    s2_not_in_corpus: 0,
    s2_transient: 0,
  };

  for (let i = 0; i < batch.length; i++) {
    const r = s2Results[i];
    const paper = batch[i];
    if (r.kind === "hit") {
      cacheRows.push({ paperId: paper.id, vector: r.vector });
      breakdown.s2_hits++;
    } else if (r.kind === "fallback_needed") {
      fallbackQueue.push({
        id: paper.id,
        title: r.title || paper.title,
        abstract: r.abstract || paper.abstract,
      });
      if (r.reason === "rate_limited") breakdown.s2_rate_limited++;
      else if (r.reason === "no_embedding") breakdown.s2_no_embedding++;
      else if (r.reason === "not_in_corpus") breakdown.s2_not_in_corpus++;
      else breakdown.s2_transient++;
    }
  }

  if (fallbackQueue.length > 0) {
    const vecs = await deps.embedBatch(
      fallbackQueue.map(f => ({ title: f.title, abstract: f.abstract })),
    );
    for (let i = 0; i < fallbackQueue.length; i++) {
      cacheRows.push({ paperId: fallbackQueue[i].id, vector: vecs[i] });
    }
    breakdown.wasm_embedded = fallbackQueue.length;
  }

  if (cacheRows.length > 0) {
    await deps.cacheMany(client, cacheRows);
  }

  return {
    result: {
      embedded: cacheRows.length,
      remaining: missing.length - batch.length,
      total_eligible: totalEligible,
      breakdown,
    },
    // Papers attempted. Can exceed `embedded`: an S2 "error" result is
    // neither cached nor sent to WASM.
    batchSize: batch.length,
  };
}
