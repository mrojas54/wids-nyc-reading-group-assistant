# WiDS Member App

Next.js 14 portal for the WiDS NYC AI Reading Group.

## Routes

| Route | What it does |
| --- | --- |
| `/` | Magic-link sign-in. Email field → Supabase sends a link → callback hands off to `/dashboard`. |
| `/dashboard` | Authenticated home. Light `card-hero` shows the next meeting (eyebrow → paper title → time/place/leader → RSVP buttons). When a prep meeting is open and the member hasn't submitted availability yet, a sage `hero-nudge` folds into the hero — tapping it routes to `/availability?meeting=<id>`. Once submitted, the nudge flips to a confirmed "Tap to change availability" state. A promoted Paper Pal card sits below the hero when the paper has a `companion_url`. The secondary stack ("Since you joined" stats + history) is demoted. |
| `/availability` | 30-day month-grid date picker (`MonthCalendar`). Without a query param, it uses the latest `meetings.status='prep'` row by `created_at DESC`. With `?meeting=<id>`, the id must be a positive integer for an existing prep meeting or the page 404s rather than silently falling back to another poll. Submitting replaces that member's rows for the meeting (delete existing rows, then insert selected 6–9 PM ET windows). When no prep poll is open, the page renders the shared `empty-state` "Sit tight." |
| `/new` | Paper Pal synthesis upload page (`/new?paperId=<id>`). Gated by the `can_synthesize_paper_pal` RPC — only operator/admin or the paper's meeting leader sees the upload form. `NewPaperForm` uploads the PDF to the `papers-pdfs` bucket and POSTs `/functions/v1/analyze-paper`, streaming a 5-stage SSE progress flow. |
| `/papers/[id]` | Paper Pal reading page. If `paper_companions.payload` exists, renders the synthesized dashboard + assessment panel; else falls back to a static `web/content/papers/<id>.json` fixture; else shows a synthesize CTA (owner/leader) or read-only empty state; else 404s. No auth is required to read existing content — only synthesis is gated. |
| `/admin/suggest` | Paper search/rank tool. Linked from the dashboard as "Find a paper" when the member's role is `operator` / `leader` / `admin`; the API enforces the same leader-role requirement. See [../docs/admin-suggest.md](../docs/admin-suggest.md). |

## UI conventions

- **Single CSS file:** all tokens and component classes live in [`app/globals.css`](app/globals.css). Sage-led palette (`--color-sage-*` for brand surfaces), warm paper neutrals (`--color-paper-*`), magenta accent (`--color-magenta-*`) used sparingly for the selected-state day-toggle, history badges, and the Companion eyebrow.
- **Mobile-first.** The `.shell` is `max-width: 480px` and pages stack in one column. No two-column desktop layouts.
- **No icon library.** Inline 1.5-px-stroke SVG paths live in [`components/ui/Icon.tsx`](components/ui/Icon.tsx) (`arrowRight`, `check`, `calendar`, `clock`, `mapPin`, `external`, `chevronDown`, `chevronRight`, `mail`).
- **Design system source of truth:** the upstream Claude Design export (`wids-nyc-design-system`, `ui_kits/member-portal/v2/`). Key v2 classes added in the May 2026 redesign: `card-hero`, `hero-nudge`, `companion-card`, `section-h-soft`, `stats-v2`, `empty-state`, `skel`, `cal-stack` / `cal-month` / `cal-grid` / `day` / `cal-summary`.

## Local dev

1. Copy `.env.example` to `.env.local` and fill in values from Supabase project.
2. `npm install`
3. `npm run dev` — opens http://localhost:3000

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
  op run --env-file <(printf 'BLOB_READ_WRITE_TOKEN=op://Personal/4vsjnrbjyhlqju5mbtw2kcf3ba/credential\nSPECTER2_MODEL_BLOB_URL=https://dzoasz69j2a1a7lp.private.blob.vercel-storage.com/specter2/specter2_int8.onnx\nRUN_PARITY=1\n') -- \
    /Users/michellerojas/.nvm/versions/node/v20.18.0/bin/npm --prefix . test -- lib/suggest/__tests__/parity.test.ts
  ```

  **Why the explicit npm path?** macOS has a stale system npm at `/usr/local` that
  predates `node:path` support. The nvm binary at the path above is the correct one.
  If you've updated Node via nvm since this was written, adjust the path.

  Thresholds: median cos ≥ 0.99, min cos ≥ 0.93. Last verified: 2026-05-16,
  median=0.9914, min=0.9908 (all 11 fixtures). Requires
  `scripts/specter2_parity_fixtures.json` to exist.
