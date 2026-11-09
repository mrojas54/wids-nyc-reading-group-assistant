// Claude provider implementation. Uses the Anthropic Messages REST API
// directly via fetch (no SDK) for the same cross-runtime reason as gemini.ts.
//
// Relative imports MUST carry the explicit `.ts` extension — Deno requires
// it; the Node/bundler side tolerates it via `allowImportingTsExtensions`.
//
// Prompt caching is enabled on the system prompt via cache_control, per
// the claude-api skill recommendation — synthesis re-runs on the same
// paper hit the cache for ~90% input-token cost savings.
import { buildSynthesisPrompt, buildHintPrompt, buildSocraticPrompt } from "./prompts.ts";
import { fetchPdfAsBase64 } from "./pdf.ts";
import {
  postJson,
  requireEnvKey,
  toHintResult,
  toSocraticResult,
  toSynthesisResult,
} from "./shared.ts";
import type {
  HintInput,
  HintResult,
  ProviderMeta,
  SocraticInput,
  SocraticResult,
  SynthesizeOpts,
  SynthesizePaperInput,
  SynthesizePaperResult,
} from "./types.ts";

const DEFAULT_MODEL = "claude-sonnet-4-7";
const ENDPOINT = "https://api.anthropic.com/v1/messages";

type ClaudeContentBlock =
  | { type: "text"; text: string; cache_control?: { type: "ephemeral" } }
  | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } };

type ClaudeResponse = {
  content?: Array<{ type: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string };
};

async function callClaude(
  content: ClaudeContentBlock[],
  opts: { apiKey: string; model: string; maxTokens: number; system: string; signal?: AbortSignal },
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
  const { json, durationMs } = await postJson<ClaudeResponse>("claude", ENDPOINT, {
    signal: opts.signal,
    headers: {
      "x-api-key": opts.apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body,
  });
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

const SYSTEM_PROMPT = `You are Paper Pal, a study companion that converts a research paper PDF into a structured ResearchPaperAnalysis JSON object. You must respond with valid JSON only — no markdown fences, no preamble, no trailing commentary. Schema validation is enforced server-side, so a malformed response is discarded.`;

export async function claudeSynthesize(
  input: SynthesizePaperInput,
  opts: SynthesizeOpts,
): Promise<SynthesizePaperResult> {
  const apiKey = requireEnvKey("ANTHROPIC_API_KEY");
  const model = opts.model ?? DEFAULT_MODEL;
  // Download the PDF ourselves and pass it inline as base64. Anthropic's
  // url-source document fetcher runs server-side and can race past the
  // 60s signed-URL TTL when their API is queued; base64 consumes the
  // signed URL immediately so expiry can't bite us. Cost is one extra
  // hop on our side (~5MB transfer).
  const pdfB64 = await fetchPdfAsBase64(input.pdfUrl);
  const userPrompt = buildSynthesisPrompt({ paperTitle: input.paperTitle });
  const { text, meta } = await callClaude(
    [
      {
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: pdfB64 },
      },
      { type: "text", text: userPrompt },
    ],
    { apiKey, model, maxTokens: 16000, system: SYSTEM_PROMPT },
  );
  return toSynthesisResult(text, meta, "claudeSynthesize");
}

export async function claudeHint(input: HintInput, opts: SynthesizeOpts): Promise<HintResult> {
  const apiKey = requireEnvKey("ANTHROPIC_API_KEY");
  const model = opts.model ?? "claude-haiku-4-5-20251001";
  const { text, meta } = await callClaude(
    [{ type: "text", text: buildHintPrompt(input) }],
    { apiKey, model, maxTokens: 512, system: SYSTEM_PROMPT, signal: opts.signal },
  );
  return toHintResult(text, meta, "claudeHint");
}

export async function claudeSocratic(
  input: SocraticInput,
  opts: SynthesizeOpts,
): Promise<SocraticResult> {
  const apiKey = requireEnvKey("ANTHROPIC_API_KEY");
  const model = opts.model ?? "claude-haiku-4-5-20251001";
  const { text, meta } = await callClaude(
    [{ type: "text", text: buildSocraticPrompt(input) }],
    { apiKey, model, maxTokens: 1024, system: SYSTEM_PROMPT, signal: opts.signal },
  );
  return toSocraticResult(text, meta, "claudeSocratic");
}
