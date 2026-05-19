// analyze-paper — operator/leader-triggered Paper Pal synthesis.
//
// Spec: docs/superpowers/specs/2026-05-17-paper-pal-edge-functions.md §4.1
//       and §11 (rate-limit), §13 (implementation contracts)
//
// Flow:
//   1. CORS preflight short-circuit
//   2. Validate body { paper_id: int, pdf_storage_path: string,
//                      provider?: 'gemini' | 'claude' }
//   3. Auth gate via can_synthesize_paper_pal(paper_id) RPC on the
//      caller's JWT (RLS-respecting). Reject 401 (no JWT) / 403 (gated out).
//   4. Rate-limit: read paper_companions.last_synthesis_at; if delta <
//      PAPER_PAL_REGEN_COOLDOWN_SEC, return 429 with Retry-After.
//   5. Open SSE stream → mint signed URL → provider synth → UPSERT.
//   6. On any failure mid-stream, emit `error` event and close.
//
// Side effects: UPSERT paper_companions in a single statement so a crash
// mid-write can't desync regeneration_count from payload (spec §13.6).
import { handlePreflight, corsHeaders } from "../_shared/cors.ts";
import { authClient, serviceClient, extractBearer } from "../_shared/supabase.ts";
import {
  canSynthesizePaperPal,
  currentMemberId,
  getMemberRole,
} from "../_shared/gate.ts";
import { errorResponse } from "../_shared/json.ts";
import { startSseResponse } from "../_shared/sse.ts";
import {
  resolveProvider,
  synthesizePaper,
} from "../../../web/lib/paperpal/providers/index.ts";
import {
  parseAnalyzePaperBody,
  type AnalyzePaperBody,
} from "../../../web/lib/paperpal/edge_helpers/parse_body.ts";
import { cooldownMs } from "../../../web/lib/paperpal/edge_helpers/rate_limit.ts";

const BUCKET = "papers-pdfs";
const SIGNED_URL_TTL_SEC = 60;

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  const origin = req.headers.get("origin");

  if (req.method !== "POST") {
    return errorResponse(origin, 405, "method_not_allowed");
  }

  const jwt = extractBearer(req);
  if (!jwt) return errorResponse(origin, 401, "missing_bearer_token");

  let body: AnalyzePaperBody;
  try {
    body = (await req.json()) as AnalyzePaperBody;
  } catch (_e) {
    return errorResponse(origin, 400, "invalid_json");
  }
  const parsed = parseAnalyzePaperBody(body);
  if (typeof parsed === "string") return errorResponse(origin, 400, parsed);
  const { paperId, pdfPath, provider: bodyProvider } = parsed;

  const sbAuth = authClient(jwt);
  const sbSvc = serviceClient();

  const gate = await canSynthesizePaperPal(sbAuth, paperId);
  if (!gate.canSynthesize) return errorResponse(origin, 403, "forbidden", gate);

  const memberId = await currentMemberId(sbAuth);
  if (memberId == null) return errorResponse(origin, 401, "no_member");

  // Rate-limit pre-check (read-only). The race window between this check
  // and the UPSERT is acceptable: even if two requests slip through, the
  // UPSERT is idempotent — second one just overwrites first.
  const { data: existing, error: existingErr } = await sbSvc
    .from("paper_companions")
    .select("last_synthesis_at")
    .eq("paper_id", paperId)
    .maybeSingle();
  if (existingErr) {
    // A failure here would silently bypass the cooldown. Log loudly and
    // continue — the spec treats rate-limiting as advisory cost-control,
    // not a hard correctness boundary, so a one-off bypass is preferable
    // to refusing all synthesis while paper_companions is unreadable.
    console.error("[analyze-paper] rate-limit pre-check failed:", existingErr);
  }
  if (existing?.last_synthesis_at) {
    const elapsedMs = Date.now() - new Date(existing.last_synthesis_at).getTime();
    const window = cooldownMs(Deno.env.get("PAPER_PAL_REGEN_COOLDOWN_SEC"));
    if (window > 0 && elapsedMs < window) {
      const retryAfter = Math.ceil((window - elapsedMs) / 1000);
      return new Response(
        JSON.stringify({ error: "rate_limited", retry_after_seconds: retryAfter }),
        {
          status: 429,
          headers: {
            ...corsHeaders(origin),
            "Content-Type": "application/json",
            "Retry-After": String(retryAfter),
          },
        },
      );
    }
  }

  // Effective provider: env default unless caller is admin AND provided one.
  const callerRole = await getMemberRole(sbAuth, memberId);
  const effectiveProvider = resolveProvider({
    envDefault: Deno.env.get("PAPER_PAL_PROVIDER"),
    bodyProvider: typeof bodyProvider === "string" ? bodyProvider : undefined,
    callerIsAdmin: callerRole === "admin",
  });

  // Mint a short-lived signed URL for the PDF (service-role only — bucket
  // is not publicly readable). 60s TTL is enough for the provider to fetch.
  const { data: signed, error: signErr } = await sbSvc.storage
    .from(BUCKET)
    .createSignedUrl(pdfPath, SIGNED_URL_TTL_SEC);
  if (signErr || !signed?.signedUrl) {
    return errorResponse(origin, 404, "pdf_not_found", { detail: signErr?.message });
  }

  const sse = startSseResponse(origin);

  // Run in the background so the Response can return immediately.
  (async () => {
    try {
      await sse.stage("parsing_pdf");

      // Title hint helps the provider when the PDF metadata is garbled.
      const { data: paperRow } = await sbSvc
        .from("papers")
        .select("title")
        .eq("id", paperId)
        .maybeSingle();

      await sse.stage("generating_synthesis");

      const { payload, meta } = await synthesizePaper(
        { pdfUrl: signed.signedUrl, paperTitle: paperRow?.title ?? undefined },
        { provider: effectiveProvider },
      );

      await sse.stage("drafting_assessment", {
        provider: meta.provider,
        model: meta.model,
      });

      await sse.stage("persisting");

      // Atomic UPSERT via the upsert_paper_companion RPC (migration 016).
      // Single SQL statement → regeneration_count and payload move together
      // by Postgres semantics (spec §13.6).
      const { error: upErr } = await sbSvc.rpc("upsert_paper_companion", {
        p_paper_id: paperId,
        p_payload: payload,
        p_provider: meta.provider,
        p_model: meta.model,
        p_generated_by: memberId,
      });
      if (upErr) throw new Error(`persist failed: ${upErr.message}`);

      await sse.complete({
        paper_id: paperId,
        provider: meta.provider,
        model: meta.model,
        provider_duration_ms: meta.durationMs,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("[analyze-paper] failure", message);
      await sse.error(message);
    } finally {
      sse.close();
    }
  })();

  return sse.response;
});
