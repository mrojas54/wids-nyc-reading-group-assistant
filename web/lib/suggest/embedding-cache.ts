import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

const MODEL = "specter_v2";

export async function getCached(
  client: SupabaseClient<Database>,
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
  client: SupabaseClient<Database>,
  rows: Array<{ paperId: number; vector: Float32Array }>,
): Promise<void> {
  if (rows.length === 0) return;
  const payload = rows.map(r => ({
    paper_id: r.paperId,
    model: MODEL,
    // pgvector asymmetry, surfaced by the <Database> generic. `supabase gen
    // types` maps the `vector` column to `string` in BOTH Row and Insert. That
    // is correct for reads — PostgREST returns the text literal, which is what
    // parseVector above decodes — but wrong for writes: PostgREST accepts a
    // JSON array here and Postgres casts it to the vector literal server-side.
    // number[] is the deliberate, asserted write contract (see the payload
    // assertions in __tests__/embedding-cache.test.ts), so the cast records a
    // generator limitation rather than papering over a bug.
    //
    // Kept narrow on purpose: paper_id and model stay type-checked against the
    // schema. Drop the cast if the generator ever learns pgvector, or if the
    // write path is deliberately moved to the string form (that would be a
    // wire-format change and needs live-DB verification, not a typing PR).
    vector: Array.from(r.vector) as unknown as string,
  }));
  const { error } = await client
    .from("paper_embeddings")
    .upsert(payload, { onConflict: "paper_id,model", ignoreDuplicates: true });
  if (error) throw error;
}
