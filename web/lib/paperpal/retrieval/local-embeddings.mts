import 'server-only';
import { resolve } from 'node:path';
import type { FeatureExtractionPipeline } from '@xenova/transformers';

let loading: Promise<FeatureExtractionPipeline> | undefined;
async function extractor() {
  if (!loading) {
    loading = (async () => {
      const { env, pipeline } = await import('@xenova/transformers');
      env.cacheDir = resolve(process.env.PAPERPAL_MODEL_CACHE || '.paperpal-local/models');
      env.allowLocalModels = false;
      return pipeline('feature-extraction', 'Supabase/gte-small', {
        revision: '93b36ff09519291b77d6000d2e86bd8565378086', quantized: true,
      });
    })().catch(error => { loading = undefined; throw error; });
  }
  return loading;
}

/** Runs on this machine; only model artifacts are downloaded. No text leaves for inference. */
export async function embedPassages(texts: string[]): Promise<number[][]> {
  if (!texts.length || texts.length > 2000 || texts.some(t => !t.trim() || t.length > 8000)) throw new Error('Invalid embedding inputs');
  const model = await extractor();
  // gte-small has a 512-token context. Never silently drop the end of a passage.
  for (const text of texts) {
    if (model.tokenizer.encode(text).length > 512) throw new Error('Passage or query exceeds the 512-token embedding window; shorten it before indexing');
  }
  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += 8) {
    const result = await model(texts.slice(i, i + 8), { pooling: 'mean', normalize: true });
    vectors.push(...result.tolist() as number[][]);
  }
  return vectors;
}
