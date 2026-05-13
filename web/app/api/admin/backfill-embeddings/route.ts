import { NextResponse } from "next/server";
import { z } from "zod";
import { requireLeaderRole } from "@/lib/auth/requireLeaderRole";
import { fetchPaperWithEmbedding } from "@/lib/suggest/s2-client";
import { embedBatch, prewarmModel } from "@/lib/suggest/specter2-wasm";
import { cacheMany } from "@/lib/suggest/embedding-cache";
import {
  UnauthorizedError,
  ForbiddenError,
  S2AuthError,
  S2RequestError,
  ModelLoadError,
} from "@/lib/suggest/types";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  batch_size: z.number().int().min(1).max(15).default(10),
});

type Row = { id: number; s2_paper_id: string; title: string; abstract: string };

export async function POST(req: Request) {
  const requestId = crypto.randomUUID();
  try {
    await requireLeaderRole();

    const body = await req.json().catch(() => ({}));
    const { batch_size } = BodySchema.parse(body);

    // Kick off WASM warmup before doing any I/O. The S2 fetches below run in
    // parallel with the model load.
    prewarmModel();

    const apiKey = process.env.S2_API_KEY ?? null;
    const { createSupabaseServiceClient } = await import("@/lib/supabase/service");
    const client = createSupabaseServiceClient();

    // Find papers that have an s2_paper_id but no specter_v2 embedding row.
    // Using a single round-trip: pull all eligible papers, then pull existing
    // paper_ids from paper_embeddings, then diff in memory. Embedding count
    // is small (tens to low hundreds at WiDS scale).
    const { data: eligible, error: papersErr } = await client
      .from("papers")
      .select("id, s2_paper_id, title, abstract")
      .not("s2_paper_id", "is", null)
      .order("id", { ascending: true });
    if (papersErr) throw papersErr;

    const { data: cached, error: cacheErr } = await client
      .from("paper_embeddings")
      .select("paper_id")
      .eq("model", "specter_v2");
    if (cacheErr) throw cacheErr;

    const cachedIds = new Set((cached ?? []).map((r: any) => r.paper_id as number));
    const missing: Row[] = ((eligible ?? []) as any[])
      .filter(r => !cachedIds.has(r.id as number))
      .map(r => ({
        id: r.id as number,
        s2_paper_id: r.s2_paper_id as string,
        title: (r.title as string) ?? "",
        abstract: (r.abstract as string) ?? "",
      }));

    if (missing.length === 0) {
      return NextResponse.json({ embedded: 0, remaining: 0, total_eligible: eligible?.length ?? 0 });
    }

    const batch = missing.slice(0, batch_size);

    // Try S2 for each paper in parallel. Anything S2 doesn't have falls
    // through to WASM. With the 429-no-retry change, this is bounded at
    // ~one S2 round-trip per paper (~400ms wall clock for the whole batch).
    const s2Results = await Promise.all(
      batch.map(p => fetchPaperWithEmbedding(p.s2_paper_id, apiKey)),
    );

    const cacheRows: Array<{ paperId: number; vector: Float32Array }> = [];
    const fallbackQueue: Array<{ id: number; title: string; abstract: string }> = [];
    let s2_hits = 0;
    let s2_rate_limited = 0;
    let s2_no_embedding = 0;
    let s2_not_in_corpus = 0;
    let s2_transient = 0;

    for (let i = 0; i < batch.length; i++) {
      const r = s2Results[i];
      const paper = batch[i];
      if (r.kind === "hit") {
        cacheRows.push({ paperId: paper.id, vector: r.vector });
        s2_hits++;
      } else if (r.kind === "fallback_needed") {
        fallbackQueue.push({
          id: paper.id,
          title: r.title || paper.title,
          abstract: r.abstract || paper.abstract,
        });
        if (r.reason === "rate_limited") s2_rate_limited++;
        else if (r.reason === "no_embedding") s2_no_embedding++;
        else if (r.reason === "not_in_corpus") s2_not_in_corpus++;
        else s2_transient++;
      }
    }

    let wasm_embedded = 0;
    if (fallbackQueue.length > 0) {
      const vecs = await embedBatch(
        fallbackQueue.map(f => ({ title: f.title, abstract: f.abstract })),
      );
      for (let i = 0; i < fallbackQueue.length; i++) {
        cacheRows.push({ paperId: fallbackQueue[i].id, vector: vecs[i] });
      }
      wasm_embedded = fallbackQueue.length;
    }

    if (cacheRows.length > 0) {
      await cacheMany(client, cacheRows);
    }

    const remaining = missing.length - batch.length;

    console.log(JSON.stringify({
      event: "backfill_batch",
      request_id: requestId,
      batch_size: batch.length,
      s2_hits,
      s2_rate_limited,
      s2_no_embedding,
      s2_not_in_corpus,
      s2_transient,
      wasm_embedded,
      remaining,
    }));

    return NextResponse.json({
      embedded: cacheRows.length,
      remaining,
      total_eligible: eligible?.length ?? 0,
      breakdown: { s2_hits, wasm_embedded, s2_rate_limited, s2_no_embedding, s2_not_in_corpus, s2_transient },
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    if (e instanceof ForbiddenError) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    if (e instanceof z.ZodError) return NextResponse.json({ error: "invalid_request", issues: e.issues }, { status: 400 });
    if (e instanceof S2AuthError) return NextResponse.json({ error: "s2_auth" }, { status: 502 });
    if (e instanceof S2RequestError) return NextResponse.json({ error: "s2_request" }, { status: 502 });
    if (e instanceof ModelLoadError) return NextResponse.json({ error: "wasm_model_load_failed", detail: (e as Error).message }, { status: 502 });
    console.error(JSON.stringify({ event: "backfill_error", request_id: requestId, message: (e as Error).message }));
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
