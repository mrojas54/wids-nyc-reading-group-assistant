// Gemini provider implementation. Uses the REST API directly via fetch
// (no SDK) so the same module imports cleanly in both Node 18+ and Deno.
//
// Why not the Google SDK: it pulls a Node-only dependency tree (zlib,
// streams) that fails to import in the Deno Edge Function runtime.
// fetch + a typed response shape is ~20 lines and works everywhere.
//
// Relative imports MUST carry the explicit `.ts` extension — Deno requires
// it; the Node/bundler side tolerates it via `allowImportingTsExtensions`.
import { researchPaperAnalysisSchema } from "./schema.ts";
import { buildSynthesisPrompt, buildHintPrompt, buildSocraticPrompt } from "./prompts.ts";
import { parseProviderJson } from "./parse.ts";
import { fetchPdfAsBase64 } from "./pdf.ts";
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

const DEFAULT_MODEL = "gemini-2.5-pro";
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

type GeminiPart =
  | { text: string }
  | { fileData: { mimeType: string; fileUri: string } }
  | { inlineData: { mimeType: string; data: string } };

type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
  error?: { message?: string };
};

async function callGemini(
  parts: GeminiPart[],
  opts: { apiKey: string; model: string; responseMimeType?: string },
): Promise<{ text: string; meta: ProviderMeta }> {
  const url = `${ENDPOINT}/${opts.model}:generateContent?key=${encodeURIComponent(opts.apiKey)}`;
  const body = {
    contents: [{ role: "user", parts }],
    generationConfig: {
      responseMimeType: opts.responseMimeType ?? "application/json",
      // 0.4 — high enough for varied phrasing on regeneration, low enough
      // to keep JSON well-formed and quiz answers consistent across runs.
      temperature: 0.4,
    },
  };
  const startedAt = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const durationMs = Date.now() - startedAt;
  const json = (await res.json()) as GeminiResponse;
  if (!res.ok || json.error) {
    throw new Error(`gemini ${res.status}: ${json.error?.message ?? res.statusText}`);
  }
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  if (!text) throw new Error("gemini returned empty candidate");
  return {
    text,
    meta: {
      provider: "gemini",
      model: opts.model,
      durationMs,
      inputTokens: json.usageMetadata?.promptTokenCount ?? null,
      outputTokens: json.usageMetadata?.candidatesTokenCount ?? null,
    },
  };
}

function requireApiKey(): string {
  // Cross-runtime env access. Deno has globalThis.Deno; Node has process.env.
  const denoKey = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } })
    .Deno?.env.get("GEMINI_API_KEY");
  const nodeKey = (globalThis as { process?: { env: Record<string, string | undefined> } })
    .process?.env?.GEMINI_API_KEY;
  const key = denoKey ?? nodeKey;
  if (!key) throw new Error("GEMINI_API_KEY not set");
  return key;
}

export async function geminiSynthesize(
  input: SynthesizePaperInput,
  opts: SynthesizeOpts,
): Promise<SynthesizePaperResult> {
  const apiKey = requireApiKey();
  const model = opts.model ?? DEFAULT_MODEL;
  // Fetch the PDF via signed URL → inline as base64 in the request.
  // Gemini also supports fileData with a fileUri, but signed Supabase
  // Storage URLs return application/pdf with a query-string token that
  // Gemini's fetcher doesn't always accept; base64 inline is reliable
  // up to its ~20 MB request cap and our PDFs are ~5 MB.
  const pdfB64 = await fetchPdfAsBase64(input.pdfUrl);
  const prompt = buildSynthesisPrompt({ paperTitle: input.paperTitle });
  const { text, meta } = await callGemini(
    [
      { text: prompt },
      { inlineData: { mimeType: "application/pdf", data: pdfB64 } },
    ],
    { apiKey, model },
  );
  const parsed = researchPaperAnalysisSchema.parse(
    parseProviderJson(text, "geminiSynthesize"),
  );
  return { payload: parsed, meta };
}

export async function geminiHint(input: HintInput, opts: SynthesizeOpts): Promise<HintResult> {
  const apiKey = requireApiKey();
  const model = opts.model ?? "gemini-2.5-flash";
  const { text, meta } = await callGemini([{ text: buildHintPrompt(input) }], {
    apiKey,
    model,
  });
  const obj = parseProviderJson<{ hint?: string; confidence?: string }>(text, "geminiHint");
  if (!obj.hint) throw new Error("gemini hint missing 'hint' field");
  return {
    hint: obj.hint,
    confidence: (obj.confidence === "low" || obj.confidence === "high")
      ? obj.confidence
      : "medium",
    meta,
  };
}

export async function geminiSocratic(
  input: SocraticInput,
  opts: SynthesizeOpts,
): Promise<SocraticResult> {
  const apiKey = requireApiKey();
  const model = opts.model ?? "gemini-2.5-flash";
  const { text, meta } = await callGemini([{ text: buildSocraticPrompt(input) }], {
    apiKey,
    model,
  });
  const obj = parseProviderJson<{ nextQuestion?: string; summary?: string }>(
    text,
    "geminiSocratic",
  );
  if (!obj.nextQuestion) throw new Error("gemini socratic missing 'nextQuestion'");
  return { nextQuestion: obj.nextQuestion, summary: obj.summary, meta };
}

