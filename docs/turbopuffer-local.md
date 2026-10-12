# Local Turbopuffer development

Paper Pal now has a server-only passage adapter and a local CLI. The CLI can
extract a PDF into page-linked passages, index them, and run hybrid retrieval.
It does not yet connect the member discussion UI, Supabase source tables, or
answer generation. The existing SPECTER2 recommendation pipeline is unchanged.

## Setup

Use Node >=22.12, install web dependencies with `npm ci`, and have Poppler's
`pdftotext` on PATH (`brew install poppler` on macOS if missing).
Run all commands below from the repository's `web/` directory.

Copy `.env.turbopuffer.example` to `.env.turbopuffer.local` if the latter does not
already exist. Put your Turbopuffer API key in that local file, or inject it from
your secret manager into the process environment. Shell environment values take
precedence over the file. Do not put the key in `NEXT_PUBLIC_*` variables.

This task created a private local file with the key blank. Set the region to the
one used by your Turbopuffer organization and give each developer a distinct
`paperpal-local-...` namespace prefix. The default model is an evaluation
candidate; check model availability in your region before a hosted run.

```sh
npm run turbopuffer -- doctor
npm run turbopuffer -- smoke
```

`doctor` validates configuration only; it does not authenticate. `smoke` sends two
synthetic passages to the hosted service, verifies the expected search result,
and deletes only its newly generated random namespace. It prints the namespace
first so cleanup failures can be resolved. Credentials and response bodies are
not logged. A hosted run can incur normal service and embedding charges.

Turbopuffer recommends hosted, isolated namespaces for development. There is no
local database daemon in this integration. All ordinary Vitest tests are offline.
See the official [testing guide](https://turbopuffer.com/docs/testing).

## Prepare and search the October paper

Use the existing [Drive PDF](https://drive.google.com/file/d/1ow5nbrsflTHuxqXKlWFlQ_FrCynMPiIX/view)
for paper 41. Save/download those bytes locally for extraction; no re-upload or
companion regeneration is required. Replace `/absolute/path/paper.pdf` below
with that local path.

```sh
mkdir -p .paperpal-local
npm run turbopuffer -- prepare 41 /absolute/path/paper.pdf .paperpal-local/paper-41.json
# Inspect the JSON's text and page numbers, especially formulas and tables.
npm run turbopuffer -- index .paperpal-local/paper-41.json
npm run turbopuffer -- search .paperpal-local/paper-41.json "What are the limits of mechanistic interpretability?"
```

`prepare` is completely local and needs no API key. It hashes the original PDF,
uses `pdftotext -layout`, preserves physical PDF page numbering, and writes a
private JSON file without overwriting an existing file. Textless/scanned PDFs
need OCR outside this command. Extraction is not evidence of formula/table
fidelity; inspect before indexing. The `.paperpal-local/` directory is gitignored.

`index` uploads extracted passages and metadata to a hosted development namespace.
Native embeddings use Turbopuffer's configured model; there is no separate
embedding-provider API key. See [native embeddings](https://turbopuffer.com/docs/embedding).
Native embeddings store source text in the search service alongside its vectors.

`search` performs ANN and BM25 queries, combines them with reciprocal rank fusion,
then resolves the result IDs against the local manifest before printing excerpts.
An API failure is an error, not an empty result. See the official
[hybrid search guide](https://turbopuffer.com/docs/hybrid).

## Versioning and application integration

- `prepareManifest` hashes PDF identity, exact extracted page text, extraction
  version, and chunking version into a source version. Passage IDs bind that
  version to physical page and UTF-16 offsets. Chunk text is at most 6000
  characters; this is an initial extraction strategy requiring retrieval evaluation.
- `createPassageIndex(config, source)` derives its namespace from the prefix,
  paper ID, source version, model, dimensions, and index schema version.
  Changed text/model configuration creates a separate namespace.
- `upsertPassages` validates the entire batch before writing. Repeating the same
  manifest upserts the same IDs. At most 2000 passages are accepted per operation;
  requests time out at 30 seconds. There are no automatic retries. Rerun an
  identical manifest after resolving transient errors, including ambiguous timeouts.
- `retrievePassages({question, limit})` scopes both searches and validates returned
  paper/source metadata. Results contain passage IDs, pages, and fusion scores.
  They are candidates, not proof of access or semantic support.
- The module is Node/server-only. Before wiring a member route, authenticate and
  apply the existing Paper Pal gate, then resolve IDs against canonical Supabase
  passages and validate citations. Do not expose the raw adapter as an unauthenticated
  route. The proposed Supabase Edge Function needs a runtime-compatible transport
  boundary; do not directly import this Next/Node module into Deno.
- Production source readiness/jobs, canonical Supabase storage, index garbage
  collection, and PDF-source database association are still in the discussion
  plan. Local manifests serve as the canonical evidence for this local prototype.
  Persistent local index namespaces are retained; only smoke namespaces are
  automatically removed.

## Verification

Run `npm test`, `npm run lint`, and `npm run typecheck` in `web/`.
The tests cover scoping, ranking, stable IDs, chunk/page preservation, input and
service-response validation, safe errors, CLI configuration, and the server-only
boundary. Python files were not changed; Python lint/typechecks do not apply.

Local extraction was also exercised with a synthetic two-page PDF. Hosted
connectivity and October-paper retrieval quality remain unverified until the
Turbopuffer key is provided and the hosted checks run.
