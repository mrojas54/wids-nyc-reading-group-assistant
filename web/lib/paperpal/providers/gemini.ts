// Gemini provider implementation. Uses the REST API directly via fetch
// (no SDK) so the same module imports cleanly in both Node 18+ and Deno.
//
// Why not the Google SDK: it pulls a Node-only dependency tree (zlib,
// streams) that fails to import in the Deno Edge Function runtime.
// fetch + a typed response shape is ~20 lines and works everywhere.
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
  const pdfBytes = await fetch(input.pdfUrl).then((r) => {
    if (!r.ok) throw new Error(`pdf fetch ${r.status}`);
    return r.arrayBuffer();
  });
  const pdfB64 = arrayBufferToBase64(pdfBytes);
  const prompt = buildSynthesisPrompt({ paperTitle: input.paperTitle });
  const { text, meta } = await callGemini(
    [
      { text: prompt },
      { inlineData: { mimeType: "application/pdf", data: pdfB64 } },
    ],
    { apiKey, model },
  );
  const parsed = researchPaperAnalysisSchema.parse(JSON.parse(text));
  return { payload: parsed, meta };
}

export async function geminiHint(input: HintInput, opts: SynthesizeOpts): Promise<HintResult> {
  const apiKey = requireApiKey();
  const model = opts.model ?? "gemini-2.5-flash";
  const { text, meta } = await callGemini([{ text: buildHintPrompt(input) }], {
    apiKey,
    model,
  });
  const obj = JSON.parse(text) as { hint?: string; confidence?: string };
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
  const obj = JSON.parse(text) as { nextQuestion?: string; summary?: string };
  if (!obj.nextQuestion) throw new Error("gemini socratic missing 'nextQuestion'");
  return { nextQuestion: obj.nextQuestion, summary: obj.summary, meta };
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  // btoa works in both Node 18+ and Deno. For binary, we chunk to avoid
  // "Maximum call stack size exceeded" on multi-MB PDFs.
  const bytes = new Uint8Array(buf);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const sub = bytes.subarray(i, i + chunkSize);
    // String.fromCharCode.apply avoids spreading the typed array, which
    // requires --downlevelIteration in the web tsconfig (ES2017 target).
    binary += String.fromCharCode.apply(null, Array.from(sub) as number[]);
  }
  return btoa(binary);
}
