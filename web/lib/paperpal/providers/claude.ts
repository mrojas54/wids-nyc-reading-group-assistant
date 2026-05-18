// Claude provider implementation. Uses the Anthropic Messages REST API
// directly via fetch (no SDK) for the same cross-runtime reason as gemini.ts.
//
// Prompt caching is enabled on the system prompt via cache_control, per
// the claude-api skill recommendation — synthesis re-runs on the same
// paper hit the cache for ~90% input-token cost savings.
import { researchPaperAnalysisSchema } from "./schema";
import { buildSynthesisPrompt, buildHintPrompt, buildSocraticPrompt } from "./prompts";
import type {
  HintInput,
  HintResult,
  ProviderMeta,
  SocraticInput,
  SocraticResult,
  SynthesizeOpts,
  SynthesizePaperInput,
  SynthesizePaperResult,
} from "./types";

const DEFAULT_MODEL = "claude-sonnet-4-7";
const ENDPOINT = "https://api.anthropic.com/v1/messages";

type ClaudeContentBlock =
  | { type: "text"; text: string; cache_control?: { type: "ephemeral" } }
  | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } }
  | { type: "document"; source: { type: "url"; url: string } };

type ClaudeResponse = {
  content?: Array<{ type: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string };
};

async function callClaude(
  content: ClaudeContentBlock[],
  opts: { apiKey: string; model: string; maxTokens: number; system: string },
): Promise<{ text: string; meta: ProviderMeta }> {
  const body = {
    model: opts.model,
    max_tokens: opts.maxTokens,
    // Cache the system prompt — it's identical across regenerations
    // and across papers, which is the biggest hit-rate win we can get.
    system: [
      { type: "text", text: opts.system, cache_control: { type: "ephemeral" } },
    ],
    messages: [{ role: "user", content }],
  };
  const startedAt = Date.now();
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "x-api-key": opts.apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const durationMs = Date.now() - startedAt;
  const json = (await res.json()) as ClaudeResponse;
  if (!res.ok || json.error) {
    throw new Error(`claude ${res.status}: ${json.error?.message ?? res.statusText}`);
  }
  const text = json.content?.find((b) => b.type === "text")?.text ?? "";
  if (!text) throw new Error("claude returned no text block");
  return {
    text,
    meta: {
      provider: "claude",
      model: opts.model,
      durationMs,
      inputTokens: json.usage?.input_tokens ?? null,
      outputTokens: json.usage?.output_tokens ?? null,
    },
  };
}

function requireApiKey(): string {
  const denoKey = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } })
    .Deno?.env.get("ANTHROPIC_API_KEY");
  const nodeKey = (globalThis as { process?: { env: Record<string, string | undefined> } })
    .process?.env?.ANTHROPIC_API_KEY;
  const key = denoKey ?? nodeKey;
  if (!key) throw new Error("ANTHROPIC_API_KEY not set");
  return key;
}

const SYSTEM_PROMPT = `You are Paper Pal, a study companion that converts a research paper PDF into a structured ResearchPaperAnalysis JSON object. You must respond with valid JSON only — no markdown fences, no preamble, no trailing commentary. Schema validation is enforced server-side, so a malformed response is discarded.`;

export async function claudeSynthesize(
  input: SynthesizePaperInput,
  opts: SynthesizeOpts,
): Promise<SynthesizePaperResult> {
  const apiKey = requireApiKey();
  const model = opts.model ?? DEFAULT_MODEL;
  // Claude accepts PDFs as a URL-source document up to 32MB; signed
  // Supabase URLs work directly here, so we skip the base64 download
  // hop the Gemini path needs.
  const userPrompt = buildSynthesisPrompt({ paperTitle: input.paperTitle });
  const { text, meta } = await callClaude(
    [
      { type: "document", source: { type: "url", url: input.pdfUrl } },
      { type: "text", text: userPrompt },
    ],
    { apiKey, model, maxTokens: 16000, system: SYSTEM_PROMPT },
  );
  const parsed = researchPaperAnalysisSchema.parse(JSON.parse(text));
  return { payload: parsed, meta };
}

export async function claudeHint(input: HintInput, opts: SynthesizeOpts): Promise<HintResult> {
  const apiKey = requireApiKey();
  const model = opts.model ?? "claude-haiku-4-5-20251001";
  const { text, meta } = await callClaude(
    [{ type: "text", text: buildHintPrompt(input) }],
    { apiKey, model, maxTokens: 512, system: SYSTEM_PROMPT },
  );
  const obj = JSON.parse(text) as { hint?: string; confidence?: string };
  if (!obj.hint) throw new Error("claude hint missing 'hint' field");
  return {
    hint: obj.hint,
    confidence: (obj.confidence === "low" || obj.confidence === "high")
      ? obj.confidence
      : "medium",
    meta,
  };
}

export async function claudeSocratic(
  input: SocraticInput,
  opts: SynthesizeOpts,
): Promise<SocraticResult> {
  const apiKey = requireApiKey();
  const model = opts.model ?? "claude-haiku-4-5-20251001";
  const { text, meta } = await callClaude(
    [{ type: "text", text: buildSocraticPrompt(input) }],
    { apiKey, model, maxTokens: 1024, system: SYSTEM_PROMPT },
  );
  const obj = JSON.parse(text) as { nextQuestion?: string; summary?: string };
  if (!obj.nextQuestion) throw new Error("claude socratic missing 'nextQuestion'");
  return { nextQuestion: obj.nextQuestion, summary: obj.summary, meta };
}
