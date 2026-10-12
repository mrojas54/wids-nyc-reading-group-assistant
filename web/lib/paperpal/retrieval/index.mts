import 'server-only';
import type { PassageSource } from './turbopuffer.mts';
import { readSupabaseIngestionConfig, readSupabaseSearchConfig } from './supabase-config.mts';

export function retrievalBackend(env: Record<string, string | undefined>) {
  const backend = env.PAPERPAL_RETRIEVAL_BACKEND ?? 'supabase';
  if (backend !== 'supabase' && backend !== 'turbopuffer') throw new Error('Invalid PAPERPAL_RETRIEVAL_BACKEND');
  return backend;
}

/**
 * Explicit env input keeps local credentials separate from the production Next environment.
 * Search needs a member access token; only 'index' reads the service-role key.
 */
export async function createConfiguredPassageIndex(env: Record<string, string | undefined>, source: PassageSource,
  purpose: 'search' | 'index') {
  if (retrievalBackend(env) === 'turbopuffer') {
    const { createPassageIndex, readTurbopufferConfig } = await import('./turbopuffer.mts');
    return createPassageIndex(readTurbopufferConfig(env), source);
  }
  const config = purpose === 'index' ? readSupabaseIngestionConfig(env) : readSupabaseSearchConfig(env);
  const { createSupabasePassageIndex } = await import('./supabase.mts');
  const { embedPassages } = await import('./local-embeddings.mts');
  return createSupabasePassageIndex(config, source, embedPassages);
}
