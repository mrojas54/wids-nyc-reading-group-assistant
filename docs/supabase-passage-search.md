# Supabase passage search for Paper Pal

Supabase is the default local retrieval backend. Turbopuffer remains available
for later through `PAPERPAL_RETRIEVAL_BACKEND=turbopuffer` and its existing CLI.
This change adds no subscription. It implements the retrieval foundation;
discussion, cited answer generation, and understanding checks are not wired to
the member UI yet. Migration 035 is now applied to the live database and October paper 41 has 119
indexed passages. See the [October 12 verification](paper-41-index-verification.md).

## Runtime and configuration

From `web/`, run `nvm install && nvm use` and `npm ci`. The engine requirement
is **Node >=22.12.0**; `.nvmrc` pins **22.22.3**, also used by CI.

Copy `.env.paperpal.example` to `.env.paperpal.local` if it does not already
exist. The CLI loads this file, not the portal's production `.env.local`.
The example points at a local Supabase API on `127.0.0.1:54321`; it does not
start that API or supply credentials. Set the URL and key for the intended
development database after applying migration 035 with its prerequisites.

- Ingestion (`index` only): put the target project's server-side service-role
  key in `PAPERPAL_SUPABASE_SERVICE_ROLE_KEY`. Never expose it through a
  `NEXT_PUBLIC_*` variable. No other command reads it.
- Member search: use the publishable/anon key and set
  `PAPERPAL_SUPABASE_ACCESS_TOKEN` to the member's access JWT. Search refuses to
  run without it, and refuses an access token that is the API key, a
  `sb_secret_` key, or a JWT with the `service_role` role, so it never reads
  around RLS. To evaluate with full visibility, use an operator or admin
  member's JWT.
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
after the manifest path. The first live migration and paper-41 import were completed on October 12, 2026. The referenced paper must already exist in the target database.

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

Operators, admins, and the paper's meeting leader can read the corresponding
passages. Other members can read them while they have an `attending` RSVP for a
meeting on that paper that is still `scheduled` and started no more than 24 hours
ago (migration 036). Members write their own RSVPs and every active member is
invited to a scheduled meeting, so RSVPing to an upcoming meeting is the intended
way in; an RSVP to a cancelled, finished, or past meeting grants nothing.
Declined members, members without such an RSVP, and unlinked users receive no
passages unless another allowed role applies.
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

Run `npm test`, `npm run lint`, and `npm run typecheck` in `web/`.
Tests cover adapter scoping, invalid embeddings, safe errors, chunk identity,
token limits, CLI configuration and remote-write guard, plus the retained
Turbopuffer path. Real local model inference produced two normalized vectors of
384 dimensions on Node 24.16.0. Initial paper-41 spot checks found ranking weaknesses; see the live verification report.

The SQL test runs in CI (the `sql` job) against a throwaway Postgres 17 with
pgvector. `tests/paper_passage_search_run.sh` creates the disposable
`paperpal_retrieval_test` database, stubs the Supabase roles, `auth`, and
`storage` schemas, applies every migration in numeric order, and runs the test.
It drops and recreates that database, so never point it at a Supabase project.
Locally, with Docker:

```sh
docker run --name paperpal-retrieval-test -p 127.0.0.1:55432:5432 \
  -e POSTGRES_HOST_AUTH_METHOD=trust -d pgvector/pgvector:0.8.0-pg17
# Wait until the container is ready (pg_isready exits successfully).
docker exec paperpal-retrieval-test pg_isready -U postgres
PGHOST=127.0.0.1 PGPORT=55432 PGUSER=postgres tests/paper_passage_search_run.sh
docker rm -f paperpal-retrieval-test
```

The tests verify atomic rollback, immutable/idempotent imports, paper/version
isolation, hybrid and keyword ranking, member RLS (including self-RSVPs to
cancelled or past meetings), and explicit grants. They passed on
Postgres 17 with pgvector. This checks database behavior directly; it does not
claim end-to-end Supabase REST connectivity or a production migration.

After applying 035 to an intended Supabase environment, verify the two tables
have RLS enabled and inspect their grants/policies. Exercise the RPC with both
an authorized member token and a denied member token before wiring the UI.
Regenerate the project's database types when the application starts using the
new tables through typed Supabase accessors; this adapter uses validated REST.

Reference: [Supabase hybrid search](https://supabase.com/docs/guides/ai/hybrid-search).

## Answer-oriented reranking

The Node Supabase adapter normally combines eight hybrid candidates with up to
eight keyword candidates from the canonical passage table, deduplicates them,
validates all paper/source memberships and excerpts, and reranks locally before
returning the requested number. Larger result limits increase the hybrid pool;
the combined pool is capped at 100 candidates. Keyword lookup runs concurrently
with query embedding and uses the same caller token and paper/source filters.
It removes question boilerplate and searches adjacent content-word phrases
through `match_paper_passage_keywords` (migration 036), which returns the best
matches by `ts_rank_cd`, with page and offset only as the tie-break.
The full original question still drives embeddings, hybrid search, and reranking.
Negated questions, questions without content terms, and questions with more than
12 content terms retain the wider 64–100 candidate path. Those queries may be slower.
Authorization or malformed-response errors fail the request; no response cache
bypasses live access checks. The database RPC remains
the first-stage hybrid search; callers that bypass the Node adapter do not get
reranking. No passage migration or reindex is required.

The additional model is quantized
[`Xenova/ms-marco-MiniLM-L-6-v2`](https://huggingface.co/Xenova/ms-marco-MiniLM-L-6-v2),
pinned to revision `a09144355adeed5f58c8ed011d209bf8ee5a1fec`. It scores question /
passage pairs in batches of eight. Its first use downloads model artifacts to the
same local cache as GTE; questions and excerpts are not sent to an inference API.
Model download or inference failure is surfaced as an error, not silently treated
as a successful reranked response.

For ranking only, repeated whitespace is collapsed and each pair is limited to
512 tokens. Canonical excerpts, IDs, page numbers, and offsets remain unchanged.
A narrow definition rule promotes explicit definitions when the question asks
for a definition, the cross-encoder logit is positive, and a substantive question
term appears in the passage. This is a relevance heuristic, not a guarantee of
support. It contains no paper IDs, passage IDs, or paper-specific keywords.

Returned `score` is now the cross-encoder logit, not a probability; `hybridScore`
preserves the first-stage fusion score (zero for lexical-only candidates). Definition priority precedes logit order,
so consumers should retain the returned order rather than sorting on `score`.
The extra model adds CPU, memory, and latency; measure it on the intended server
before enabling interactive discussion. Long pairs can lose tail context for
ranking, although the returned canonical passage remains complete.

The opt-in live evaluation is read-only and is separate from the offline test
suite. Configure `.env.paperpal.local` for the intended project and credential,
then from `web/` run:

```sh
node --conditions=react-server --env-file=.env.paperpal.local scripts/evaluate-passage-retrieval.mts
```

The fixed evaluation fixture pins October's source version and checks that known
supporting passage IDs occur in the top three for five questions. It includes
two paraphrases and a training-question regression. A passing result is bounded
evidence for those questions, not a broad retrieval benchmark or member-RLS test.
For the offline suite on a busy workstation, `npm test -- --maxWorkers=2` limits
CPU contention without relaxing test timeouts.

## Interactive retrieval benchmark

From `web/`, with the intended read credentials configured:

```sh
node --conditions=react-server --env-file=.env.paperpal.local scripts/benchmark-passage-retrieval.mts
```

This read-only benchmark repeats the five source-pinned questions three times,
checks supporting evidence in the top three, and reports candidate counts,
stage durations, cold-process latency, and warm p50/p95. It exits unsuccessfully
on a quality regression. Stage durations overlap because embedding and keyword
lookup run concurrently; network stage timers measure fetch completion, not
response JSON parsing. It does not generate answers. Like search, it requires a
member access token and runs under that member's RLS.

The October 12 local run passed 15/15 checks with 11–15 reranked candidates.
Across 14 warm requests, median latency was 1.025 seconds and p95 was 4.593
seconds. The first request was 1.710 seconds with model files already cached.
These are small-sample workstation measurements, not a production latency SLA;
fresh model downloads and concurrent server load need separate measurement.
