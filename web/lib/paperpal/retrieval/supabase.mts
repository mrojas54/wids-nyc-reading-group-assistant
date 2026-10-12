import 'server-only';
import { z } from 'zod';
import { scorePassages, type ScorePassages } from './local-reranker.mts';
import { rankPassages } from './reranking.mts';
import { lexicalQuery } from './candidates.mts';

export const PASSAGE_MODEL = 'gte-small-93b36ff-mean-normalized-v1';
export type EmbedPassages = (texts: string[]) => Promise<number[][]>;
export type SupabaseSearchConfig = { url: string; apiKey: string; accessToken: string };
const sourceSchema = z.object({ paperId: z.number().int().positive().safe(), sourceVersionId: z.string().regex(/^[a-f0-9]{64}$/) });
const vectorSchema = z.array(z.number().finite()).length(384).refine(v => v.some(n => n !== 0));
const passageSchema = z.object({ id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  page: z.number().int().positive(), text: z.string().min(1).max(8000).refine(s => s.trim().length > 0),
  start: z.number().int().nonnegative(), end: z.number().int().positive(),
}).refine(p => p.end - p.start === p.text.length);
const hitSchema = z.object({ id: z.string(), paper_id: z.number(), source_version: z.string(),
  page: z.number().int().positive(), text: z.string(), start_offset: z.number().int().nonnegative(),
  end_offset: z.number().int().positive(), score: z.number().finite() });

/** Pass a member access token for application reads; service credentials are for explicit ingestion only. */
export function createSupabasePassageIndex(config: SupabaseSearchConfig, inputSource: z.infer<typeof sourceSchema>,
  embed: EmbedPassages, fetcher: typeof fetch = fetch, rerank: ScorePassages = scorePassages) {
  const source = sourceSchema.safeParse(inputSource);
  const url = new URL(config.url);
  if (!source.success || !config.apiKey.trim() || !config.accessToken.trim()
    || url.username || url.password || url.search || url.hash || url.pathname !== '/'
    || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
    throw new Error('Invalid Supabase passage configuration');
  }
  const { paperId, sourceVersionId } = source.data;
  async function request(path: string, method: 'GET' | 'POST', body?: unknown): Promise<unknown> {
    let res: Response;
    try {
      res = await fetcher(`${url.origin}/rest/v1/${path}`, {
        method, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(30_000),
        headers: { apikey: config.apiKey, Authorization: `Bearer ${config.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch { throw new Error('Supabase network or timeout failure'); }
    if (!res.ok) { await res.body?.cancel(); throw new Error(`Supabase HTTP ${res.status}`); }
    try { return await res.json(); } catch { throw new Error('Invalid Supabase response'); }
  }
  const rpc = (name: string, body: unknown) => request(`rpc/${name}`, 'POST', body);
  async function embeddings(texts: string[]) {
    const result = z.array(vectorSchema).length(texts.length).safeParse(await embed(texts));
    if (!result.success) throw new Error('Invalid passage embedding');
    return result.data;
  }
  return {
    async upsertPassages(input: z.infer<typeof passageSchema>[]) {
      const parsed = z.array(passageSchema).min(1).max(2000).safeParse(input);
      if (!parsed.success) throw new Error('Invalid passage batch');
      if (new Set(parsed.data.map(p => p.id)).size !== parsed.data.length) throw new Error('Duplicate passage IDs');
      const vectors = await embeddings(parsed.data.map(p => p.text));
      const count = await rpc('index_paper_passages', { p_paper_id: paperId, p_source_version: sourceVersionId,
        p_model: PASSAGE_MODEL, p_passages: parsed.data.map((p, i) => ({ ...p, embedding: vectors[i] })) });
      if (count !== parsed.data.length) throw new Error('Invalid Supabase write response');
      return { rows_affected: count };
    },
    async retrievePassages(input: { question: string; limit?: number }) {
      const parsed = z.object({ question: z.string().trim().min(1).max(4000), limit: z.number().int().min(1).max(100).default(8) }).safeParse(input);
      if (!parsed.success) throw new Error('Invalid passage query');
      const keywords = lexicalQuery(parsed.data.question);
      const candidateLimit = keywords ? Math.max(8, parsed.data.limit)
        : Math.min(100, Math.max(64, parsed.data.limit * 4));
      const lexicalLimit = keywords ? Math.min(8, 100-candidateLimit) : 0;
      // Both paths use the same caller token and exact paper/source scope.
      // Keyword lookup overlaps query embedding work; no response cache bypasses RLS.
      const [vectors, lexicalResult] = await Promise.all([
        embeddings([parsed.data.question]),
        lexicalLimit ? request(`paper_passages?${new URLSearchParams({
          paper_id: `eq.${paperId}`, source_version: `eq.${sourceVersionId}`,
          select: 'id,paper_id,source_version,page,text,start_offset,end_offset',
          fts: `wfts(english).${keywords}`, order: 'page.asc,start_offset.asc', limit: String(lexicalLimit),
        })}`, 'GET') : Promise.resolve([]),
      ]);
      const lexical = z.array(hitSchema.omit({ score: true })).max(lexicalLimit).safeParse(lexicalResult);
      if (!lexical.success) throw new Error('Invalid Supabase lexical response');
      const result = z.array(hitSchema).max(candidateLimit).safeParse(await rpc('match_paper_passages', {
        p_paper_id: paperId, p_source_version: sourceVersionId, p_question: parsed.data.question,
        p_query_embedding: vectors[0], p_limit: candidateLimit,
      }));
      if (!result.success) throw new Error('Invalid Supabase query response');
      const rows = [...result.data, ...lexical.data.map(row => ({ ...row, score: 0 }))];
      const candidates = rows.map(row => {
        if (row.paper_id !== paperId || row.source_version !== sourceVersionId
          || row.end_offset - row.start_offset !== row.text.length) throw new Error('Supabase result scope or excerpt mismatch');
        return { id: row.id, page: row.page, text: row.text, start: row.start_offset, end: row.end_offset, score: row.score };
      });
      const unique = new Map<string, (typeof candidates)[number]>();
      for (const hit of candidates) {
        const prior = unique.get(hit.id);
        if (prior && (prior.text !== hit.text || prior.page !== hit.page || prior.start !== hit.start || prior.end !== hit.end)) {
          throw new Error('Supabase conflicting canonical passages');
        }
        if (!prior) unique.set(hit.id, hit);
      }
      const hits = [...unique.values()];
      if (!hits.length) return [];
      return rankPassages(parsed.data.question, hits, await rerank(parsed.data.question, hits.map(h => h.text)), parsed.data.limit);
    },
  };
}
