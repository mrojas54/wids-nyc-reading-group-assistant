import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { createPassageIndex, readTurbopufferConfig } from '../turbopuffer.mts';

const env = { TURBOPUFFER_API_KEY: 'test-key', TURBOPUFFER_NAMESPACE_PREFIX: 'paperpal-local-test' };
const source = { paperId: 41, sourceVersionId: 'a'.repeat(64) };
const passages = [{ id: 'p1', page: 1, text: 'A synthetic explanation of formal verification.' }];
const row = { id: 'p1', paper_id: 41, source_version: source.sourceVersionId, page: 1 };
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
afterEach(() => vi.restoreAllMocks());

describe('Turbopuffer local passage integration', () => {
  it('fails closed on missing credentials without echoing values', () => {
    expect(() => readTurbopufferConfig({})).toThrow('TURBOPUFFER_API_KEY');
    expect(() => readTurbopufferConfig({ ...env, TURBOPUFFER_REGION: 'https://secret.invalid' })).toThrow('TURBOPUFFER_REGION');
  });
  it('isolates namespace by paper, source version, and embedding model', () => {
    const c = readTurbopufferConfig(env);
    const a = createPassageIndex(c, source).namespace;
    expect(a).toMatch(/^paperpal-local-test-/);
    expect(createPassageIndex(c, source).namespace).toBe(a);
    expect(createPassageIndex(c, { ...source, paperId: 42 }).namespace).not.toBe(a);
    expect(createPassageIndex(c, { ...source, sourceVersionId: 'b'.repeat(64) }).namespace).not.toBe(a);
    expect(createPassageIndex({ ...c, model: 'other/model' }, source).namespace).not.toBe(a);
  });
  it('indexes page-linked text with native embedding and BM25 schema', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ rows_affected: 1 }));
    const index = createPassageIndex(readTurbopufferConfig(env), source, fetcher);
    await index.upsertPassages(passages);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(`https://gcp-us-central1.turbopuffer.com/v2/namespaces/${index.namespace}`);
    expect(init.headers.Authorization).toBe('Bearer test-key');
    expect(init.redirect).toBe('error');
    expect(JSON.parse(init.body)).toMatchObject({
      distance_metric: 'cosine_distance',
      upsert_rows: [{ ...row, text: passages[0].text }],
      schema: { text: { type: 'string', full_text_search: true, embed: { model: 'nvidia/nemotron-3-embed-8b', dims: 1024 } } },
    });
  });
  it('validates the entire batch before any write', async () => {
    const fetcher = vi.fn();
    const index = createPassageIndex(readTurbopufferConfig(env), source, fetcher);
    await expect(index.upsertPassages([...passages, { id: 'p2', page: 0, text: 'bad page' }])).rejects.toThrow();
    await expect(index.upsertPassages([...passages, ...passages])).rejects.toThrow('Duplicate');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('hybrid-searches with identical paper/source filters and fuses duplicate IDs', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ results: [
      { rows: [row, { ...row, id: 'p2' }] },
      { rows: [{ ...row, id: 'p2' }, row] },
    ] }));
    const index = createPassageIndex(readTurbopufferConfig(env), source, fetcher);
    const results = await index.retrievePassages({ question: 'What is verification?', limit: 2 });
    expect(results.map(r => r.id)).toEqual(['p1', 'p2']);
    expect(results[0].score).toBeCloseTo(1 / 61 + 1 / 62);
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(body.queries.map((q: { rank_by: unknown }) => q.rank_by)).toEqual([
      ['text', 'ANN', ['Embed', 'What is verification?']], ['text', 'BM25', 'What is verification?'],
    ]);
    for (const q of body.queries) expect(q.filters).toEqual(['And', [
      ['paper_id', 'Eq', 41], ['source_version', 'Eq', source.sourceVersionId],
    ]]);
  });
  it('rejects mixed-paper and mixed-source results', async () => {
    for (const bad of [{ ...row, paper_id: 42 }, { ...row, source_version: 'other' }]) {
      const fetcher = vi.fn().mockResolvedValue(response({ results: [{ rows: [bad] }, { rows: [] }] }));
      await expect(createPassageIndex(readTurbopufferConfig(env), source, fetcher)
        .retrievePassages({ question: 'why?' })).rejects.toThrow('scope');
    }
  });
  it('distinguishes empty results from malformed service responses', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response({ results: [{ rows: [] }, { rows: [] }] }))
      .mockResolvedValueOnce(response({ results: [] }));
    const index = createPassageIndex(readTurbopufferConfig(env), source, fetcher);
    await expect(index.retrievePassages({ question: 'why?' })).resolves.toEqual([]);
    await expect(index.retrievePassages({ question: 'why?' })).rejects.toThrow('response');
  });
  it.each([401, 429, 500])('reports HTTP %s without response bodies or credentials', async status => {
    const fetcher = vi.fn().mockResolvedValue(response({ error: 'sensitive paper or test-key' }, status));
    const index = createPassageIndex(readTurbopufferConfig(env), source, fetcher);
    await expect(index.retrievePassages({ question: 'why?' })).rejects.toThrow(`HTTP ${status}`);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('redacts transport errors and applies a timeout signal', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('test-key'));
    const index = createPassageIndex(readTurbopufferConfig(env), source, fetcher);
    await expect(index.retrievePassages({ question: 'why?' })).rejects.toThrow('network or timeout');
    expect(fetcher.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
  it('rejects invalid questions and limits before network access', async () => {
    const fetcher = vi.fn();
    const index = createPassageIndex(readTurbopufferConfig(env), source, fetcher);
    await expect(index.retrievePassages({ question: ' ' })).rejects.toThrow();
    await expect(index.retrievePassages({ question: 'why?', limit: 101 })).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
