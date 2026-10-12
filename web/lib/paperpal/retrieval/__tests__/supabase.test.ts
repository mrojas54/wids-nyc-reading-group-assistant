import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
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

describe('Supabase passage search', () => {
  it('defaults to Supabase and keeps Turbopuffer explicitly selectable', () => {
    expect(retrievalBackend({})).toBe('supabase');
    expect(retrievalBackend({ PAPERPAL_RETRIEVAL_BACKEND: 'turbopuffer' })).toBe('turbopuffer');
    expect(() => retrievalBackend({ PAPERPAL_RETRIEVAL_BACKEND: 'typo' })).toThrow();
  });
  it('sends the scoped query with the caller token and local embedding', async () => {
    const fetcher = vi.fn().mockResolvedValue(json([row]));
    const hits = await createSupabasePassageIndex(config, source, embed, fetcher).retrievePassages({ question: 'What is verification?' });
    expect(hits[0]).toMatchObject({ id: 'p1', text: passage.text, page: 1 });
    const [url, request] = fetcher.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:54321/rest/v1/rpc/match_paper_passages');
    expect(request.headers.Authorization).toBe('Bearer member-token');
    expect(JSON.parse(request.body)).toMatchObject({ p_paper_id: 41, p_source_version: source.sourceVersionId, p_query_embedding: vector });
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
});
