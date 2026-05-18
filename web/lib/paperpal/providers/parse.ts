// Provider-response JSON parser with raw-text-in-error.
//
// Models occasionally emit markdown fences, preambles ("Sure! Here's
// your JSON:"), or truncated payloads when they hit max_tokens. A bare
// JSON.parse throws SyntaxError with no indication of what the model
// actually said — making prod failures undebuggable in Edge Function
// logs that capture only error.message.
//
// This helper includes the first 500 chars of the raw response in the
// thrown error so the on-call person can tell "markdown fence" from
// "truncated mid-object" from "natural-language refusal" at a glance.
export function parseProviderJson<T = unknown>(
  raw: string,
  context: string,
): T {
  try {
    return JSON.parse(raw) as T;
  } catch (e) {
    const head = raw.slice(0, 500).replace(/\s+/g, " ").trim();
    const reason = e instanceof Error ? e.message : String(e);
    throw new Error(`${context}: JSON.parse failed (${reason}) — raw[0:500]: ${head}`);
  }
}
