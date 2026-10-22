import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => {
  const infer = Object.assign(vi.fn(async (texts: string[]) => ({ tolist: () => texts.map(() => Array(384).fill(0.1)) })),
    { tokenizer: { encode: vi.fn((text: string) => Array(text === 'too-long' ? 513 : 10).fill(1)) } });
  return { infer, pipeline: vi.fn(async () => infer) };
});
vi.mock('@xenova/transformers', () => ({ env: {}, pipeline: mocks.pipeline }));
import { embedPassages } from '../local-embeddings.mts';

describe('local passage embeddings', () => {
  it('pins model revision and pools normalized vectors in bounded batches', async () => {
    const result = await embedPassages(Array(9).fill('synthetic text'));
    expect(result).toHaveLength(9);
    expect(mocks.pipeline).toHaveBeenCalledWith('feature-extraction', 'Supabase/gte-small', {
      revision: '93b36ff09519291b77d6000d2e86bd8565378086', quantized: true,
    });
    expect(mocks.infer.mock.calls.map(call => call[0].length)).toEqual([8, 1]);
    expect(mocks.infer).toHaveBeenCalledWith(expect.any(Array), { pooling: 'mean', normalize: true });
  });
  it('rejects oversize token windows rather than truncating', async () => {
    mocks.infer.mockClear();
    await expect(embedPassages(['too-long'])).rejects.toThrow('512-token');
    expect(mocks.infer).not.toHaveBeenCalled();
  });
  it('rejects empty input', async () => {
    await expect(embedPassages([])).rejects.toThrow('Invalid');
  });
});
