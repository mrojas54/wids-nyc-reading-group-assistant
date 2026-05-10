import { NextResponse } from "next/server";
import { z } from "zod";
import { requireLeaderRole } from "@/lib/auth/requireLeaderRole";
import { orchestrate, type OrchestratorDeps } from "@/lib/suggest/orchestrator";
import { getCached, cacheMany } from "@/lib/suggest/embedding-cache";
import { fetchPaperWithEmbedding } from "@/lib/suggest/s2-client";
import { embedBatch, isModelWarm } from "@/lib/suggest/specter2-wasm";
import {
  SuggestRequestSchema,
  UnauthorizedError,
  ForbiddenError,
  S2AuthError,
  S2RequestError,
  S2OutageError,
  ModelLoadError,
  TimeoutError,
} from "@/lib/suggest/types";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const TIMEOUT_MS = 30_000;

function timeoutAfter(ms: number): Promise<never> {
  return new Promise((_, reject) => setTimeout(() => reject(new TimeoutError()), ms));
}

export async function POST(req: Request) {
  const requestId = crypto.randomUUID();
  let user: { userId: string; role: string } | null = null;
  let parsed: ReturnType<typeof SuggestRequestSchema.parse> | null = null;

  try {
    const ctx = await requireLeaderRole();
    user = ctx;

    const body = await req.json();
    parsed = SuggestRequestSchema.parse(body);

    const apiKey = process.env.S2_API_KEY;
    if (!apiKey) throw new S2AuthError("S2_API_KEY env var not set");

    // Lazy-import the service-role client so we don't pull in @supabase/* at the route module
    // load time; this is fine because the function is dynamic-only.
    const { createSupabaseServiceClient } = await import("@/lib/supabase/service");
    const client = createSupabaseServiceClient();

    const deps: OrchestratorDeps = {
      apiKey,
      client,
      getCached: (c, ids) => getCached(c ?? client, ids),
      cacheMany: (c, rows) => cacheMany(c ?? client, rows),
      fetchPaperWithEmbedding,
      embedBatch,
      isModelWarm,
    };

    const result = await Promise.race([orchestrate(parsed, deps), timeoutAfter(TIMEOUT_MS)]);

    console.log(JSON.stringify({
      event: "suggest_request",
      request_id: requestId,
      user_id: user.userId,
      candidate_count: parsed.candidates.length,
      past_pick_count: parsed.past_picks.length,
      cache_hits: result.diagnostics.cache_hits,
      s2_fetched: result.diagnostics.s2_fetched,
      fallback_used: result.diagnostics.fallback_used,
      cold_start: result.diagnostics.cold_start,
      total_ms: result.diagnostics.total_ms,
      outcome: "ok",
    }));

    return NextResponse.json(result);
  } catch (e) {
    const errorLog = (code: string, status: number) => {
      console.error(JSON.stringify({
        event: "suggest_request",
        request_id: requestId,
        user_id: user?.userId,
        candidate_count: parsed?.candidates.length,
        outcome: "error",
        error_code: code,
        status,
        message: (e as Error).message,
      }));
    };

    if (e instanceof UnauthorizedError) { errorLog("unauthorized", 401); return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }
    if (e instanceof ForbiddenError) { errorLog("forbidden", 403); return NextResponse.json({ error: "forbidden" }, { status: 403 }); }
    if (e instanceof z.ZodError) { errorLog("invalid_request", 400); return NextResponse.json({ error: "invalid_request", issues: e.issues }, { status: 400 }); }
    if (e instanceof S2AuthError) { errorLog("s2_auth", 502); return NextResponse.json({ error: "s2_auth" }, { status: 502 }); }
    if (e instanceof S2RequestError) { errorLog("s2_request", 502); return NextResponse.json({ error: "s2_request" }, { status: 502 }); }
    if (e instanceof S2OutageError) { errorLog("s2_unreachable_fallback_failed", 502); return NextResponse.json({ error: "s2_unreachable_fallback_failed" }, { status: 502 }); }
    if (e instanceof ModelLoadError) { errorLog("wasm_model_load_failed", 502); return NextResponse.json({ error: "wasm_model_load_failed", detail: (e as Error).message }, { status: 502 }); }
    if (e instanceof TimeoutError) { errorLog("timeout", 504); return NextResponse.json({ error: "timeout", elapsed_ms: TIMEOUT_MS }, { status: 504 }); }

    errorLog("internal", 500);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
