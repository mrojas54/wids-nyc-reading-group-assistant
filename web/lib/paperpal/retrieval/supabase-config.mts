import 'server-only';

export type SupabaseSearchConfig = { url: string; apiKey: string; accessToken: string };

/** True for a secret API key or a legacy JWT key whose role is service_role. Either bypasses RLS. */
export function isServiceCredential(token: string) {
  if (token.startsWith('sb_secret_')) return true;
  const payload = token.split('.')[1];
  if (!payload) return false;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))?.role === 'service_role';
  } catch { return false; }
}

/** Search reads as a member; it never falls back to the API key or the ingestion key. */
export function readSupabaseSearchConfig(env: Record<string, string | undefined>): SupabaseSearchConfig {
  const url = env.PAPERPAL_SUPABASE_URL;
  const apiKey = env.PAPERPAL_SUPABASE_KEY;
  const accessToken = env.PAPERPAL_SUPABASE_ACCESS_TOKEN;
  if (!url || !apiKey || !accessToken) {
    throw new Error('Missing PAPERPAL_SUPABASE_URL, PAPERPAL_SUPABASE_KEY, or PAPERPAL_SUPABASE_ACCESS_TOKEN');
  }
  if (accessToken === apiKey || isServiceCredential(accessToken)) {
    throw new Error('Passage search requires a member access token, not an API or service-role key');
  }
  return { url, apiKey, accessToken };
}

/** Ingestion is explicit: only the index command reads the service-role key. */
export function readSupabaseIngestionConfig(env: Record<string, string | undefined>): SupabaseSearchConfig {
  const url = env.PAPERPAL_SUPABASE_URL;
  const serviceKey = env.PAPERPAL_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error('Missing PAPERPAL_SUPABASE_URL or PAPERPAL_SUPABASE_SERVICE_ROLE_KEY');
  return { url, apiKey: serviceKey, accessToken: serviceKey };
}
