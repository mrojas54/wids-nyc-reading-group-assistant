import 'server-only';
import { resolve } from 'node:path';

export type ScorePassages = (question: string, texts: string[]) => Promise<number[]>;
async function loadModel() {
  const { env, AutoTokenizer, AutoModelForSequenceClassification } = await import('@xenova/transformers');
  env.cacheDir = resolve(process.env.PAPERPAL_MODEL_CACHE || '.paperpal-local/models');
  env.allowLocalModels = false;
  const options = { revision: 'a09144355adeed5f58c8ed011d209bf8ee5a1fec' };
  const [tokenizer, model] = await Promise.all([
    AutoTokenizer.from_pretrained('Xenova/ms-marco-MiniLM-L-6-v2', options),
    AutoModelForSequenceClassification.from_pretrained('Xenova/ms-marco-MiniLM-L-6-v2', { ...options, quantized: true }),
  ]);
  return { tokenizer, model };
}
let loading: ReturnType<typeof loadModel> | undefined;

/** Scores query/document pairs locally. Only the ranking input is normalized/windowed. */
export const scorePassages: ScorePassages = async (question, texts) => {
  if (!question.trim() || question.length > 4000 || texts.length > 100
    || texts.some(t => !t.trim() || t.length > 8000)) throw new Error('Invalid reranker inputs');
  if (!texts.length) return [];
  loading ??= loadModel().catch(error => { loading = undefined; throw error; });
  const { tokenizer, model } = await loading;
  const scores: number[] = [];
  for (let i=0; i<texts.length; i+=8) {
    const batch = texts.slice(i,i+8);
    const result = await model(tokenizer(batch.map(() => question), {
      text_pair: batch.map(text => text.replace(/\s+/g,' ').trim()),
      padding: true, truncation: true, max_length: 512,
    }));
    const logits = result.logits.tolist() as number[][];
    if (logits.length !== batch.length || logits.some(row => row.length !== 1 || !Number.isFinite(row[0]))) throw new Error('Invalid reranker output');
    scores.push(...logits.map(row => row[0]));
  }
  return scores;
};
