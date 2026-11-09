// The work behind POST /api/admin/resolve-papers: turn pasted URLs, DOIs or S2
// ids into papers rows, creating the rows that don't exist yet from Semantic
// Scholar (or arXiv when S2 doesn't have the paper). The route keeps auth,
// request parsing and the HTTP error mapping.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/lib/database.types";
import { fetchS2Metadata } from "./s2-client";
import { toS2PaperId, fetchArxivBatch } from "./resolve-helpers";

export type ResolvedPaper = {
  id: number;
  s2_paper_id: string;
  title: string;
  abstract: string;
};

export type ResolveResult =
  | { kind: "resolved"; resolved: ResolvedPaper[] }
  | { kind: "no_valid_urls" };

// Both selects below flow into toResolvedPaper, whose parameter is built from
// the generated Row type, so a renamed column is a compile error instead of a
// silent `undefined`. (Not `.returns<T>()` — see lib/queries.ts for why that
// is a cast that would hide exactly this.)
type PaperSelectRow = Pick<Tables<"papers">, "id" | "s2_paper_id" | "title" | "abstract">;

function toResolvedPaper(r: PaperSelectRow): ResolvedPaper | null {
  // Every row here was matched or upserted by s2_paper_id, so a NULL is a
  // data invariant violation, not a value to coerce to "".
  if (r.s2_paper_id === null) return null;
  return {
    id: r.id,
    s2_paper_id: r.s2_paper_id,
    title: r.title ?? "",
    abstract: r.abstract ?? "",
  };
}

/** Looks up S2 (then arXiv) for ids with no papers row and upserts what it finds. */
async function createMissingPapers(
  client: SupabaseClient<Database>,
  missingIds: string[],
  apiKey: string | null,
): Promise<PaperSelectRow[]> {
  const s2Results = await Promise.all(missingIds.map(id => fetchS2Metadata(id, apiKey)));

  // Collect ARXIV: IDs that S2 didn't have — batch-fetch from arXiv export API
  const s2Misses = missingIds.filter((id, i) => !s2Results[i] && id.startsWith("ARXIV:"));
  const arxivFallback = s2Misses.length > 0 ? await fetchArxivBatch(s2Misses) : new Map();

  const insertRows: Array<{ s2_paper_id: string; title: string; abstract: string }> = [];
  for (let i = 0; i < missingIds.length; i++) {
    const meta = s2Results[i] ?? arxivFallback.get(missingIds[i]) ?? null;
    if (!meta) continue; // neither S2 nor arXiv had it; drop
    insertRows.push({
      s2_paper_id: meta.paperId,
      title: meta.title || "(untitled)",
      abstract: meta.abstract || "",
    });
  }
  if (insertRows.length === 0) return [];

  const { data: inserted, error: insertErr } = await client
    .from("papers")
    .upsert(insertRows, { onConflict: "s2_paper_id" })
    .select("id, s2_paper_id, title, abstract");
  if (insertErr) throw insertErr;
  return inserted ?? [];
}

export async function resolvePapers(
  client: SupabaseClient<Database>,
  urls: string[],
  apiKey: string | null,
): Promise<ResolveResult> {
  // 1. Parse all inputs to s2_paper_ids
  const parsed = urls.map(u => ({ input: u, s2Id: toS2PaperId(u) }));
  const validIds = Array.from(
    new Set(parsed.filter(x => x.s2Id !== null).map(x => x.s2Id as string)),
  );
  if (validIds.length === 0) return { kind: "no_valid_urls" };

  // 2. Lookup existing papers
  const { data: existing, error: existingErr } = await client
    .from("papers")
    .select("id, s2_paper_id, title, abstract")
    .in("s2_paper_id", validIds);
  if (existingErr) throw existingErr;

  const resolvedMap = new Map<string, ResolvedPaper>();
  const remember = (rows: PaperSelectRow[]) => {
    for (const r of rows) {
      const row = toResolvedPaper(r);
      if (row) resolvedMap.set(row.s2_paper_id, row);
    }
  };
  remember(existing ?? []);

  // 3. Fetch S2 metadata for misses, then UPSERT into papers
  const missingIds = validIds.filter(id => !resolvedMap.has(id));
  if (missingIds.length > 0) {
    remember(await createMissingPapers(client, missingIds, apiKey));
  }

  // 4. Build response in input order, dropping unparseable/unresolvable entries
  const resolved: ResolvedPaper[] = [];
  const seen = new Set<string>();
  for (const p of parsed) {
    if (!p.s2Id) continue;
    if (seen.has(p.s2Id)) continue;
    const r = resolvedMap.get(p.s2Id);
    if (r) {
      resolved.push(r);
      seen.add(p.s2Id);
    }
  }
  return { kind: "resolved", resolved };
}
