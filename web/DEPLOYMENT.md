# First-time Vercel deployment

This is the one-time runbook for deploying the WiDS member portal to Vercel. After initial setup, deploys are automatic on push to `main`.

For the durable reference (env var meanings, callback URL details), see [README.md](README.md).

## 1. Prerequisites

- GitHub access to `mrojas54/wids-nyc-reading-group-assistant`.
- A Vercel account (free tier is fine).
- The Supabase project URL, anon key, and service_role key (Supabase dashboard → Project Settings → API).

## 2. Create the Vercel project

1. Go to [vercel.com](https://vercel.com) → **Add New** → **Project**.
2. Import `mrojas54/wids-nyc-reading-group-assistant`. (Grant Vercel access to your GitHub account if it can't see the repo.)
3. **Set Root Directory to `web`**. This is critical — without it, Vercel can't find the Next.js app and the build fails with "no Next.js project found".
4. Framework preset auto-fills to **Next.js**. Leave the other defaults.
5. **Don't deploy yet.** Set env vars first (next section).

## 3. Set environment variables

In the project settings, add these for **Production** and **Preview**:

| Name                              | Value                                                                                  |
| --------------------------------- | -------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`        | From Supabase project settings → API.                                                  |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`   | From Supabase project settings → API.                                                  |
| `SUPABASE_SERVICE_ROLE_KEY`       | From Supabase project settings → API. **Mark as Sensitive.**                            |
| `NEXT_PUBLIC_SITE_URL`            | Leave empty for now — filled in after the first deploy (section 5). If you already know your Vercel project name, you can set this to `https://<project-name>.vercel.app` upfront and skip the redeploy. |
| `NEXT_PUBLIC_GITHUB_REPO`         | `mrojas54/wids-nyc-reading-group-assistant`                                            |

## 4. Enable Deployment Protection

Settings → **Deployment Protection** → **Vercel Authentication: ON** for Production. This requires a Vercel login to view the production URL, so members can't sign in until cutover. Removed at cutover ([member-app plan task 9.3](../docs/superpowers/plans/2026-05-03-wids-member-app.md#task-93-cycle-end-cutover)).

## 5. Trigger the first deploy and finalize `NEXT_PUBLIC_SITE_URL`

1. Push to `main` (or click **Deploy** in the Vercel dashboard).
2. Watch the build logs. Allow a few minutes for the first build. When it succeeds, note the assigned URL (e.g., `https://wids-nyc.vercel.app`).
3. Settings → **Environment Variables** → edit `NEXT_PUBLIC_SITE_URL`. Set it to the Vercel URL from step 2 (no trailing slash).
4. Trigger a redeploy: Deployments → click the latest deploy → **Redeploy**.

This env var is what magic-link emails use to build callback URLs. If it points to localhost, magic links from the live site redirect users to their own laptop.

## 6. Add the Supabase auth callback URL

Supabase dashboard → **Authentication** → **URL Configuration** → **Redirect URLs** → add `<vercel-url>/auth/callback` (use the URL from section 5).

**Without this, magic-link sign-in returns a 404** and the user is stuck on the callback page.

## 7. Smoke test

Visit `<vercel-url>/`. You should:

1. Hit the Vercel Authentication wall first (because of section 4).
2. After the auth, see the WiDS sign-in page.

## 8. Common issues

| Symptom                                       | Fix                                                              |
| --------------------------------------------- | ---------------------------------------------------------------- |
| Magic link click returns 404                  | Forgot section 6 (Supabase callback URL).                        |
| Build fails: "no Next.js project found"       | Root Directory not set to `web` (section 2 step 3).              |
| Magic link redirects to localhost             | `NEXT_PUBLIC_SITE_URL` still empty or set to localhost.          |
| Vercel Authentication wall not appearing      | Deployment Protection not enabled (section 4).                   |

## Pilot test log

Each entry records a runbook execution. Newest entries go at the top of the section (under this paragraph). Use the template below.

### Template

```
### YYYY-MM-DD — <commit-sha-7> — <all green | issues>
- Step 1 RLS: PASS
- Step 2 sign-in: PASS
- Step 3 availability: PASS
- Step 4 companion: PASS
- Step 6 RSVP: PASS
- Step 7 revert: PASS
- Notes: <any issues, gotchas, or "none">
```
