// analyze-hint — Socratic-style hint for an MCQ attempt.
//
// Spec: docs/superpowers/specs/2026-05-17-paper-pal-edge-functions.md §4.2
//
// Gate: any signed-in member with an 'attending' RSVP for a meeting that
// uses this paper. Looser than analyze-paper because reading-group members
// should be able to ask for hints on their own attempts.
//
// Side effects: NONE. Pure response. We do NOT log hints to the DB; if a
// future audit need arises, add it as a new table in a later migration.
import { handlePreflight } from "../_shared/cors.ts";
import { authClient, extractBearer } from "../_shared/supabase.ts";
import { canRequestHint, currentMemberId } from "../_shared/gate.ts";
import { errorResponse, jsonResponse } from "../_shared/json.ts";
import {
  generateHint,
  resolveProvider,
} from "../../../web/lib/paperpal/providers/index.ts";

type Body = {
  paper_id?: unknown;
  question_text?: unknown;
  question_options?: unknown;
  user_answer?: unknown;
};

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  const origin = req.headers.get("origin");

  if (req.method !== "POST") return errorResponse(origin, 405, "method_not_allowed");

  const jwt = extractBearer(req);
  if (!jwt) return errorResponse(origin, 401, "missing_bearer_token");

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch (_e) {
    return errorResponse(origin, 400, "invalid_json");
  }

  const paperId = typeof body.paper_id === "number" ? body.paper_id : NaN;
  if (!Number.isInteger(paperId) || paperId <= 0) {
    return errorResponse(origin, 400, "paper_id_required");
  }
  const questionText = typeof body.question_text === "string" ? body.question_text : "";
  const userAnswer = typeof body.user_answer === "string" ? body.user_answer : "";
  if (!questionText || !userAnswer) {
    return errorResponse(origin, 400, "question_text_and_user_answer_required");
  }
  const questionOptions = Array.isArray(body.question_options)
    ? body.question_options.filter((s): s is string => typeof s === "string")
    : undefined;

  const sb = authClient(jwt);
  const memberId = await currentMemberId(sb);
  if (memberId == null) return errorResponse(origin, 401, "no_member");

  const allowed = await canRequestHint(sb, paperId, memberId);
  if (!allowed) return errorResponse(origin, 403, "not_attending_meeting_for_paper");

  // Title hint for the prompt — best-effort.
  const { data: paperRow } = await sb
    .from("papers")
    .select("title")
    .eq("id", paperId)
    .maybeSingle();

  const provider = resolveProvider({
    envDefault: Deno.env.get("PAPER_PAL_PROVIDER"),
    callerIsAdmin: false,
  });

  try {
    const result = await generateHint(
      {
        paperTitle: paperRow?.title ?? "this paper",
        questionText,
        questionOptions,
        userAnswer,
      },
      { provider },
    );
    return jsonResponse(origin, {
      hint: result.hint,
      confidence: result.confidence,
      provider: result.meta.provider,
      model: result.meta.model,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[analyze-hint] failure", message);
    return errorResponse(origin, 502, "provider_failed", { detail: message });
  }
});
