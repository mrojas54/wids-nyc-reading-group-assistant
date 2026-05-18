// Tiny JSON response helpers used by analyze-hint and analyze-socratic
// (the non-streaming endpoints) — keeps the body builders one-liners.
import { corsHeaders } from "./cors.ts";

export function jsonResponse(
  origin: string | null,
  body: unknown,
  init?: { status?: number; headers?: HeadersInit },
): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

export function errorResponse(
  origin: string | null,
  status: number,
  code: string,
  extra?: Record<string, unknown>,
): Response {
  return jsonResponse(origin, { error: code, ...extra }, { status });
}
