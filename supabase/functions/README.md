# Paper Pal Edge Functions

Three Supabase Edge Functions implementing the in-portal synthesis +
assessment workflow specified in
[`docs/superpowers/specs/2026-05-17-paper-pal-edge-functions.md`](../../docs/superpowers/specs/2026-05-17-paper-pal-edge-functions.md).

| Function | Method | Purpose | Spec ref |
|---|---|---|---|
| `analyze-paper` | POST (SSE) | Synthesize a ResearchPaperAnalysis from a PDF | §4.1 |
| `analyze-hint` | POST (JSON) | Socratic hint on an assessment attempt | §4.2 |
| `analyze-socratic` | POST (JSON) | Next turn in a Socratic conversation | §4.3 |

All three require a Supabase JWT in `Authorization: Bearer ...`.
`analyze-paper` uses the `can_synthesize_paper_pal` RPC (migration 017);
`analyze-hint` and `analyze-socratic` use the looser attending-member gate
in `_shared/gate.ts` so RSVP'd readers and the meeting's `leader_id` (even
without an RSVP) can use assessment helpers.

## Layout

```
supabase/functions/
├── README.md              ← this file
├── deno.json              ← Deno config (importMap → import_map.json)
├── import_map.json        ← maps "zod" → "npm:zod@^4"; etc.
├── _shared/
│   ├── cors.ts            ← CORS headers + preflight handler
│   ├── gate.ts            ← canSynthesizePaperPal, canRequestHint
│   ├── json.ts            ← jsonResponse / errorResponse helpers
│   ├── sse.ts             ← SSE stream emitter (spec §13.1 headers)
│   └── supabase.ts        ← authClient(jwt) / serviceClient() factories
├── analyze-paper/index.ts
├── analyze-hint/index.ts
└── analyze-socratic/index.ts
```

Provider abstraction lives in `web/lib/paperpal/providers/` and is imported
via relative path (`../../../web/lib/paperpal/providers/index.ts`). The
import map aliases `zod` to the npm specifier so both Node tests and Deno
Edge Functions resolve the same package.

**Deno version:** pin is the repo-root [`.dvmrc`](../../.dvmrc) (currently
`2.9.5`). CI's edge-functions job and `.cursor/install.sh` both install from
that file — bump it in one place when upgrading Deno.

## Environment variables

Set in Supabase Cloud:

```
supabase secrets set \
  PAPER_PAL_PROVIDER=gemini \
  PAPER_PAL_REGEN_COOLDOWN_SEC=300 \
  PAPER_PAL_PRUNE_DRY_RUN=true \
  GEMINI_API_KEY=... \
  ANTHROPIC_API_KEY=...
```

Auto-injected by the Supabase runtime (do NOT set manually in cloud):
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

| Variable | Required | Default | Notes |
|---|---|---|---|
| `PAPER_PAL_PROVIDER` | yes | `gemini` | `gemini` or `claude`. Admin callers can override per-request (spec §13.5). |
| `GEMINI_API_KEY` | if provider=gemini | — | Google AI Studio key. |
| `ANTHROPIC_API_KEY` | if provider=claude | — | Anthropic Console key. |
| `PAPER_PAL_REGEN_COOLDOWN_SEC` | no | `300` | Per-paper rate-limit window. Use `30` in preview/dev (spec §11.5 Q5). |
| `PAPER_PAL_PRUNE_DRY_RUN` | no | `true` | Read by the `wids-prune-paper-pdfs` scheduled task, not by the functions. |

## Deploy

```
supabase functions deploy analyze-paper    --import-map supabase/functions/import_map.json --execution-timeout 120
supabase functions deploy analyze-hint     --import-map supabase/functions/import_map.json --execution-timeout 30
supabase functions deploy analyze-socratic --import-map supabase/functions/import_map.json --execution-timeout 30
```

The `--execution-timeout` values follow spec §13.3: synthesis ≈60s budget +
buffer, hint/socratic are cheap.

## Storage bucket

Migration `018_papers_pdfs_bucket.sql` creates the private `papers-pdfs`
bucket and the authenticated INSERT policy used by `/new`. Upload paths
must be `<paper_id>/<uuid>.pdf`; the policy extracts the first path segment
and allows inserts only when `can_synthesize_paper_pal(<paper_id>)` returns
`canSynthesize=true`.

There are no regular SELECT / UPDATE / DELETE policies. `analyze-paper`
mints service-role signed URLs for provider fetches, and the weekly
`wids-prune-paper-pdfs` scheduled task uses the service role for cleanup.
The browser enforces a 32 MB PDF limit before upload.

For the member/leader workflow and troubleshooting, see
[`docs/paper-pal-portal.md`](../../docs/paper-pal-portal.md).

## Local dev

```
supabase functions serve analyze-paper --env-file supabase/functions/.env.local
```

Create `supabase/functions/.env.local` (gitignored by the secret-guard hook)
with the variables above, swapping `PAPER_PAL_REGEN_COOLDOWN_SEC=30` so
iteration isn't blocked by the prod cooldown.
