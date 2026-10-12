import 'server-only';
import type { PassageSource } from './turbopuffer.mts';

export function retrievalBackend(env: Record<string, string | undefined>) {
  const backend = env.PAPERPAL_RETRIEVAL_BACKEND ?? 'supabase';
  if (backend !== 'supabase' && backend !== 'turbopuffer') throw new Error('Invalid PAPERPAL_RETRIEVAL_BACKEND');
  return backend;
}

/** Explicit env input keeps local credentials separate from the production Next environment. */
export async function createConfiguredPassageIndex(env: Record<string, string | undefined>, source: PassageSource) {
  if (retrievalBackend(env) === 'turbopuffer') {
    const { createPassageIndex, readTurbopufferConfig } = await import('./turbopuffer.mts');
    return createPassageIndex(readTurbopufferConfig(env), source);
  }
  const { createSupabasePassageIndex } = await import('./supabase.mts');
  const { embedPassages } = await import('./local-embeddings.mts');
  const url = env.PAPERPAL_SUPABASE_URL;
  const apiKey = env.PAPERPAL_SUPABASE_KEY;
  if (!url || !apiKey) throw new Error('Missing PAPERPAL_SUPABASE_URL or PAPERPAL_SUPABASE_KEY');
  return createSupabasePassageIndex({ url, apiKey, accessToken: env.PAPERPAL_SUPABASE_ACCESS_TOKEN || apiKey }, source, embedPassages);
}
