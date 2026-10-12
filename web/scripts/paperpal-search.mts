import { readFileSync, statSync } from 'node:fs';
import { createConfiguredPassageIndex, retrievalBackend } from '../lib/paperpal/retrieval/index.mts';
import { prepareManifest } from '../lib/paperpal/retrieval/manifest.mts';
import { readTurbopufferConfig } from '../lib/paperpal/retrieval/turbopuffer.mts';

const usage = `Usage: npm run paperpal:search -- doctor | index <manifest.json> | search <manifest.json> <question>
Defaults to Supabase. Local configuration: .env.paperpal.local.
Use npm run turbopuffer -- prepare <paper-id> <pdf> <json> for local PDF extraction.
Remote indexing requires the explicit --allow-remote flag after the manifest path.`;

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === '--help') { console.log(usage); return; }
  if (!['doctor', 'index', 'search'].includes(command)) throw new Error(usage);
  const backend = retrievalBackend(process.env);
  if (backend === 'supabase') {
    if (!process.env.PAPERPAL_SUPABASE_URL || !process.env.PAPERPAL_SUPABASE_KEY) throw new Error('Missing PAPERPAL_SUPABASE_URL or PAPERPAL_SUPABASE_KEY');
    const url = new URL(process.env.PAPERPAL_SUPABASE_URL);
    if (command === 'index' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && !args.includes('--allow-remote')) {
      throw new Error('Remote indexing requires --allow-remote; review the target project before uploading passages');
    }
  } else { readTurbopufferConfig(process.env); }
  if (command === 'doctor') {
    // Constructor validation does not load the model or make network requests.
    await createConfiguredPassageIndex(process.env, { paperId: 1, sourceVersionId: '0'.repeat(64) });
    console.log(JSON.stringify({ backend, credentials: 'present (not verified)',
      target: backend === 'supabase' ? new URL(process.env.PAPERPAL_SUPABASE_URL!).origin : 'Turbopuffer' }, null, 2));
    return;
  }
  const remoteAllowed = command === 'index' && args.at(-1) === '--allow-remote';
  if (remoteAllowed) args.pop();
  if ((command === 'index' && args.length !== 1) || (command === 'search' && args.length !== 2)) throw new Error(usage);
  if (statSync(args[0]).size > 20 * 1024 * 1024) throw new Error('Manifest exceeds 20 MiB');
  const manifest = prepareManifest(JSON.parse(readFileSync(args[0], 'utf8')), backend === 'supabase' ? 1000 : 6000);
  const index = await createConfiguredPassageIndex(process.env, manifest.source);
  if (command === 'index') {
    console.log(JSON.stringify({ backend, source: manifest.source, ...await index.upsertPassages(manifest.passages) }, null, 2));
  } else {
    const canonical = new Map(manifest.passages.map(p => [p.id, p]));
    const hits = await index.retrievePassages({ question: args[1] });
    console.log(JSON.stringify(hits.map(hit => {
      const passage = canonical.get(hit.id);
      if (!passage || passage.page !== hit.page || ('text' in hit && hit.text !== passage.text)) throw new Error('Search result does not match local manifest');
      return { ...passage, score: hit.score };
    }), null, 2));
  }
}
main().catch(error => {
  const message = error instanceof Error ? error.message : '';
  const safe = /^(Usage:|Missing |Invalid |Remote indexing|Supabase HTTP|Supabase network|Turbopuffer HTTP|Turbopuffer network|Manifest exceeds|Search result|Passage or query)/.test(message);
  console.error(safe ? message : 'Passage command failed. Check the manifest, model download, database migration, and credentials.');
  process.exitCode = 1;
});
