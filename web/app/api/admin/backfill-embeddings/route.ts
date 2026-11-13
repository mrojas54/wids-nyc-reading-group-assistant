import { NextResponse } from "next/server";
import { z } from "zod";
import { requireLeaderRole } from "@/lib/auth/requireLeaderRole";
import { fetchPaperWithEmbedding, s2ApiKey } from "@/lib/suggest/s2-client";
import { embedBatch, prewarmModel } from "@/lib/suggest/specter2-wasm";
import { cacheMany } from "@/lib/suggest/embedding-cache";
import { backfillBatch } from "@/lib/suggest/backfill";
import { knownErrorResponse } from "@/lib/suggest/route-errors";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  batch_size: z.number().int().min(1).max(15).default(10),
});

export async function POST(req: Request) {
  const requestId = crypto.randomUUID();
  try {
    await requireLeaderRole();

    const body = await req.json().catch(() => ({}));
    const { batch_size } = BodySchema.parse(body);

    // Kick off WASM warmup before doing any I/O. The S2 fetches run in
    // parallel with the model load.
    prewarmModel();

    const apiKey = s2ApiKey();
    const { createSupabaseServiceClient } = await import("@/lib/supabase/service");
    const { result, batchSize } = await backfillBatch(createSupabaseServiceClient(), batch_size, apiKey, {
      fetchPaperWithEmbedding,
      embedBatch,
      cacheMany,
    });

    if (result.breakdown) {
      const { s2_hits, s2_rate_limited, s2_no_embedding, s2_not_in_corpus, s2_transient, wasm_embedded } =
        result.breakdown;
      console.log(JSON.stringify({
        event: "backfill_batch",
        request_id: requestId,
        batch_size: batchSize,
        s2_hits,
        s2_rate_limited,
        s2_no_embedding,
        s2_not_in_corpus,
        s2_transient,
        wasm_embedded,
        remaining: result.remaining,
      }));
    }

    return NextResponse.json(result);
  } catch (e) {
    const known = knownErrorResponse(e);
    if (known) return NextResponse.json(known.body, { status: known.status });
    console.error(JSON.stringify({ event: "backfill_error", request_id: requestId, message: (e as Error).message }));
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
