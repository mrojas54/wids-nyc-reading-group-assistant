import 'server-only';
import { createHash } from 'node:crypto';
import { z } from 'zod';

const configSchema = z.object({
  apiKey: z.string().trim().min(1).refine(v => !v.startsWith('op://')),
  region: z.string().regex(/^(aws|gcp)-[a-z0-9]+(?:-[a-z0-9]+)+$/),
  namespacePrefix: z.string().regex(/^[a-zA-Z0-9_-]{1,48}$/),
  model: z.string().trim().min(1).max(128),
  dimensions: z.number().int().min(1).max(4096),
});
export type TurbopufferConfig = z.infer<typeof configSchema>;

/** Server-side only. Call explicitly; importing this module never contacts a service. */
export function readTurbopufferConfig(env: Record<string, string | undefined>): TurbopufferConfig {
  const values = {
    apiKey: env.TURBOPUFFER_API_KEY,
    region: env.TURBOPUFFER_REGION || 'gcp-us-central1',
    namespacePrefix: env.TURBOPUFFER_NAMESPACE_PREFIX || 'paperpal-local',
    model: env.TURBOPUFFER_EMBEDDING_MODEL || 'nvidia/nemotron-3-embed-8b',
    dimensions: Number(env.TURBOPUFFER_EMBEDDING_DIMENSIONS || '1024'),
  };
  const result = configSchema.safeParse(values);
  if (!result.success) {
    const names: Record<string, string> = {
      apiKey: 'TURBOPUFFER_API_KEY', region: 'TURBOPUFFER_REGION',
      namespacePrefix: 'TURBOPUFFER_NAMESPACE_PREFIX', model: 'TURBOPUFFER_EMBEDDING_MODEL',
      dimensions: 'TURBOPUFFER_EMBEDDING_DIMENSIONS',
    };
    throw new Error(`Missing or invalid ${result.error.issues.map(i => names[String(i.path[0])]).join(', ')}`);
  }
  return result.data;
}

const sourceSchema = z.object({
  paperId: z.number().int().positive().safe(),
  sourceVersionId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
});
export type PassageSource = z.infer<typeof sourceSchema>;
const passageSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  page: z.number().int().positive(),
  text: z.string().min(1).max(8000).refine(v => v.trim().length > 0),
});
export type Passage = z.infer<typeof passageSchema>;
const batchSchema = z.array(passageSchema).min(1).max(2000);
const querySchema = z.object({ question: z.string().trim().min(1).max(4000), limit: z.number().int().min(1).max(100).default(8) });
const rowSchema = z.object({ id: passageSchema.shape.id, page: passageSchema.shape.page,
  paper_id: z.number(), source_version: z.string() });
const queryResponseSchema = z.object({ results: z.array(z.object({ rows: z.array(rowSchema) })).length(2) });

export class TurbopufferError extends Error {
  readonly status: number | undefined;
  constructor(message: string, status?: number) { super(message); this.name = 'TurbopufferError'; this.status = status; }
}

/** Search hits are candidates, not authorized citation evidence. Resolve IDs from the canonical store. */
export function createPassageIndex(config: TurbopufferConfig, inputSource: PassageSource, fetcher: typeof fetch = fetch) {
  const c = configSchema.safeParse(config);
  const s = sourceSchema.safeParse(inputSource);
  if (!c.success || !s.success) throw new Error('Invalid Turbopuffer configuration or passage source');
  const source = s.data;
  const { apiKey, region, namespacePrefix, model, dimensions } = c.data;
  const digest = createHash('sha256').update(JSON.stringify([
    'paperpal-passages-v1', source.paperId, source.sourceVersionId, model, dimensions,
  ])).digest('hex');
  const namespace = `${namespacePrefix}-${digest}`;
  const url = `https://${region}.turbopuffer.com/v2/namespaces/${namespace}`;

  async function request(path: string, body: unknown) {
    try {
      const res = await fetcher(url + path, {
        method: 'POST', redirect: 'error', cache: 'no-store',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(30_000), body: JSON.stringify(body),
      });
      if (!res.ok) {
        await res.body?.cancel();
        throw new TurbopufferError(`Turbopuffer HTTP ${res.status}`, res.status);
      }
      try { return await res.json() as unknown; }
      catch { throw new TurbopufferError('Invalid Turbopuffer response'); }
    } catch (error) {
      if (error instanceof TurbopufferError) throw error;
      // Never propagate transport diagnostics that may contain credentials or document text.
      throw new TurbopufferError('Turbopuffer network or timeout failure');
    }
  }

  return {
    namespace,
    async upsertPassages(input: Passage[]) {
      const parsed = batchSchema.safeParse(input);
      if (!parsed.success) throw new Error('Invalid passage batch (1–2000 passages, 1-based pages, text up to 8000 characters)');
      if (new Set(parsed.data.map(p => p.id)).size !== parsed.data.length) throw new Error('Duplicate passage IDs');
      const result = await request('', {
        upsert_rows: parsed.data.map(p => ({ ...p, paper_id: source.paperId, source_version: source.sourceVersionId })),
        distance_metric: 'cosine_distance',
        schema: {
          text: { type: 'string', full_text_search: true, embed: { model, dims: dimensions } },
          paper_id: { type: 'uint', filterable: true },
          source_version: { type: 'string', filterable: true },
          page: { type: 'uint' },
        },
      });
      const parsedResult = z.object({ rows_affected: z.number().int().nonnegative() }).safeParse(result);
      if (!parsedResult.success) throw new TurbopufferError('Invalid Turbopuffer write response');
      return parsedResult.data;
    },
    async retrievePassages(input: { question: string; limit?: number }) {
      const parsed = querySchema.safeParse(input);
      if (!parsed.success) throw new Error('Invalid passage query or limit');
      const { question, limit } = parsed.data;
      const common = {
        top_k: Math.min(limit * 3, 100),
        filters: ['And', [['paper_id', 'Eq', source.paperId], ['source_version', 'Eq', source.sourceVersionId]]],
        include_attributes: ['paper_id', 'source_version', 'page'],
      };
      const result = queryResponseSchema.safeParse(await request('/query', {
        queries: [
          { ...common, rank_by: ['text', 'ANN', ['Embed', question]] },
          { ...common, rank_by: ['text', 'BM25', question] },
        ],
      }));
      if (!result.success) throw new TurbopufferError('Invalid Turbopuffer query response');
      const fused = new Map<string, { id: string; page: number; score: number }>();
      for (const { rows } of result.data.results) {
        const seen = new Set<string>();
        for (const [i, row] of rows.entries()) {
          if (row.paper_id !== source.paperId || row.source_version !== source.sourceVersionId) {
            throw new TurbopufferError('Turbopuffer result scope mismatch');
          }
          if (seen.has(row.id)) continue;
          seen.add(row.id);
          const previous = fused.get(row.id);
          if (previous && previous.page !== row.page) throw new TurbopufferError('Inconsistent Turbopuffer passage page');
          fused.set(row.id, { id: row.id, page: row.page, score: (previous?.score ?? 0) + 1 / (60 + i + 1) });
        }
      }
      return [...fused.values()].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, limit);
    },
  };
}
