import { NextResponse } from "next/server";
import { z } from "zod";
import { requireLeaderRole } from "@/lib/auth/requireLeaderRole";
import {
  UnauthorizedError,
  ForbiddenError,
  S2AuthError,
  S2RequestError,
} from "@/lib/suggest/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ResolveRequestSchema = z.object({
  urls: z.array(z.string().min(1)).min(1).max(10),
});

// Matches: https://arxiv.org/abs/2605.02028, https://arxiv.org/abs/2605.02028v1, https://arxiv.org/pdf/2605.02028.pdf, etc.
const ARXIV_RE = /arxiv\.org\/(?:abs|pdf)\/([0-9]{4}\.[0-9]{4,5}(?:v\d+)?)/i;
// Matches: https://doi.org/10.xxxx/yyyy, 10.xxxx/yyyy, doi:10.xxxx/yyyy
const DOI_RE = /(?:doi\.org\/|doi:)?(10\.\d{4,9}\/[^\s/?#]+)/i;
// Matches: ARXIV:2605.02028, DOI:10.xxxx/yyyy, SEMANTIC_SCHOLAR:1234567890
const CANONICAL_RE = /^[A-Z][A-Z0-9_]*:/;
// Matches: https://semanticscholar.org/paper/uuid or https://s2-cache.../paper/uuid
const S2_URL_RE = /(?:semanticscholar\.org|s2-cache[^/]*)\/paper\/([A-Za-z0-9]+)/i;

// Bare arXiv ID: 2605.02028, 2605.02028v1
const BARE_ARXIV_RE = /^([0-9]{4}\.[0-9]{4,5}(?:v\d+)?)$/;
// Old-style arXiv ID: hep-ph/9901234, cs.AI/0601001
const OLD_ARXIV_RE = /^([a-z-]+(?:\.[A-Z]{2})?)\/([0-9]{7})$/;

function toS2PaperId(url: string): string | null {
  const s = url.trim();
  // Canonical S2 prefix (ARXIV:, DOI:, MAG:, CorpusId:, etc.) — case-sensitive uppercase start
  if (CANONICAL_RE.test(s)) return s;
  // Mixed-case prefixes like arXiv:2605.02028 → normalise to ARXIV:
  if (/^arxiv:/i.test(s)) return `ARXIV:${s.slice(6)}`;
  // Full arXiv URL
  const arxiv = s.match(ARXIV_RE);
  if (arxiv) return `ARXIV:${arxiv[1]}`;
  // Bare arXiv ID (just the number)
  const bare = s.match(BARE_ARXIV_RE);
  if (bare) return `ARXIV:${bare[1]}`;
  // Old-style arXiv ID (e.g. hep-ph/9901234)
  const oldArxiv = s.match(OLD_ARXIV_RE);
  if (oldArxiv) return `ARXIV:${oldArxiv[1]}/${oldArxiv[2]}`;
  // Semantic Scholar URL
  const s2Url = s.match(S2_URL_RE);
  if (s2Url) return s2Url[1];
  // DOI URL, doi: prefix, or bare DOI
  const doi = s.match(DOI_RE);
  if (doi) return `DOI:${doi[1]}`;
  return null;
}

const S2_BASE = "https://api.semanticscholar.org/graph/v1";
const ARXIV_EXPORT_API = "https://export.arxiv.org/api/query";

// Parse all <entry> blocks from arXiv Atom XML, keyed by the bare arXiv ID
// (with version suffix if present, e.g. "2605.02028v1").
function parseArxivAtom(xml: string): Map<string, { title: string; abstract: string }> {
  const out = new Map<string, { title: string; abstract: string }>();
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
  let m;
  while ((m = entryRe.exec(xml)) !== null) {
    const entry = m[1];
    // <id>http://arxiv.org/abs/2605.02028v1</id>
    const idM = entry.match(/<id>[^<]*\/abs\/([^<\s]+)<\/id>/);
    const titleM = entry.match(/<title>([\s\S]*?)<\/title>/);
    const summaryM = entry.match(/<summary>([\s\S]*?)<\/summary>/);
    if (!idM || !titleM) continue;
    const arxivId = idM[1].trim();
    const title = titleM[1].trim().replace(/\s+/g, " ");
    const abstract = summaryM ? summaryM[1].trim().replace(/\s+/g, " ") : "";
    out.set(arxivId, { title, abstract });
  }
  return out;
}

// Fetch title+abstract from the arXiv export API for a batch of ARXIV: IDs.
// Returns a map of s2Id -> { paperId, title, abstract } for hits only.
async function fetchArxivBatch(
  s2Ids: string[], // e.g. ["ARXIV:2605.02028v1", "ARXIV:2501.12345"]
): Promise<Map<string, { paperId: string; title: string; abstract: string }>> {
  const out = new Map<string, { paperId: string; title: string; abstract: string }>();
  if (s2Ids.length === 0) return out;

  const pairs = s2Ids.map(id => ({ s2Id: id, arxivId: id.slice("ARXIV:".length) }));
  const idList = pairs.map(p => p.arxivId).join(",");
  let res: Response;
  try {
    res = await fetch(`${ARXIV_EXPORT_API}?id_list=${encodeURIComponent(idList)}&max_results=10`, {
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return out; // network error — degrade gracefully
  }
  if (!res.ok) return out;

  const xml = await res.text();
  const parsed = parseArxivAtom(xml);

  for (const { s2Id, arxivId } of pairs) {
    // arXiv may return versioned ID even if we passed unversioned, so match
    // by stripping version from both sides.
    const baseId = arxivId.replace(/v\d+$/, "");
    const hit =
      parsed.get(arxivId) ??
      parsed.get(baseId) ??
      [...parsed.entries()].find(([k]) => k.replace(/v\d+$/, "") === baseId)?.[1];
    if (hit) {
      out.set(s2Id, { paperId: s2Id, title: hit.title, abstract: hit.abstract });
    }
  }
  return out;
}

async function fetchS2Metadata(
  s2Id: string,
  apiKey: string | null,
): Promise<{ paperId: string; title: string; abstract: string } | null> {
  const url = `${S2_BASE}/paper/${encodeURIComponent(s2Id)}?fields=paperId,title,abstract`;
  const headers: Record<string, string> = {};
  if (apiKey) headers["x-api-key"] = apiKey;
  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 401 || res.status === 403) throw new S2AuthError(`s2 ${res.status}`);
  if (!res.ok) return null;
  const data = (await res.json()) as { paperId: string; title: string; abstract: string };
  return data;
}

type DbPaperRow = {
  id: number;
  s2_paper_id: string;
  title: string;
  abstract: string;
};

export async function POST(req: Request) {
  try {
    await requireLeaderRole();
    const body = await req.json();
    const { urls } = ResolveRequestSchema.parse(body);

    // 1. Parse all inputs to s2_paper_ids
    const parsed = urls.map(u => ({ input: u, s2Id: toS2PaperId(u) }));
    const validIds = Array.from(
      new Set(parsed.filter(x => x.s2Id !== null).map(x => x.s2Id as string)),
    );
    if (validIds.length === 0) {
      return NextResponse.json(
        {
          error: "no_valid_urls",
          details: "None of the inputs could be parsed as arXiv URL, DOI, or canonical S2 ID.",
        },
        { status: 400 },
      );
    }

    const apiKey = process.env.S2_API_KEY ?? null;
    if (!apiKey) {
      console.warn(JSON.stringify({
        event: "s2_api_key_absent",
        message: "S2_API_KEY env var not set; calling S2 unauthenticated.",
      }));
    }

    const { createSupabaseServiceClient } = await import("@/lib/supabase/service");
    const client = createSupabaseServiceClient();

    // 2. Lookup existing papers
    const { data: existing, error: existingErr } = await client
      .from("papers")
      .select("id, s2_paper_id, title, abstract")
      .in("s2_paper_id", validIds);
    if (existingErr) throw existingErr;

    const resolvedMap = new Map<string, DbPaperRow>();
    for (const r of (existing ?? []) as any[]) {
      resolvedMap.set(r.s2_paper_id as string, {
        id: r.id as number,
        s2_paper_id: r.s2_paper_id as string,
        title: (r.title as string) ?? "",
        abstract: (r.abstract as string) ?? "",
      });
    }

    // 3. Fetch S2 metadata for misses, then UPSERT into papers
    const missingIds = validIds.filter(id => !resolvedMap.has(id));
    if (missingIds.length > 0) {
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
      if (insertRows.length > 0) {
        const { data: inserted, error: insertErr } = await client
          .from("papers")
          .upsert(insertRows, { onConflict: "s2_paper_id" })
          .select("id, s2_paper_id, title, abstract");
        if (insertErr) throw insertErr;
        for (const row of (inserted ?? []) as any[]) {
          resolvedMap.set(row.s2_paper_id as string, {
            id: row.id as number,
            s2_paper_id: row.s2_paper_id as string,
            title: (row.title as string) ?? "",
            abstract: (row.abstract as string) ?? "",
          });
        }
      }
    }

    // 4. Build response in input order, dropping unparseable/unresolvable entries
    const resolved: DbPaperRow[] = [];
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

    return NextResponse.json({ resolved });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    if (e instanceof ForbiddenError) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "invalid_request", issues: e.issues }, { status: 400 });
    }
    if (e instanceof S2AuthError) {
      return NextResponse.json({ error: "s2_auth" }, { status: 502 });
    }
    if (e instanceof S2RequestError) {
      return NextResponse.json({ error: "s2_request" }, { status: 502 });
    }
    console.error(JSON.stringify({ event: "resolve_error", message: (e as Error).message }));
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
