# Phase 9.1 (Deployment Docs) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the repo-side deliverables for Phase 9.1 of the member-app plan: a deployment reference section in `web/README.md`, a step-by-step `web/DEPLOYMENT.md` runbook, and a typo fix in the existing member-app plan.

**Architecture:** Three doc edits in one commit, no app code touched. The README is the durable reference; DEPLOYMENT.md is the one-time runbook; the plan typo fix prevents copy-paste of a wrong env var value during dashboard setup.

**Tech Stack:** Markdown only.

**Spec:** [docs/superpowers/specs/2026-05-04-phase-9-deployment-design.md](../specs/2026-05-04-phase-9-deployment-design.md)

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `web/DEPLOYMENT.md` | Create | First-time Vercel + Supabase setup runbook (8 sections, sequential clicks). |
| `web/README.md` | Modify (replace lines 11–13) | Durable deployment reference: env var table, Vercel project shape, Supabase callback note, link to DEPLOYMENT.md. |
| `docs/superpowers/plans/2026-05-03-wids-member-app.md` | Modify (line 2291) | Fix env var typo `wids_reading_group_assisstant` → correct repo name. |

All three changes ship in one commit per spec acceptance criterion #5.

---

## Task 1: Create `web/DEPLOYMENT.md` runbook

**Files:**
- Create: `web/DEPLOYMENT.md`

- [ ] **Step 1: Confirm the file does not already exist**

Run: `ls web/DEPLOYMENT.md 2>&1`
Expected: `ls: web/DEPLOYMENT.md: No such file or directory`

If the file already exists, stop and ask the user — the spec assumes a clean creation.

- [ ] **Step 2: Create `web/DEPLOYMENT.md` with the runbook content**

Write the file with exactly this content:

````markdown
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
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`        | From Supabase project settings → API.                                                  |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`   | From Supabase project settings → API.                                                  |
| `SUPABASE_SERVICE_ROLE_KEY`       | From Supabase project settings → API. **Mark as Sensitive.**                            |
| `NEXT_PUBLIC_SITE_URL`            | Leave empty for now — filled in after the first deploy (section 5).                    |
| `NEXT_PUBLIC_GITHUB_REPO`         | `mrojas54/wids-nyc-reading-group-assistant`                                            |

## 4. Enable Deployment Protection

Settings → **Deployment Protection** → **Vercel Authentication: ON** for Production. This password-protects the production URL so members can't sign in until cutover. Removed at cutover (member-app plan task 9.3).

## 5. Trigger the first deploy and finalize `NEXT_PUBLIC_SITE_URL`

1. Push your branch (or click **Deploy** in the Vercel dashboard).
2. Watch the build logs. First build takes ~2 minutes. When it succeeds, note the assigned URL (e.g., `https://wids-nyc.vercel.app`).
3. Settings → **Environment Variables** → edit `NEXT_PUBLIC_SITE_URL`. Set it to the Vercel URL from step 2 (no trailing slash).
4. Trigger a redeploy: Deployments → click the latest deploy → **Redeploy**.

This env var is what magic-link emails use to build callback URLs. If it points to localhost, magic links from the live site redirect users to their own laptop.

## 6. Add the Supabase auth callback URL

Supabase dashboard → **Authentication** → **URL Configuration** → **Redirect URLs** → add `<vercel-url>/auth/callback` (use the URL from section 5).

**Without this, magic-link sign-in returns a 404** and the user is stuck on the callback page.

## 7. Smoke test

Visit `<vercel-url>/`. You should:

1. Hit the Vercel password gate first (because of section 4).
2. After the password, see the WiDS sign-in page.

## 8. Common issues

| Symptom                                       | Fix                                                              |
|---|---|
| Magic link click returns 404                  | Forgot section 6 (Supabase callback URL).                        |
| Build fails: "no Next.js project found"       | Root Directory not set to `web` (section 2 step 3).              |
| Magic link redirects to localhost             | `NEXT_PUBLIC_SITE_URL` still empty or set to localhost.          |
| Vercel password gate not appearing            | Deployment Protection not enabled (section 4).                   |
````

- [ ] **Step 3: Verify the file has all 8 numbered sections in order**

Run: `grep -n '^## [0-9]' web/DEPLOYMENT.md`
Expected (8 lines, in order):
```
## 1. Prerequisites
## 2. Create the Vercel project
## 3. Set environment variables
## 4. Enable Deployment Protection
## 5. Trigger the first deploy and finalize `NEXT_PUBLIC_SITE_URL`
## 6. Add the Supabase auth callback URL
## 7. Smoke test
## 8. Common issues
```

If any section is missing or out of order, edit the file to fix.

- [ ] **Step 4: Verify the back-link to README is present**

Run: `grep -c '\[README.md\](README.md)' web/DEPLOYMENT.md`
Expected: `1`

If 0, the back-link is missing — add it to the file's intro paragraph.

---

## Task 2: Replace `web/README.md` Deploy stub with Deployment reference section

**Files:**
- Modify: `web/README.md` (lines 11–13 — the `## Deploy` stub)

- [ ] **Step 1: Read the current file to confirm the stub matches what the plan expects**

Run: `cat web/README.md`
Expected: 14 lines, ending with the 2-line stub:
```
## Deploy

Vercel project root: `web/`. Set env vars in Vercel project settings.
```

If the structure differs, stop and inspect — the file may have been edited since the spec was written.

- [ ] **Step 2: Replace the `## Deploy` section with the new `## Deployment` section**

Use the Edit tool. Replace this block:

```markdown
## Deploy

Vercel project root: `web/`. Set env vars in Vercel project settings.
```

With this block:

````markdown
## Deployment

The portal is hosted on Vercel with the project's Root Directory set to `web/`. Authentication is handled by Supabase via magic-link sign-in. For the step-by-step first-time setup, see [DEPLOYMENT.md](DEPLOYMENT.md).

### Environment variables

| Name                              | Source                          | Notes                                                                                                                                       |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`        | Supabase project settings → API | Public; baked into client bundle.                                                                                                           |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`   | Supabase project settings → API | Public; safe to expose to browser.                                                                                                          |
| `SUPABASE_SERVICE_ROLE_KEY`       | Supabase project settings → API | Secret; mark Sensitive in Vercel.                                                                                                           |
| `NEXT_PUBLIC_SITE_URL`            | Vercel deployment URL           | e.g. `https://wids-nyc.vercel.app`. Used to build magic-link callback URLs.                                                                 |
| `NEXT_PUBLIC_GITHUB_REPO`         | This repo                       | `mrojas54/wids-nyc-reading-group-assistant`. Used for the Colab "Open notebook" button on companion pages; if unset, the button is hidden.  |

### Vercel project shape

- **Root Directory:** `web` (without this, Vercel won't find the Next.js app).
- **Framework preset:** Next.js (auto-detected when Root Directory is correct).
- **Deployment Protection:** Vercel Authentication on for Production until cutover. Removed in member-app plan task 9.3 once members are ready to sign in.

### Supabase auth callback

`<vercel-url>/auth/callback` must be in the Supabase project's allowed redirect URLs (Supabase dashboard → Authentication → URL Configuration). Without this, magic-link sign-in returns a 404 and the user is stuck on the callback page.
````

- [ ] **Step 3: Verify the old stub is gone**

Run: `grep -c '^## Deploy$' web/README.md`
Expected: `0`

(If still 1, the heading is still `## Deploy` — should be `## Deployment`.)

- [ ] **Step 4: Verify the new section is present with the right anchor headers**

Run: `grep -n '^### ' web/README.md`
Expected (3 lines):
```
### Environment variables
### Vercel project shape
### Supabase auth callback
```

- [ ] **Step 5: Verify the link to DEPLOYMENT.md is present**

Run: `grep -c '\[DEPLOYMENT.md\](DEPLOYMENT.md)' web/README.md`
Expected: `1`

- [ ] **Step 6: Verify the env var table has all 5 rows**

Run: `grep -cE '^\| \`' web/README.md`
Expected: `5` (one row per env var; the header row starts with `| Name` and the separator row starts with `|---|`, so neither matches).

If the count is off, re-check the table — every env var row should start with `` | `NAME` ``.

---

## Task 3: Fix typo in the member-app plan

**Files:**
- Modify: `docs/superpowers/plans/2026-05-03-wids-member-app.md` (line 2291)

- [ ] **Step 1: Confirm the typo is at the expected location**

Run: `sed -n '2291p' docs/superpowers/plans/2026-05-03-wids-member-app.md`
Expected output (one line):
```
| `NEXT_PUBLIC_GITHUB_REPO` | `<owner>/wids_reading_group_assisstant` |
```

If the line content differs (the plan may have been edited), search for the typo:
```bash
grep -n 'wids_reading_group_assisstant' docs/superpowers/plans/2026-05-03-wids-member-app.md
```
and use whatever line it reports.

- [ ] **Step 2: Replace the typo'd value with the correct repo name**

Use the Edit tool to change:
```
| `NEXT_PUBLIC_GITHUB_REPO` | `<owner>/wids_reading_group_assisstant` |
```
to:
```
| `NEXT_PUBLIC_GITHUB_REPO` | `mrojas54/wids-nyc-reading-group-assistant` |
```

- [ ] **Step 3: Verify the typo is gone from the entire repo**

Run: `grep -rn 'wids_reading_group_assisstant' .`
Expected: no matches (exit code 1).

If any match remains (e.g., another doc references it), fix that occurrence too.

---

## Task 4: Verify all three changes together and commit

**Files:** none modified — verification + single commit covering Tasks 1–3.

- [ ] **Step 1: Confirm exactly the three expected files are dirty**

Run: `git status --short`
Expected output:
```
 M docs/superpowers/plans/2026-05-03-wids-member-app.md
 M web/README.md
?? web/DEPLOYMENT.md
```

If anything else appears (extra modified files, unexpected untracked files), stop and investigate before committing.

- [ ] **Step 2: Inspect the diff one last time**

Run: `git diff web/README.md docs/superpowers/plans/2026-05-03-wids-member-app.md && echo '--- new file ---' && cat web/DEPLOYMENT.md`

Expected: README diff shows the stub removed and the new Deployment section added; the plan diff shows just the typo fix on one line; DEPLOYMENT.md prints the full runbook.

- [ ] **Step 3: Stage and commit all three changes in one commit**

Run:
```bash
git add web/DEPLOYMENT.md web/README.md docs/superpowers/plans/2026-05-03-wids-member-app.md
git commit -m "$(cat <<'EOF'
docs: phase 9.1 — deployment reference + first-time runbook

- web/README.md: add Deployment section (env vars, project shape, callback URL)
- web/DEPLOYMENT.md: new 8-section runbook for first-time Vercel + Supabase setup
- member-app plan: fix env var value typo (wids_reading_group_assisstant)

Repo-side deliverables for member-app plan phase 9.1. Manual Vercel and
Supabase dashboard work follows DEPLOYMENT.md.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Verify the commit landed and the working tree is clean**

Run: `git status` and `git log --oneline -1`

Expected:
- `git status` → "nothing to commit, working tree clean"
- `git log --oneline -1` → starts with "docs: phase 9.1 — deployment reference + first-time runbook"

- [ ] **Step 5: Verify the new files render correctly on GitHub (manual)**

After pushing the branch, open the rendered files on GitHub:
- `web/README.md` — table headers, 3 sub-section anchors, link to `DEPLOYMENT.md` resolves.
- `web/DEPLOYMENT.md` — 8 numbered sections, 2 tables (env vars + common issues), back-link to `README.md` resolves.

If anything renders wrong (broken table, broken link), fix and amend.

---

## Acceptance check (against spec §Acceptance)

After Task 4 commits successfully:

1. ✅ `web/README.md` has the new "Deployment" section. (Verified in Task 2 steps 3–6.)
2. ✅ `web/DEPLOYMENT.md` exists with all 8 sections, in order. (Verified in Task 1 step 3.)
3. ✅ `web/README.md` has a working link to `DEPLOYMENT.md`. (Verified in Task 2 step 5; final render check in Task 4 step 5.)
4. ✅ Plan typo at line 2291 is fixed. (Verified in Task 3 step 3.)
5. ✅ All four changes land in one commit. (Verified in Task 4 step 4.)

No app code, no migrations, no scheduled-task changes — matches spec scope.
