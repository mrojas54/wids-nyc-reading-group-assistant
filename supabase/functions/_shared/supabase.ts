// Supabase client factories for Edge Functions.
//
// Two clients per request, deliberately separated:
//   - authClient: built from the caller's JWT (Authorization: Bearer ...).
//     Respects RLS. Used for all caller-identity queries (the gate RPC,
//     role lookups, attendance checks) so that auth.uid() resolves to the
//     calling member inside each query and RLS policies fire normally.
//   - serviceClient: built from SUPABASE_SERVICE_ROLE_KEY. Bypasses RLS.
//     Used for side-effect writes (UPSERT paper_companions, INSERT
//     paper_socratic_turns) — these need to write even when the caller
//     can't directly write the row (RLS blocks member-context inserts).
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function requireEnv(key: string): string {
  const v = Deno.env.get(key);
  if (!v) throw new Error(`${key} not set`);
  return v;
}

export function getSupabaseUrl(): string {
  return requireEnv("SUPABASE_URL");
}

export function authClient(jwt: string): SupabaseClient {
  return createClient(getSupabaseUrl(), requireEnv("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function serviceClient(): SupabaseClient {
  return createClient(getSupabaseUrl(), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function extractBearer(req: Request): string | null {
  const h = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!h) return null;
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}
