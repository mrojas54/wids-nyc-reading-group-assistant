# Supabase passage search for Paper Pal

Supabase is the default local retrieval backend. Turbopuffer remains available
for later through `PAPERPAL_RETRIEVAL_BACKEND=turbopuffer` and its existing CLI.
This change adds no subscription. It implements the retrieval foundation;
discussion, cited answer generation, and understanding checks are not wired to
the member UI yet. The live database and October paper have not been modified.

## Runtime and configuration

From `web/`, run `nvm install && nvm use` and `npm ci`. The engine requirement
is **Node >=24.0.0**; `.nvmrc` pins **24.16.0**, also used by CI.

Copy `.env.paperpal.example` to `.env.paperpal.local` if it does not already
exist. The CLI loads this file, not the portal's production `.env.local`.
The example points at a local Supabase API on `127.0.0.1:54321`; it does not
start that API or supply credentials. Set the URL and key for the intended
development database after applying migration 035 with its prerequisites.

- Ingestion: use the target project's server-side service-role key as
  `PAPERPAL_SUPABASE_KEY`. Never expose it through a `NEXT_PUBLIC_*` variable.
- Member search: use the publishable/anon key and set
  `PAPERPAL_SUPABASE_ACCESS_TOKEN` to the member's access JWT. If omitted, the
  CLI uses the key as its bearer token; a service-role key bypasses RLS.
- Application integration must pass the authenticated member token explicitly.
  The operator CLI's service-role mode is not a member authorization check.

`npm run paperpal:search -- doctor` validates configuration without downloading
a model or contacting Supabase. “Present (not verified)” is not a connectivity
check. HTTP RPCs require a running Supabase/PostgREST API, not just Postgres.

## Prepare, index, and search

The existing PDF extraction command is reusable and needs no Turbopuffer key.
Install Poppler for `pdftotext`, then run these commands from `web/`:

```sh
npm run turbopuffer -- prepare 41 /absolute/path/paper.pdf .paperpal-local/paper-41.json
npm run paperpal:search -- doctor
npm run paperpal:search -- index .paperpal-local/paper-41.json
npm run paperpal:search -- search .paperpal-local/paper-41.json "What are the limits of mechanistic interpretability?"
```

For a reviewed remote target, indexing additionally requires `--allow-remote`
after the manifest path. No live migration or paper import has been performed
by this change. The referenced paper must already exist in the target database.

The Supabase path creates page-preserving chunks of at most 1,000 characters.
It downloads the quantized `Supabase/gte-small` model at Hugging Face revision
`93b36ff09519291b77d6000d2e86bd8565378086` and runs inference locally, using
mean pooling and normalization to produce 384-dimensional vectors. Model
artifacts are cached under `.paperpal-local/models` (configurable with
`PAPERPAL_MODEL_CACHE`); passage text is not sent to an embedding service.
Indexing sends the text and vectors to the configured Supabase database.

The model has a 512-token window. Tokenization checks reject oversized passages
or questions rather than silently truncating them; some mathematical or
non-English text may exceed this limit even at 1,000 characters. Adjust chunking
deliberately and create a new source version if this occurs. Limit: 2,000 passages
per import, 20 MiB input manifest, 30-second RPC timeout. Model download and local
inference happen before that RPC timeout. There are no automatic retries.

## Storage, search, and access

Migration `035_paper_passage_search.sql` adds:

- `paper_passage_sources`, keyed by paper and source version, with the pinned
  embedding model and passage count.
- `paper_passages`, containing canonical text, physical page, offsets, a
  384-dimensional vector, and English full-text search data.
- A service-role-only import RPC. Parent and passages are inserted atomically;
  identical retries reuse the existing source, and changed canonical content
  cannot overwrite a published version. Retried embeddings are not rewritten.
- A caller-RLS search RPC that combines exact cosine similarity and keyword
  ranking with reciprocal-rank fusion. Search is scoped to paper and version
  before ranking. An ANN index is unnecessary for this initial per-paper scope.

Attending members, the paper's meeting leader, operators, and admins can read
the corresponding passages. Declined members, members without an attending
RSVP, and unlinked users receive no passages unless another allowed role applies.
Anonymous users have no table or RPC access. Authenticated members cannot write.

This is separate from the 768-dimensional SPECTER2 recommendation cache.
Changing the passage embedding model requires a new versioned schema/index.
Source identity includes the PDF hash, exact extracted pages, and extraction and
chunking versions. Preserve the manifest: the minimal database source row does
not retain the complete extraction metadata or Drive association.

The CLI validates returned IDs, pages, and text against the local manifest.
Search rank does not prove that an answer is supported. Before launch, evaluate
October-paper retrieval, add the durable source association and active-version
pointer, implement citation validation, and connect the authenticated UI.
The Node/ONNX module cannot be imported unchanged into a Deno Edge Function.

## Verification

Run `npm test`, `npm run lint`, and `npm run typecheck` in `web/` on Node 24.
Tests cover adapter scoping, invalid embeddings, safe errors, chunk identity,
token limits, CLI configuration and remote-write guard, plus the retained
Turbopuffer path. Real local model inference produced two normalized vectors of
384 dimensions on Node 24.16.0. Retrieval quality for paper 41 is still untested.

The SQL fixture is intentionally limited to a disposable database named
`paperpal_retrieval_test`. It creates synthetic auth roles and member records;
do not point it at a Supabase project. From the repository root, with Docker:

```sh
docker run --name paperpal-retrieval-test --network none \
  -e POSTGRES_HOST_AUTH_METHOD=trust -d pgvector/pgvector:pg17
# Wait until the container is ready (pg_isready exits successfully).
docker exec paperpal-retrieval-test pg_isready -U postgres
docker cp migrations paperpal-retrieval-test:/migrations
docker cp tests paperpal-retrieval-test:/tests
docker exec paperpal-retrieval-test createdb -U postgres paperpal_retrieval_test
docker exec paperpal-retrieval-test psql -U postgres -d paperpal_retrieval_test \
  -v ON_ERROR_STOP=1 -f /tests/paper_passage_search_fixture.sql \
  -f /tests/paper_passage_search_test.sql
docker rm -f paperpal-retrieval-test
```

The tests verify atomic rollback, immutable/idempotent imports, paper/version
isolation, hybrid ranking, member RLS, and explicit grants. They passed on
Postgres 17 with pgvector. This checks database behavior directly; it does not
claim end-to-end Supabase REST connectivity or a production migration.

After applying 035 to an intended Supabase environment, verify the two tables
have RLS enabled and inspect their grants/policies. Exercise the RPC with both
an authorized member token and a denied member token before wiring the UI.
Regenerate the project's database types when the application starts using the
new tables through typed Supabase accessors; this adapter uses validated REST.

Reference: [Supabase hybrid search](https://supabase.com/docs/guides/ai/hybrid-search).
