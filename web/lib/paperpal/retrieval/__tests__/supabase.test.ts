import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('../local-reranker.mts', () => ({ scorePassages: async (_q: string, texts: string[]) => texts.map(() => 1) }));
import { createSupabasePassageIndex } from '../supabase.mts';
import { retrievalBackend } from '../index.mts';

const source = { paperId: 41, sourceVersionId: 'a'.repeat(64) };
const config = { url: 'http://127.0.0.1:54321', apiKey: 'local-key', accessToken: 'member-token' };
const vector = [1, ...Array(383).fill(0)] as number[];
const embed = vi.fn(async (texts: string[]) => texts.map(() => vector));
const passage = { id: 'p1', page: 1, text: 'Formal verification.', start: 0, end: 20 };
const row = { id: 'p1', page: 1, text: passage.text, start_offset: 0, end_offset: 20, score: 0.03,
  paper_id: 41, source_version: source.sourceVersionId };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const search = (rows: unknown, lexical: unknown = []) => vi.fn<typeof fetch>(async (_url, init) => json(init?.method === 'GET' ? lexical : rows));

describe('Supabase passage search', () => {
  it('defaults to Supabase and keeps Turbopuffer explicitly selectable', () => {
    expect(retrievalBackend({})).toBe('supabase');
    expect(retrievalBackend({ PAPERPAL_RETRIEVAL_BACKEND: 'turbopuffer' })).toBe('turbopuffer');
    expect(() => retrievalBackend({ PAPERPAL_RETRIEVAL_BACKEND: 'typo' })).toThrow();
  });
  it('sends the scoped query with the caller token and local embedding', async () => {
    const fetcher = search([row]);
    const hits = await createSupabasePassageIndex(config, source, embed, fetcher).retrievePassages({ question: 'What is verification?' });
    expect(hits[0]).toMatchObject({ id: 'p1', text: passage.text, page: 1 });
    const [url, request] = fetcher.mock.calls.find(call => call[1]?.method === 'POST')!;
    expect(url).toBe('http://127.0.0.1:54321/rest/v1/rpc/match_paper_passages');
    expect((request!.headers as Record<string,string>).Authorization).toBe('Bearer member-token');
    expect(JSON.parse(request!.body as string)).toMatchObject({ p_paper_id: 41, p_source_version: source.sourceVersionId, p_query_embedding: vector });
  });
  it('imports the whole source in one atomic RPC', async () => {
    const fetcher = vi.fn().mockResolvedValue(json(1));
    await createSupabasePassageIndex(config, source, embed, fetcher).upsertPassages([passage]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toContain('/index_paper_passages');
    expect(JSON.parse(fetcher.mock.calls[0][1].body).p_passages[0]).toMatchObject({ ...passage, embedding: vector });
  });
  it('rejects bad embeddings and duplicate passages before writing', async () => {
    const fetcher = vi.fn();
    const index = createSupabasePassageIndex(config, source, async () => [[1, 2]], fetcher);
    await expect(index.upsertPassages([passage])).rejects.toThrow('embedding');
    await expect(index.upsertPassages([passage, passage])).rejects.toThrow('Duplicate');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects other-paper, other-version, and malformed results', async () => {
    for (const bad of [[{ ...row, paper_id: 42 }], [{ ...row, source_version: 'other' }], {}]) {
      const fetcher = vi.fn().mockResolvedValue(json(bad));
      await expect(createSupabasePassageIndex(config, source, embed, fetcher)
        .retrievePassages({ question: 'Why?' })).rejects.toThrow();
    }
  });
  it('keeps service errors distinct from no matches and redacts bodies', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json([])).mockResolvedValueOnce(json({ error: 'private' }, 403));
    const index = createSupabasePassageIndex(config, source, embed, fetcher);
    await expect(index.retrievePassages({ question: 'Why?' })).resolves.toEqual([]);
    await expect(index.retrievePassages({ question: 'Why?' })).rejects.toThrow('Supabase HTTP 403');
  });
  it('validates limits and text before embedding or fetching', async () => {
    const embedding = vi.fn(); const fetcher = vi.fn();
    const index = createSupabasePassageIndex(config, source, embedding, fetcher);
    await expect(index.retrievePassages({ question: ' ', limit: 0 })).rejects.toThrow();
    expect(embedding).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  });
  it('reranks a wider pool before applying the requested limit', async () => {
    const fetcher = search([row, { ...row, id: 'answer', score: 0.001 }]);
    const scorer = vi.fn(async () => [-1, 3]);
    const hits = await createSupabasePassageIndex(config, source, embed, fetcher, scorer)
      .retrievePassages({ question: 'Which evidence supports this?', limit: 1 });
    expect(JSON.parse(fetcher.mock.calls.find(call => call[1]?.method === 'POST')![1]!.body as string).p_limit).toBe(8);
    expect(hits.map(h => h.id)).toEqual(['answer']);
    expect(hits[0].text).toBe(passage.text);
  });
  it('validates every candidate scope before invoking the local model', async () => {
    const fetcher = vi.fn().mockResolvedValue(json([row, { ...row, paper_id: 42 }]));
    const scorer = vi.fn();
    await expect(createSupabasePassageIndex(config, source, embed, fetcher, scorer)
      .retrievePassages({ question: 'Why?', limit: 1 })).rejects.toThrow('scope');
    expect(scorer).not.toHaveBeenCalled();
  });

  it('keeps lexical lookup scoped and authorized, deduplicating overlapping candidates', async () => {
    const lexical = { ...row, id: 'lexical' };
    const fetcher = search([row], [row, lexical]);
    const scorer = vi.fn(async () => [1, 2]);
    const hits = await createSupabasePassageIndex(config, source, embed, fetcher, scorer)
      .retrievePassages({ question: 'Which model families were evaluated?', limit: 1 });
    const [url, request] = fetcher.mock.calls.find(call => call[1]?.method === 'GET')!;
    const params = new URL(String(url)).searchParams;
    expect(params.get('paper_id')).toBe('eq.41');
    expect(params.get('source_version')).toBe(`eq.${source.sourceVersionId}`);
    expect(params.get('fts')).toBe('wfts(english)."model families"');
    expect(params.get('limit')).toBe('8');
    expect((request!.headers as Record<string,string>).Authorization).toBe('Bearer member-token');
    expect(scorer.mock.calls[0]).toEqual(['Which model families were evaluated?', [passage.text, passage.text]]);
    expect(hits[0].id).toBe('lexical');
  });
  it('rejects mismatched lexical scope and conflicting canonical excerpts', async () => {
    for (const bad of [{ ...row, paper_id: 42 }, { ...row, text: 'Other verification.' , end_offset: 19 }]) {
      const scorer = vi.fn();
      await expect(createSupabasePassageIndex(config, source, embed, search([row], [bad]), scorer)
        .retrievePassages({ question: 'Which models?' })).rejects.toThrow();
      expect(scorer).not.toHaveBeenCalled();
    }
  });

  it('fails closed on a lexical authorization error instead of hiding it with hybrid results', async () => {
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => init?.method === 'GET'
      ? json({ message: 'private details' }, 403) : json([row]));
    const scorer = vi.fn();
    await expect(createSupabasePassageIndex(config, source, embed, fetcher, scorer)
      .retrievePassages({ question: 'Which models?' })).rejects.toThrow('Supabase HTTP 403');
    expect(scorer).not.toHaveBeenCalled();
  });

});
