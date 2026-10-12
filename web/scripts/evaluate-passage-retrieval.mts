import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { createConfiguredPassageIndex, retrievalBackend } from '../lib/paperpal/retrieval/index.mts';
const fixture = z.object({ paperId: z.number().int().positive(), sourceVersionId: z.string().regex(/^[a-f0-9]{64}$/),
  cases: z.array(z.object({ name: z.string(), question: z.string().min(1).max(4000), expectedGroups: z.array(z.array(z.string()).min(1)).min(1) })).min(1).max(30),
});
async function main() {
  if (retrievalBackend(process.env) !== 'supabase') throw new Error('Evaluation requires Supabase');
  const input = fixture.parse(JSON.parse(readFileSync(new URL('./fixtures/october-retrieval.json', import.meta.url), 'utf8')));
  const index = await createConfiguredPassageIndex(process.env, input);
  let passed = 0;
  for (const item of input.cases) {
    const started = performance.now();
    const hits = await index.retrievePassages({ question: item.question, limit: 3 });
    const ok = item.expectedGroups.every(group => group.some(id => hits.some(h => h.id === id)));
    if (ok) passed++;
    console.log(JSON.stringify({ name: item.name, passed: ok, milliseconds: Math.round(performance.now()-started),
      hits: hits.map(h => ({ id: h.id, page: h.page, score: h.score })) }));
  }
  console.log(`${passed}/${input.cases.length} retrieval checks passed (supporting passages in top 3)`);
  if (passed !== input.cases.length) process.exitCode = 1;
}
main().catch(() => { console.error('Retrieval evaluation failed; check configuration, pinned source, and model availability.'); process.exitCode = 1; });
