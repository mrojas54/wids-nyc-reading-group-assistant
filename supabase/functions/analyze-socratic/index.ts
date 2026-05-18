// analyze-socratic — next-turn Socratic conversation about a paper.
//
// Spec: docs/superpowers/specs/2026-05-17-paper-pal-edge-functions.md §4.3
//
// Gate: same as analyze-hint — attending RSVP for any meeting using this
// paper (operator/admin always pass).
//
// Side effect: append a row to paper_socratic_turns capturing the user's
// response + the AI's next_question + provider/model. RLS blocks direct
// member-context inserts; we use the service-role client.
import { handlePreflight } from "../_shared/cors.ts";
import { authClient, serviceClient, extractBearer } from "../_shared/supabase.ts";
import { canRequestHint, currentMemberId } from "../_shared/gate.ts";
import { errorResponse, jsonResponse } from "../_shared/json.ts";
import {
  nextSocraticTurn,
  resolveProvider,
} from "../../../web/lib/paperpal/providers/index.ts";

type HistoryEntry = { role?: unknown; text?: unknown };

type Body = {
  paper_id?: unknown;
  prompt_id?: unknown;
  prompt_topic?: unknown;
  opening_question?: unknown;
  scripted_probes?: unknown;
  history?: unknown;
  user_response?: unknown;
  turn_number?: unknown;
};

function parseHistory(raw: unknown): Array<{ role: "ai" | "user"; text: string }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((e): e is HistoryEntry => e !== null && typeof e === "object")
    .map((e) => ({
      role: e.role === "ai" ? "ai" : "user",
      text: typeof e.text === "string" ? e.text : "",
    }))
    .filter((e) => e.text);
}

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
  const promptId = typeof body.prompt_id === "string" ? body.prompt_id : "";
  const promptTopic = typeof body.prompt_topic === "string" ? body.prompt_topic : "";
  const openingQuestion = typeof body.opening_question === "string" ? body.opening_question : "";
  const userResponse = typeof body.user_response === "string" ? body.user_response : "";
  const turnNumber = typeof body.turn_number === "number" ? body.turn_number : NaN;
  if (!promptId || !promptTopic || !openingQuestion || !userResponse) {
    return errorResponse(origin, 400, "missing_required_field");
  }
  if (!Number.isInteger(turnNumber) || turnNumber <= 0) {
    return errorResponse(origin, 400, "turn_number_must_be_positive_int");
  }
  const scriptedProbes = Array.isArray(body.scripted_probes)
    ? body.scripted_probes.filter((s): s is string => typeof s === "string")
    : [];
  const history = parseHistory(body.history);

  const sbAuth = authClient(jwt);
  const sbSvc = serviceClient();

  const memberId = await currentMemberId(sbAuth);
  if (memberId == null) return errorResponse(origin, 401, "no_member");

  const allowed = await canRequestHint(sbAuth, paperId, memberId);
  if (!allowed) return errorResponse(origin, 403, "not_attending_meeting_for_paper");

  const { data: paperRow } = await sbAuth
    .from("papers")
    .select("title")
    .eq("id", paperId)
    .maybeSingle();

  const provider = resolveProvider({
    envDefault: Deno.env.get("PAPER_PAL_PROVIDER"),
    callerIsAdmin: false,
  });

  try {
    const result = await nextSocraticTurn(
      {
        paperTitle: paperRow?.title ?? "this paper",
        promptTopic,
        openingQuestion,
        scriptedProbes,
        history,
        userResponse,
        turnNumber,
      },
      { provider },
    );

    // Append transcript row via service-role (RLS blocks member inserts).
    const { error: insErr } = await sbSvc.from("paper_socratic_turns").insert({
      paper_id: paperId,
      member_id: memberId,
      prompt_id: promptId,
      turn_number: turnNumber,
      user_response: userResponse,
      ai_next_question: result.nextQuestion,
      ai_summary: result.summary ?? null,
      provider: result.meta.provider,
      model: result.meta.model,
    });
    if (insErr) {
      // Don't fail the user-facing response over a transcript log miss —
      // log to stderr and still return the next question.
      console.error("[analyze-socratic] transcript insert failed", insErr.message);
    }

    return jsonResponse(origin, {
      next_question: result.nextQuestion,
      summary: result.summary ?? null,
      provider: result.meta.provider,
      model: result.meta.model,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[analyze-socratic] failure", message);
    return errorResponse(origin, 502, "provider_failed", { detail: message });
  }
});
