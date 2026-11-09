// Request plumbing shared by claude.ts and gemini.ts: reading the API key,
// sending the request, and turning the model's JSON text into a result.
// Each provider keeps only what differs (endpoint, headers, body shape and
// where the text and token counts sit in the response), so a fix to how
// requests are sent lands in both.
//
// Imported by the Deno edge functions through index.ts, so it must stay free
// of Node-only APIs, and relative imports carry the `.ts` extension.
import { researchPaperAnalysisSchema } from "./schema.ts";
import { parseProviderJson } from "./parse.ts";
import type {
  HintResult,
  Provider,
  ProviderMeta,
  SocraticResult,
  SynthesizePaperResult,
} from "./types.ts";

/** Reads an API key from Deno.env or process.env; throws when it is unset. */
export function requireEnvKey(name: string): string {
  const denoKey = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } })
    .Deno?.env.get(name);
  const nodeKey = (globalThis as { process?: { env: Record<string, string | undefined> } })
    .process?.env?.[name];
  const key = denoKey ?? nodeKey;
  if (!key) throw new Error(`${name} not set`);
  return key;
}

type ErrorBody = { error?: { message?: string } };

/**
 * POSTs a JSON body and returns the parsed response with the call's duration.
 * A non-2xx status or an `error` field throws "<provider> <status>: <message>".
 * An error page that is not JSON (a gateway's HTML 502, say) still throws
 * that message, using the status text, rather than a JSON SyntaxError.
 */
export async function postJson<T extends ErrorBody>(
  provider: Provider,
  url: string,
  init: { headers: Record<string, string>; body: unknown; signal?: AbortSignal },
): Promise<{ json: T; durationMs: number }> {
  const startedAt = Date.now();
  const res = await fetch(url, {
    method: "POST",
    signal: init.signal,
    headers: init.headers,
    body: JSON.stringify(init.body),
  });
  const durationMs = Date.now() - startedAt;
  const raw = await res.text();
  let json: T | null = null;
  try {
    json = JSON.parse(raw) as T;
  } catch {
    if (res.ok) {
      throw new Error(`${provider} ${res.status}: response was not JSON`);
    }
  }
  if (!res.ok || !json || json.error) {
    throw new Error(`${provider} ${res.status}: ${json?.error?.message ?? res.statusText}`);
  }
  return { json, durationMs };
}

/** The provider's text output as a validated paper analysis. */
export function toSynthesisResult(
  text: string,
  meta: ProviderMeta,
  context: string,
): SynthesizePaperResult {
  const payload = researchPaperAnalysisSchema.parse(parseProviderJson(text, context));
  return { payload, meta };
}

/** The provider's text output as a hint; an unknown confidence becomes "medium". */
export function toHintResult(text: string, meta: ProviderMeta, context: string): HintResult {
  const obj = parseProviderJson<{ hint?: string; confidence?: string }>(text, context);
  if (!obj.hint) throw new Error(`${meta.provider} hint missing 'hint' field`);
  return {
    hint: obj.hint,
    confidence: obj.confidence === "low" || obj.confidence === "high"
      ? obj.confidence
      : "medium",
    meta,
  };
}

/** The provider's text output as the tutor's next turn. */
export function toSocraticResult(
  text: string,
  meta: ProviderMeta,
  context: string,
): SocraticResult {
  const obj = parseProviderJson<{ nextQuestion?: string; summary?: string }>(text, context);
  if (!obj.nextQuestion) throw new Error(`${meta.provider} socratic missing 'nextQuestion'`);
  return { nextQuestion: obj.nextQuestion, summary: obj.summary, meta };
}
