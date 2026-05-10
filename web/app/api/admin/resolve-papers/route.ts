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

const ARXIV_RE = /arxiv\.org\/(?:abs|pdf)\/([0-9]{4}\.[0-9]{4,5})(?:v\d+)?(?:\.pdf)?/i;
const DOI_RE = /\b(10\.\d{4,9}\/[^\s/?#]+)/i;
const CANONICAL_RE = /^[A-Z]+:/;

function toS2PaperId(url: string): string | null {
  const s = url.trim();
  if (CANONICAL_RE.test(s)) return s;
  const arxiv = s.match(ARXIV_RE);
  if (arxiv) return `ARXIV:${arxiv[1]}`;
  const doi = s.match(DOI_RE);
  if (doi) return `DOI:${doi[1]}`;
  return null;
}

const S2_BASE = "https://api.semanticscholar.org/graph/v1";

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
      const insertRows: Array<{ s2_paper_id: string; title: string; abstract: string }> = [];
      for (let i = 0; i < missingIds.length; i++) {
        const meta = s2Results[i];
        if (!meta) continue; // S2 didn't have it; drop from result
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
