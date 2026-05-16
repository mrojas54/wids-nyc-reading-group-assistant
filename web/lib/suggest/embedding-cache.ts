import type { SupabaseClient } from "@supabase/supabase-js";

const MODEL = "specter_v2";

export async function getCached(
  client: SupabaseClient,
  paperIds: number[],
): Promise<Map<number, Float32Array>> {
  if (paperIds.length === 0) return new Map();
  const { data, error } = await client
    .from("paper_embeddings")
    .select("paper_id, vector")
    .in("paper_id", paperIds)
    .eq("model", MODEL);
  if (error) throw error;
  const map = new Map<number, Float32Array>();
  for (const row of data ?? []) {
    map.set(row.paper_id as number, parseVector(row.vector));
  }
  return map;
}

// pgvector's `vector` column round-trips through PostgREST as the literal
// text form `"[0.1,0.2,...]"`, NOT as a JSON array. Reading `row.vector`
// gives us a string. JSON.parse handles the bracketed comma-separated
// format directly. The number[] branch is for tests and any future driver
// that decodes pgvector natively.
/** @internal Exported for testing. */
export function parseVector(raw: unknown): Float32Array {
  if (typeof raw === "string") return Float32Array.from(JSON.parse(raw) as number[]);
  if (Array.isArray(raw)) return Float32Array.from(raw as number[]);
  throw new Error(`paper_embeddings.vector: unexpected type ${typeof raw}`);
}

export async function cacheMany(
  client: SupabaseClient,
  rows: Array<{ paperId: number; vector: Float32Array }>,
): Promise<void> {
  if (rows.length === 0) return;
  const payload = rows.map(r => ({
    paper_id: r.paperId,
    model: MODEL,
    vector: Array.from(r.vector),
  }));
  const { error } = await client
    .from("paper_embeddings")
    .upsert(payload, { onConflict: "paper_id,model", ignoreDuplicates: true });
  if (error) throw error;
}
