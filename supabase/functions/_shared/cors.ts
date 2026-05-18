// CORS headers + preflight handler for the three analyze-* Edge Functions.
// The portal calls these from the same origin in prod (rewritten via
// Next.js middleware), but Vercel preview deployments and local dev call
// the supabase.co function URL directly — so we accept any origin and
// echo it back, which is safe for endpoints that require a Bearer token
// anyway (no cookie auth, no CSRF surface).

const ALLOWED_HEADERS = [
  "authorization",
  "content-type",
  "x-client-info",
  "apikey",
].join(", ");

export function corsHeaders(origin: string | null): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": ALLOWED_HEADERS,
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

export function handlePreflight(req: Request): Response | null {
  if (req.method !== "OPTIONS") return null;
  return new Response(null, {
    status: 204,
    headers: corsHeaders(req.headers.get("origin")),
  });
}
