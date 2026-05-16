---
name: specter-status
description: Use when the user asks for SPECTER2 fallback status, "where are we on specter2", "is parity passing", "is the suggest build green", or wants a one-shot health check on the WASM SPECTER2 suggest pipeline. Reads the task tracker, runs the parity test suite, checks the latest Vercel deployment, and reports the next concrete action with file paths and line numbers.
---

# specter-status

One-shot status report for the SPECTER2 WASM fallback in the suggest pipeline. Run when you need to know: what's the next unchecked task, is parity still passing, and did the last deploy succeed.

## What this skill does

1. **Reads the task tracker** for SPECTER2 fallback progress
2. **Runs the parity test suite** (gated by `RUN_PARITY=1`, ~30–60s cold)
3. **Checks the latest Vercel build** for `wids-nyc-reading-group-assistant`
4. **Reports the next action** with concrete file paths and line numbers

## How to run it

Default (skips parity if last run was within 24h or if user wants a quick check):

```
/specter-status
```

Force full parity run:

```
/specter-status --parity
```

Skip parity entirely (fast triage mode):

```
/specter-status --no-parity
```

## Procedure

Execute these steps in order. **Do not** parallelize step 2 with step 3 — parity-test stdout interleaves badly with Vercel CLI output. Step 1 and step 3 *can* run in parallel since they touch different systems.

### Step 1 — Read the task tracker

Look for SPECTER2 fallback progress in this order (use the **first** one that exists):

1. `TASKS.md` at repo root — if present, grep for headings matching `SPECTER2|specter2|suggest fallback` and parse `- [ ]` / `- [x]` items underneath.
2. `docs/superpowers/plans/2026-05-09-vercel-suggest-wasm-specter2-implementation.md` — the canonical checkbox-tracked implementation plan. Count `- [ ]` vs `- [x]`; identify the first unchecked task by line number.
3. `memory/projects/specter2.md` — the status doc with the current pipeline state and "Status:" header.

Report which file you used. If none exist, **stop** and tell the user the tracker is missing.

Use `Read` for the file, then a `grep` (Bash) to count checkboxes:

```bash
grep -c '^- \[ \]' <path>   # remaining
grep -c '^- \[x\]' <path>   # done
```

Capture the **first unchecked line** including its line number — that's the "next action" payload for step 4.

### Step 2 — Run the parity test suite

The parity test compares WASM SPECTER2 INT8 vectors against Semantic Scholar canonical embeddings. Thresholds: median cos ≥ 0.99, min cos ≥ 0.93. Test file: `web/lib/suggest/__tests__/parity.test.ts`.

```bash
cd web && RUN_PARITY=1 npm test -- lib/suggest/__tests__/parity.test.ts
```

**Notes:**
- This loads the 113 MB ONNX model into a WASM runtime — cold runs take 30–60s. Warn the user before invoking if `--parity` was not explicitly passed.
- If `--no-parity` was passed, **skip this step** and note "parity skipped (per --no-parity)" in the report.
- Parse the vitest output for the parity test result. On failure, capture the median/min cos values from the error message — those are the actionable numbers.
- If the test errors out before running (e.g. missing `RUN_PARITY=1`, missing fixture, model fetch failed), report the error verbatim — don't try to "fix" it inside this skill.

### Step 3 — Check Vercel build status

Project: `wids-nyc-reading-group-assistant` (orgId `team_rMBPaPmkoN7gb5BOrFuAu4em`, projectId `prj_Otv3u7FNCsOwlAmSUVP86YYAne1x` — see `.vercel/project.json`).

The `vercel` CLI on this machine is aliased to `op plugin run -- vercel` (1Password-wrapped). Use it directly:

```bash
vercel ls wids-nyc-reading-group-assistant --json | head -50
```

Parse for the most recent production deployment and its `state` (`READY`, `ERROR`, `BUILDING`, `QUEUED`, `CANCELED`).

If the latest is `ERROR`:

```bash
vercel inspect <deployment-url> --logs | tail -80
```

…and surface the last error line (usually a build step failure or a missing env var).

If the latest is `BUILDING` or `QUEUED`, note the elapsed time and tell the user to re-run the skill later — don't block on it.

### Step 4 — Report the next action

Output a tight summary in this exact shape:

```
SPECTER2 fallback status — <ISO-date>

Tracker:  <relative path>:<line of first unchecked task>
          <N> done · <M> remaining
          Next: <verbatim text of first unchecked item>

Parity:   <PASS | FAIL | SKIPPED>
          <one line of detail — median/min cos on PASS, error excerpt on FAIL>

Vercel:   <READY | ERROR | BUILDING> · <deployment URL>
          <commit SHA or last error line>

→ Next action: <one-sentence recommendation tying tracker + parity + Vercel signals together>
```

**The "Next action" line is the whole point of the skill.** Concrete prioritization:

1. If Vercel is `ERROR` → next action = fix the build (surface the error file/line).
2. Else if parity is `FAIL` → next action = investigate parity drift (point at `web/lib/suggest/specter2-wasm.ts` and `scripts/specter2_parity_fixtures.json`).
3. Else if tracker has unchecked items → next action = the first unchecked task verbatim, with its file path.
4. Else → "all green; consider re-running parity with fresh fixtures or closing the plan doc."

## What this skill does NOT do

- It does **not** fix anything. It only reports. Fixes go through the normal RED → GREEN → DOCS workflow.
- It does **not** push to Vercel or trigger redeploys. Read-only.
- It does **not** edit the tracker file. If a task should be checked off, the user (or a follow-up skill) does that explicitly.
- It does **not** consult external Semantic Scholar API — the parity test uses local fixtures at `scripts/specter2_parity_fixtures.json`.

## Files this skill touches

Read-only:
- `TASKS.md` (if present), or `docs/superpowers/plans/2026-05-09-vercel-suggest-wasm-specter2-implementation.md`, or `memory/projects/specter2.md`
- `web/lib/suggest/__tests__/parity.test.ts`
- `scripts/specter2_parity_fixtures.json`
- `.vercel/project.json`

Executed:
- `npm test` (vitest) inside `web/`
- `vercel ls` / `vercel inspect`
