import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { prepareManifest } from '../lib/paperpal/retrieval/manifest.mts';
import { createPassageIndex, readTurbopufferConfig } from '../lib/paperpal/retrieval/turbopuffer.mts';

const usage = `Usage: npm run turbopuffer -- <command>
  doctor                         Check local configuration (no network)
  prepare <paper-id> <pdf> <json>  Extract physical pages locally using pdftotext
  index <json>                   Upload passages to a hosted development namespace
  search <json> <question>        Hybrid search; resolve excerpts from the local manifest
  smoke                          Hosted test with synthetic text; cleans up its own namespace`;

function readManifest(path: string) {
  if (statSync(path).size > 20 * 1024 * 1024) throw new Error('Manifest exceeds 20 MiB');
  return prepareManifest(JSON.parse(readFileSync(path, 'utf8')));
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === '--help') { console.log(usage); return; }
  if (command === 'prepare') {
    if (args.length !== 3) throw new Error(usage);
    const [paperId, pdf, output] = args;
    if (statSync(pdf).size > 30 * 1024 * 1024) throw new Error('PDF exceeds 30 MiB');
    const bytes = readFileSync(pdf);
    if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error('Input is not a PDF');
    // Absolute path and execFile prevent shell interpretation or option injection.
    const raw = execFileSync('pdftotext', ['-layout', '-enc', 'UTF-8', resolve(pdf), '-'],
      { encoding: 'utf8', timeout: 30_000, maxBuffer: 20 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    const pages = raw.split('\f');
    if (!pages.at(-1)?.trim()) pages.pop();
    const manifest = { paperId: Number(paperId), pdfSha256: createHash('sha256').update(bytes).digest('hex'),
      extractionVersion: 'pdftotext-layout-utf8-v1', pages: pages.map((text, i) => ({ page: i + 1, text })) };
    const prepared = prepareManifest(manifest);
    writeFileSync(output, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ pages: pages.length, passages: prepared.passages.length, source: prepared.source,
      note: 'Local extraction only. Inspect equations, tables, and page boundaries before indexing.' }, null, 2));
    return;
  }
  if (!['doctor', 'index', 'search', 'smoke'].includes(command)) throw new Error(usage);
  const config = readTurbopufferConfig(process.env);
  if (!config.namespacePrefix.startsWith('paperpal-local')) {
    throw new Error('Local CLI requires a TURBOPUFFER_NAMESPACE_PREFIX starting with paperpal-local');
  }
  if (command === 'doctor') {
    console.log(JSON.stringify({ configured: true, apiKey: 'present (not verified)', region: config.region,
      namespacePrefix: config.namespacePrefix, model: config.model, dimensions: config.dimensions }, null, 2));
    return;
  }
  if (command === 'smoke') {
    if (args.length) throw new Error(usage);
    // Unique synthetic scope; cleanup can never target an existing paper namespace.
    const source = { paperId: 1, sourceVersionId: randomUUID() };
    const index = createPassageIndex(config, source);
    console.log(`Smoke namespace: ${index.namespace}`);
    try {
      await index.upsertPassages([
        { id: 'formal-verification', page: 1, text: 'Formal verification checks whether a system satisfies a mathematical specification.' },
        { id: 'fruit', page: 2, text: 'Apples and pears are fruits harvested from trees.' },
      ]);
      const hits = await index.retrievePassages({ question: 'How do mathematical specifications relate to formal verification?', limit: 1 });
      if (hits[0]?.id !== 'formal-verification') throw new Error('Smoke search did not return expected passage');
      console.log('PASS: hosted native embedding, BM25, and vector retrieval');
    } finally {
      const res = await fetch(`https://${config.region}.turbopuffer.com/v2/namespaces/${index.namespace}`, {
        method: 'DELETE', redirect: 'error', signal: AbortSignal.timeout(30_000),
        headers: { Authorization: `Bearer ${config.apiKey}` },
      });
      if (!res.ok && res.status !== 404) throw new Error(`Smoke cleanup failed: HTTP ${res.status}; namespace ${index.namespace}`);
      console.log('Smoke namespace removed');
    }
    return;
  }
  if ((command === 'index' && args.length !== 1) || (command === 'search' && args.length !== 2)) throw new Error(usage);
  const manifest = readManifest(args[0]);
  const index = createPassageIndex(config, manifest.source);
  if (command === 'index') {
    console.log(JSON.stringify({ namespace: index.namespace, ...await index.upsertPassages(manifest.passages) }, null, 2));
  } else {
    const hits = await index.retrievePassages({ question: args[1] });
    const passages = new Map(manifest.passages.map(p => [p.id, p]));
    console.log(JSON.stringify(hits.map(hit => {
      const passage = passages.get(hit.id);
      if (!passage || passage.page !== hit.page) throw new Error('Search hit does not match canonical local manifest');
      return { ...hit, text: passage.text, start: passage.start, end: passage.end };
    }), null, 2));
  }
}

main().catch(error => {
  // Only our own bounded messages; system/JSON/child-process failures can include source text.
  const message = error instanceof Error ? error.message : '';
  const safe = /^(Usage:|Missing or invalid TURBOPUFFER_|Local CLI|Turbopuffer |Invalid |Duplicate |Paper must|Manifest exceeds|PDF exceeds|Input is not|Smoke |Search hit)/.test(message);
  console.error(safe ? message : 'Local Turbopuffer command failed. Check paths, JSON, pdftotext installation, and network access.');
  process.exitCode = 1;
});
