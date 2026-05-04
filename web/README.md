# WiDS Member App

Next.js 14 portal for the WiDS NYC AI Reading Group.

## Local dev

1. Copy `.env.example` to `.env.local` and fill in values from Supabase project.
2. `npm install`
3. `npm run dev` — opens http://localhost:3000

## Deployment

The portal is hosted on Vercel with the project's Root Directory set to `web/`. Authentication is handled by Supabase via magic-link sign-in. For the step-by-step first-time setup, see [DEPLOYMENT.md](DEPLOYMENT.md).

### Environment variables

| Name                              | Source                          | Notes                                                                                                                                       |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`        | Supabase project settings → API | Public; baked into client bundle.                                                                                                           |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`   | Supabase project settings → API | Public; safe to expose to browser — Supabase RLS enforces access control.                                                                 |
| `SUPABASE_SERVICE_ROLE_KEY`       | Supabase project settings → API | Secret; mark Sensitive in Vercel.                                                                                                           |
| `NEXT_PUBLIC_SITE_URL`            | Vercel deployment URL           | e.g. `https://wids-nyc.vercel.app`. Used to build magic-link callback URLs.                                                                 |
| `NEXT_PUBLIC_GITHUB_REPO`         | This repo                       | `mrojas54/wids-nyc-reading-group-assistant`. Used for the Colab "Open notebook" button on companion pages; if unset, the button is hidden.  |

### Vercel project shape

- **Root Directory:** `web` (without this, Vercel won't find the Next.js app).
- **Framework preset:** Next.js (auto-detected when Root Directory is correct).
- **Deployment Protection:** Vercel Authentication on for Production until cutover. Removed in member-app plan task 9.3 once members are ready to sign in.

### Supabase auth callback

`<vercel-url>/auth/callback` must be in the Supabase project's allowed redirect URLs (Supabase dashboard → Authentication → URL Configuration). Without this, magic-link sign-in returns a 404 and the user is stuck on the callback page.
