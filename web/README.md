# WiDS Member App

Next.js portal for the WiDS NYC AI Reading Group.

## Routes

| Route | What it does |
| --- | --- |
| `/` | Magic-link sign-in. Email field → Supabase sends a link → callback hands off to `/dashboard`. |
| `/dashboard` | Authenticated home. Light `card-hero` shows the next meeting (eyebrow → paper title → time/place/leader → RSVP buttons). When a prep meeting is open and the member hasn't submitted availability yet, a sage `hero-nudge` folds into the hero — tapping it routes to `/availability?meeting=<id>`. Once submitted, the nudge flips to a confirmed "Tap to change availability" state. A promoted Paper Pal card sits below the hero when the paper has a `paper_companions` row; legacy papers can fall back to `papers.companion_url`. The secondary stack ("Since you joined" stats + history) is demoted. |
| `/availability` | 30-day month-grid date picker (`MonthCalendar`). Without a query param, it uses the first `meetings.status='prep'` row ordered by `created_at DESC`, `type DESC`, then `id DESC`; the type tie-break deliberately prefers `reading_group` over `admin` when bootstrap gave both rows the same timestamp. With `?meeting=<id>`, the id must be a positive integer for an existing prep meeting or the page 404s rather than silently falling back to another poll. Submitting replaces that member's rows for the meeting (delete existing rows, then insert selected 6–9 PM ET windows). When no prep poll is open, the page renders the shared `empty-state` "Sit tight." |
| `/papers` | Paper Pal inbox. Shows reading now, upcoming lead picks, member-proposed "want to lead" suggestions, and recently discussed papers. Signed-in roster members can propose catalog papers or volunteer for proposed meetings. See [../docs/paper-pal-portal.md](../docs/paper-pal-portal.md). |
| `/new` | Paper Pal synthesis upload page (`/new?paperId=<id>`). Gated by the `can_synthesize_paper_pal` RPC — only operator/admin or the paper's meeting leader sees the upload form. `NewPaperForm` uploads the PDF to the `papers-pdfs` bucket and POSTs `/functions/v1/analyze-paper`, streaming a 5-stage SSE progress flow. |
| `/papers/[id]` | Paper Pal reading page. If `paper_companions.payload` exists, renders the synthesized dashboard + assessment panel; else falls back to a static `web/content/papers/<id>.json` fixture; else shows a synthesize CTA (owner/leader) or read-only empty state; else 404s. No auth is required to read existing content — only synthesis is gated. |
| `/papers/[id]/present` | Presenter mode. Requires `paper_companions.payload`; derives slides from the synthesized companion and 404s when no payload exists. |
| `/admin/suggest` | Paper search/rank tool. Direct access and the API require an `operator` / `leader` / `admin` role. The dashboard's "Find a paper" prompt has an additional condition: it disappears once the next meeting has a paper. See [../docs/admin-suggest.md](../docs/admin-suggest.md). |
| `/admin/logs` | Operator event log over `command_log`. Requires the same leader-role gate as `/admin/suggest`, reads with the service-role client because the table is RLS-locked, and shows failures/warnings, filters, expandable context, and keyset "Load more" pagination. See [../docs/admin-logs.md](../docs/admin-logs.md). |

## UI conventions

- **Single CSS file:** all tokens and component classes live in [`app/globals.css`](app/globals.css). Sage-led palette (`--color-sage-*` for brand surfaces), warm paper neutrals (`--color-paper-*`), magenta accent (`--color-magenta-*`) used sparingly for the selected-state day-toggle, history badges, and the Companion eyebrow.
- **Tailwind v4 is CSS-first.** There is no `tailwind.config.*`; PostCSS loads Tailwind through [`@tailwindcss/postcss`](postcss.config.mjs), and `globals.css` starts with `@import 'tailwindcss'`. Keep custom theme tokens in the `@theme inline` block so generated utilities resolve to the runtime CSS variables defined later in `:root`.
- **Border-color compatibility is intentional.** Tailwind v4 changed the default border color to `currentcolor`; the base-layer shim in `globals.css` preserves the v3 visual default. Remove it only after adding explicit border color utilities anywhere that depended on the old default.
- **Mobile-first.** The `.shell` is `max-width: 480px` and pages stack in one column. No two-column desktop layouts.
- **No icon library.** Inline 1.5-px-stroke SVG paths live in [`components/ui/Icon.tsx`](components/ui/Icon.tsx) (`arrowRight`, `check`, `calendar`, `clock`, `mapPin`, `external`, `chevronDown`, `chevronRight`, `mail`).
- **Design system source of truth:** the upstream Claude Design export (`wids-nyc-design-system`, `ui_kits/member-portal/v2/`). Key v2 classes added in the May 2026 redesign: `card-hero`, `hero-nudge`, `companion-card`, `section-h-soft`, `stats-v2`, `empty-state`, `skel`, `cal-stack` / `cal-month` / `cal-grid` / `day` / `cal-summary`.

## Local dev

1. Copy `.env.example` to `.env.local` and fill in values from Supabase project.
2. Run `nvm install && nvm use` to install/select Node from [`.nvmrc`](.nvmrc) (`22.22.3`; package metadata requires `>=22.12.0`).
3. `npm ci`
4. `npm run dev` — opens http://localhost:3000

## Contributing checks

CI installs from [`package-lock.json`](package-lock.json) with `npm ci`, then
runs a **production-only** high-severity audit, lint, type-checking, and unit
tests. Match those gates before web changes, and run the production build for
deployment-sensitive changes:

```sh
npm audit --audit-level=high --omit=dev
npm run lint
npm run typecheck
npm run test
npm run build
```

### Why `--omit=dev` on the audit

The CI audit is temporarily narrowed to production dependencies
(`npm audit --audit-level=high --omit=dev`). A bare `npm audit --audit-level=high`
can fail locally on GHSA-mh99-v99m-4gvg (`brace-expansion` under the eslint
toolchain) even when CI is green — that advisory has no reachable fix without
breaking lint (`eslint-config-next` → eslint plugins → `minimatch@3` →
`brace-expansion@1.1.x`). The excluded packages are lint tooling only; they do
not ship in the Vercel bundle. The workflow step in
[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) carries the full
chain, failed upgrade attempts, and a `REVERT WHEN` note — drop `--omit=dev`
once upstream moves to `minimatch@10` or a patched `brace-expansion` 1.1.x
lands.

The app is intentionally forced onto Webpack for Next commands (`next dev --webpack`, `next build --webpack`). Vite is used by Vitest only, so Vite upgrades affect tests rather than the production bundle.

## Deployment

The portal is hosted on Vercel with the project's Root Directory set to `web/`. Authentication is handled by Supabase via magic-link sign-in. For the step-by-step first-time setup, see [DEPLOYMENT.md](DEPLOYMENT.md).

### Environment variables

| Name                              | Source                          | Notes                                                                                                                                       |
| --------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`        | Supabase project settings → API | Public; baked into client bundle.                                                                                                           |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`   | Supabase project settings → API | Public; safe to expose to browser — Supabase RLS enforces access control.                                                                 |
| `SUPABASE_SERVICE_ROLE_KEY`       | Supabase project settings → API | Secret; mark Sensitive in Vercel.                                                                                                           |
| `NEXT_PUBLIC_SITE_URL`            | Vercel deployment URL           | e.g. `https://wids-nyc.vercel.app`. Used to build magic-link callback URLs.                                                                 |
| `NEXT_PUBLIC_GITHUB_REPO`         | This repo                       | `mrojas54/wids-nyc-reading-group-assistant`. Used for the Colab "Open notebook" button on companion pages; if unset, the button is hidden.  |
| `SPECTER2_MODEL_BLOB_URL`         | Vercel Blob                     | Private Blob URL for `specter2_int8.onnx`. Required when `/admin/suggest` falls back to local WASM embeddings or runs cache warmup.          |
| `BLOB_READ_WRITE_TOKEN`           | Vercel Blob                     | Secret token read by `@vercel/blob` for private model fetches. Required with `SPECTER2_MODEL_BLOB_URL`; mark Sensitive in Vercel.            |
| `S2_API_KEY`                      | Semantic Scholar                | Optional. When unset, suggest calls S2 unauthenticated and falls back to WASM immediately on 429 rate limits.                                |

For the full suggest/SPECTER2 workflow, cache warmup, and troubleshooting guide,
see [../docs/admin-suggest.md](../docs/admin-suggest.md).

### Vercel project shape

- **Root Directory:** `web` (without this, Vercel won't find the Next.js app).
- **Framework preset:** Next.js (auto-detected when Root Directory is correct).
- **Deployment Protection:** Vercel Authentication on for Production until cutover. Removed in [member-app plan task 9.3](../docs/superpowers/plans/2026-05-03-wids-member-app.md#task-93-cycle-end-cutover) once members are ready to sign in.

### Supabase auth callback

`<vercel-url>/auth/callback` must be in the Supabase project's allowed redirect URLs (Supabase dashboard → Authentication → URL Configuration). Without this, magic-link sign-in returns a 404 and the user is stuck on the callback page.

## Tests

- `npm test` — runs unit tests with vitest. Fast.
- **Parity test** (slow, ~30s; loads 113 MB ONNX from private Vercel Blob):

  Two env vars are required: `SPECTER2_MODEL_BLOB_URL` (the private blob URL) and
  `BLOB_READ_WRITE_TOKEN` (the Vercel Blob write token, stored in 1Password).
  Use `op run` to inject the token without it touching your shell history:

  ```sh
  nvm use 20   # Node 20+; a stale macOS system npm at /usr/local predates node:path support
  op run --env-file <(printf 'BLOB_READ_WRITE_TOKEN=op://Personal/4vsjnrbjyhlqju5mbtw2kcf3ba/credential\nSPECTER2_MODEL_BLOB_URL=https://dzoasz69j2a1a7lp.private.blob.vercel-storage.com/specter2/specter2_int8.onnx\nRUN_PARITY=1\n') -- \
    npm --prefix . test -- lib/suggest/__tests__/parity.test.ts
  ```

  Thresholds: median cos ≥ 0.99, min cos ≥ 0.93 across all fixtures in
  `scripts/specter2_parity_fixtures.json` (which must exist).
