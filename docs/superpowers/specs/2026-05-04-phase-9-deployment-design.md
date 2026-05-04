# Phase 9 (9.1) — Deployment docs

**Date:** 2026-05-04
**Phase:** 9.1 of [member-app plan](../plans/2026-05-03-wids-member-app.md) — Configure Vercel project (repo-side deliverables only)
**Out of scope:** Tasks 9.2 (pilot test) and 9.3 (cycle-end cutover) — separate sessions when we're at those stages.

## Context

Phase 9.1 of the member-app plan asks for a "Deployment" section in `web/README.md` covering env vars and the Supabase redirect URL gotcha. The rest of 9.1 is manual UI work in the Vercel and Supabase dashboards (creating the project, setting env vars, enabling deployment protection, adding the callback URL). The plan itself documents those steps inline as a one-time implementation checklist.

The operator (Michelle) is starting from zero — no Vercel project exists yet. So beyond the README ask, this session also produces a durable runbook that walks through the dashboard clicks. The plan's checklist ages out once the implementation is done; a runbook is useful any time someone needs to re-do the Vercel setup (new account, V2 backup operator, recovery from a deleted project).

Today's `web/README.md` is a 14-line stub: 3 lines of local-dev steps and a 2-line "Deploy" section. The 5 env vars are already correctly listed in `web/.env.example`.

## Deliverables

Three changes, no app code touched:

### 1. `web/README.md` — replace "Deploy" with "Deployment" reference section

Edit lines 11–13 (the 2-line "Deploy" stub). The new section is **reference-style**: it describes the deployment shape so future readers can verify their config and debug. It is not a chronological setup checklist — that's what `DEPLOYMENT.md` is for.

Structure:

```markdown
## Deployment

[1-paragraph overview: Vercel-hosted, Root Directory = web/, Supabase
provides auth via magic link. Link forward to DEPLOYMENT.md for first-time
setup steps.]

### Environment variables

| Name                              | Source                          | Notes                                       |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`        | Supabase project settings       | Public; baked into client bundle.           |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`   | Supabase project settings       | Public; safe to expose to browser.          |
| `SUPABASE_SERVICE_ROLE_KEY`       | Supabase project settings       | Secret; mark Sensitive in Vercel.           |
| `NEXT_PUBLIC_SITE_URL`            | Vercel deployment URL           | e.g. `https://wids-nyc.vercel.app`. Used to build magic-link callback URLs. |
| `NEXT_PUBLIC_GITHUB_REPO`         | This repo                       | `mrojas54/wids-nyc-reading-group-assistant`. Used for the Colab "Open notebook" button on companion pages; if unset, button is hidden. |

### Vercel project shape

- **Root Directory:** `web` (without this, Vercel won't find the Next.js app)
- **Framework preset:** Next.js (auto-detected when Root Directory is correct)
- **Deployment Protection:** Vercel Authentication on for Production until cutover.
  Removed in task 9.3 once members are ready to sign in.

### Supabase auth callback

`<vercel-url>/auth/callback` must be in the Supabase project's allowed redirect
URLs (Supabase dashboard → Authentication → URL Configuration). Without this,
magic-link sign-in returns a 404 and the user is stuck on the callback page.

### First-time setup

See [DEPLOYMENT.md](DEPLOYMENT.md) for the step-by-step runbook.
```

### 2. `web/DEPLOYMENT.md` — new file, step-by-step runbook

Top-to-bottom, "click this, paste that" walkthrough. Useful once during initial setup, then again any time the Vercel project needs to be recreated. Sections:

1. **Prerequisites** — GitHub access to `mrojas54/wids-nyc-reading-group-assistant`, Vercel account, Supabase project URL + anon key + service_role key.
2. **Create Vercel project** — vercel.com → Add New → Project → Import the GitHub repo → set **Root Directory = `web`** → framework preset auto-fills to Next.js → don't deploy yet.
3. **Set environment variables** — paste the 5 vars (Production + Preview), mark `SUPABASE_SERVICE_ROLE_KEY` as Sensitive. (`NEXT_PUBLIC_SITE_URL` will be filled in after first deploy in step 5.)
4. **Enable Deployment Protection** — Settings → Deployment Protection → Vercel Authentication ON for Production. Members can't sign in until this is removed at cutover.
5. **Trigger first deploy** — push the branch (or click Deploy). Watch build logs. Note the assigned Vercel URL. Update `NEXT_PUBLIC_SITE_URL` env var with this URL and redeploy.
6. **Add Supabase callback URL** — Supabase dashboard → Authentication → URL Configuration → Redirect URLs → add `<vercel-url>/auth/callback`. **Without this, magic-link sign-in 404s.**
7. **Smoke test** — visit `<vercel-url>/`. Expected: Vercel password gate → WiDS sign-in page.
8. **Common issues** — 4-row troubleshooting table:
   - Magic link returns 404 → forgot step 6
   - Build fails "no Next.js project found" → Root Directory not set to `web`
   - Magic link redirects to localhost → `NEXT_PUBLIC_SITE_URL` still defaults to localhost
   - Vercel password gate not appearing → Deployment Protection not enabled

### 3. Plan typo fix

[docs/superpowers/plans/2026-05-03-wids-member-app.md:2291](../plans/2026-05-03-wids-member-app.md) line 2291 has the env var value as `<owner>/wids_reading_group_assisstant` (underscores, double-s). Replace with `mrojas54/wids-nyc-reading-group-assistant` to match the actual repo and avoid copy-paste errors during dashboard setup.

## Why two docs instead of one

- **`web/README.md`** is the durable reference. Read repeatedly when verifying config or debugging. Doesn't go stale because the deployment shape doesn't change often.
- **`web/DEPLOYMENT.md`** is the runbook. Read once during initial setup, then again only on rare events (account migration, V2 backup operator setup, project recreation). Lives separately because it's setup-time content, not config reference.

Cramming both into one file would muddle the audience: someone debugging a 404 doesn't want to scroll past 8 setup steps to find the callback URL note.

## Why this is decoupled from 9.2 and 9.3

The operator chose scope A: just 9.1 repo-side deliverables. Tasks 9.2 (pilot e2e tests) and 9.3 (cycle-end cutover — disable `process-form`, send announcement email, remove deployment protection, monitor 48h, retire Google Form) only become actionable once the deploy is up and a cycle is ready to wrap. Drafting the announcement email or monitoring SQL now would be premature: the live URL doesn't exist yet, and the cycle context for the email isn't known.

The plan already serves as the chronological checklist for 9.2 and 9.3. They'll get their own brainstorm/spec/plan triplet when their time comes.

## Acceptance

The deliverables ship when:

1. `web/README.md` has the new "Deployment" section. Old "Deploy" stub is gone. Renders correctly on GitHub.
2. `web/DEPLOYMENT.md` exists with all 8 sections above, in order.
3. `web/README.md` has a working link to `DEPLOYMENT.md`.
4. The plan typo at line 2291 is fixed.
5. All four changes land in one commit so they're reviewable as a unit.

No app code, no migrations, no scheduled-task changes. The Vercel project itself is created manually by the operator after the docs ship.
