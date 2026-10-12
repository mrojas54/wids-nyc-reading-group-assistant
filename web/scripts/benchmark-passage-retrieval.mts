import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { createSupabasePassageIndex } from '../lib/paperpal/retrieval/supabase.mts';
import { embedPassages } from '../lib/paperpal/retrieval/local-embeddings.mts';
import { scorePassages } from '../lib/paperpal/retrieval/local-reranker.mts';

const fixtureSchema = z.object({ paperId: z.number().int().positive(), sourceVersionId: z.string().regex(/^[a-f0-9]{64}$/),
  cases: z.array(z.object({ name: z.string(), question: z.string().min(1).max(4000), expectedGroups: z.array(z.array(z.string()).min(1)).min(1) })).min(1).max(30),
});
async function main() {
  const fixture = fixtureSchema.parse(JSON.parse(readFileSync(new URL('./fixtures/october-retrieval.json', import.meta.url), 'utf8')));
  const url = process.env.PAPERPAL_SUPABASE_URL;
  const apiKey = process.env.PAPERPAL_SUPABASE_KEY;
  if (!url || !apiKey) throw new Error('Missing configuration');
  const config = { url, apiKey, accessToken: process.env.PAPERPAL_SUPABASE_ACCESS_TOKEN || apiKey };
  const measurements: number[] = [];
  let passed = 0;
  for (let round=0; round<3; round++) {
    for (const [i,item] of fixture.cases.entries()) {
      let embeddingMs=0, hybridMs=0, lexicalMs=0, rerankingMs=0, candidates=0;
      const index = createSupabasePassageIndex(config, fixture,
        async texts => { const t=performance.now(); const result=await embedPassages(texts); embeddingMs=performance.now()-t; return result; },
        async (input,init) => { const t=performance.now(); const result=await fetch(input,init); const elapsed=performance.now()-t;
          if(init?.method === 'GET') lexicalMs=elapsed; else hybridMs=elapsed; return result; },
        async (question,texts) => { const t=performance.now(); candidates=texts.length; const scores=await scorePassages(question,texts); rerankingMs=performance.now()-t; return scores; });
      const t=performance.now();
      const hits=await index.retrievePassages({question:item.question,limit:3});
      const milliseconds=performance.now()-t;
      const cold=round===0 && i===0;
      if(!cold) measurements.push(milliseconds);
      const ok=item.expectedGroups.every(group=>group.some(id=>hits.some(hit=>hit.id===id)));
      if(ok) passed++;
      console.log(JSON.stringify({round,name:item.name,cold,passed:ok,milliseconds:Math.round(milliseconds),candidates,
        stagesMs:{embedding:Math.round(embeddingMs),hybrid:Math.round(hybridMs),lexical:Math.round(lexicalMs),reranking:Math.round(rerankingMs)},
        hits:hits.map(hit=>({id:hit.id,page:hit.page}))}));
    }
  }
  measurements.sort((a,b)=>a-b);
  const percentile=(p:number)=>Math.round(measurements[Math.ceil(measurements.length*p)-1]);
  console.log(JSON.stringify({passed,total:fixture.cases.length*3,warmSamples:measurements.length,p50Ms:percentile(.5),p95Ms:percentile(.95)}));
  if(passed!==fixture.cases.length*3) process.exitCode=1;
}
main().catch(()=>{console.error('Retrieval benchmark failed; check configuration, model availability, and pinned source.');process.exitCode=1;});
