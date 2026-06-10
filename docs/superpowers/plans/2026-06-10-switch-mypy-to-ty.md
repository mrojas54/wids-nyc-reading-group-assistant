# Switch Python type-checking from mypy to ty — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `mypy --strict` with Astral's `ty` as the sole Python type-check gate in CI and local tooling.

**Architecture:** Single-PR full cutover (Approach A from the spec). Swap dev dependencies (out: `mypy`, `types-requests`; in: `ty`), replace the `[tool.mypy]` config with a `[tool.ty]` block of equivalent scope, flip the CI type-check step, and sweep prose/config references. Ship on ty's default rule severities — no rule escalation in this PR.

**Tech Stack:** Python 3.11, uv (env + locking), ty (type checker), ruff (lint), pytest, GitHub Actions.

**Spec:** [docs/superpowers/specs/2026-06-10-switch-mypy-to-ty-design.md](../specs/2026-06-10-switch-mypy-to-ty-design.md)

**Working directory:** all commands run from the repo/worktree root (where `pyproject.toml` and `uv.lock` live — this repo has no `python/` subdirectory).

**Hard constraints:**
- The CI job name `python (pytest)` is a required status check in main's branch protection — it must stay byte-identical. Only the *step* inside it changes.
- CI installs with `uv sync --frozen`; the PR must include a re-locked `uv.lock` or CI fails the frozen check. `uv add`/`uv remove` re-lock automatically.

---

## File Structure

| File | Change | Responsibility after change |
|------|--------|------------------------------|
| `pyproject.toml` | Modify | dev group lists `ty` (not mypy/types-requests); `[tool.ty]` replaces `[tool.mypy]` |
| `uv.lock` | Regenerated | pinned set with ty in, mypy + types-requests out |
| `.github/workflows/ci.yml` | Modify | `python (pytest)` job runs `uv run ty check` for type-checking |
| `scripts/zotero_push.py` | Maybe modify | only if ty needs a line-level import suppression (contingency in Task 3) |
| `README.md` | Modify | "Python tooling" + repo-layout prose name ty, not mypy |
| `.gitignore` | Modify | ignores ty's cache dir instead of `.mypy_cache/` |

`HANDOFF.md:12` mentions mypy in a *historical* checklist entry — leave it untouched (it's a record of past work, not current guidance).

---

## Task 1: Swap dev dependencies (mypy → ty) and re-lock

**Files:**
- Modify: `pyproject.toml` (`[dependency-groups].dev`, lines ~36-46)
- Regenerated: `uv.lock`

Use `uv` so `pyproject.toml` and `uv.lock` update atomically (per project convention — never hand-edit the lock).

- [ ] **Step 1: Remove mypy and its stubs**

Run:
```sh
uv remove --dev mypy types-requests
```
Expected: command succeeds; `pyproject.toml` dev group no longer lists `mypy` or `types-requests`; `uv.lock` is rewritten.

- [ ] **Step 2: Add ty**

Run:
```sh
uv add --dev ty
```
Expected: `ty` (latest release) is added to `[dependency-groups].dev` with a `>=` specifier; `uv.lock` updated.

- [ ] **Step 3: Verify the dev group reads as intended**

Read `pyproject.toml` `[dependency-groups].dev`. Expected contents (order may vary):
```toml
dev = [
    "pytest>=8.0",
    "pytest-asyncio>=0.23",
    "respx>=0.21",
    "responses>=0.25",
    "ruff>=0.6",
    "ty>=<resolved-version>",
]
```
There must be **no** `mypy` and **no** `types-requests` entries.

- [ ] **Step 4: Confirm the toolchain installs and ty runs**

Run:
```sh
uv sync --frozen
uv run ty --version
```
Expected: `uv sync --frozen` succeeds (lock is in sync — proves the re-lock worked), and `ty --version` prints a version string.

- [ ] **Step 5: Commit**

```sh
git add pyproject.toml uv.lock
git commit -m "build: swap dev type-checker dependency mypy → ty"
```

---

## Task 2: Replace the mypy config block with ty config

**Files:**
- Modify: `pyproject.toml` (remove `[tool.mypy]` lines ~63-79; add `[tool.ty]` block)

The current `[tool.mypy]` block (strict, `files = ["scripts"]`, three SPECTER2 excludes) and the `[[tool.mypy.overrides]]` block (pyzotero `ignore_missing_imports`) are obsolete now that mypy is gone. Replace them with an equivalent-scope `[tool.ty]` block.

- [ ] **Step 1: Delete the mypy config blocks**

Remove these two blocks from `pyproject.toml` in full:
```toml
[tool.mypy]
python_version = "3.11"
strict = true
files = ["scripts"]
exclude = '''(?x)(
    scripts/export_specter2_onnx\.py$
  | scripts/embed_specter2_fp32\.py$
  | scripts/verify_specter2_local_vs_s2\.py$
)'''

[[tool.mypy.overrides]]
module = ["pyzotero.*"]
ignore_missing_imports = true
```

- [ ] **Step 2: Add the ty config block**

In the same location, add:
```toml
[tool.ty.environment]
python-version = "3.11"

[tool.ty.src]
# Match the old mypy `files = ["scripts"]` scope. The three heavy SPECTER2
# scripts stay excluded — their torch/transformers/onnx deps live in the
# optional `ml` group and are never installed in CI, so checking them only
# surfaces unresolved-import cascades.
include = ["scripts"]
exclude = [
    "scripts/export_specter2_onnx.py",
    "scripts/embed_specter2_fp32.py",
    "scripts/verify_specter2_local_vs_s2.py",
]

[tool.ty.analysis]
# pyzotero ships no type information (was `ignore_missing_imports` under mypy).
# Global `[tool.ty.analysis]` table — the `[[tool.ty.overrides]]` array form is
# only needed for path-scoped rules, which we don't need here.
allowed-unresolved-imports = ["pyzotero.**"]
```

- [ ] **Step 3: Verify ty parses the config (no config errors)**

Run:
```sh
uv run ty check
```
Expected at this step: ty runs and reports diagnostics or success — but it must **not** emit a configuration-parse error (e.g. "unknown option", "invalid key"). If it does, the table name or key is wrong for the installed ty version; fix it against `uv run ty --help` / the ty docs before proceeding. (`[tool.ty.environment]`, `[tool.ty.src]`, `[tool.ty.analysis]` are correct as of ty's current config reference.)

- [ ] **Step 4: Commit**

```sh
git add pyproject.toml
git commit -m "build: add [tool.ty] config mirroring the old mypy scope"
```

---

## Task 3: Make `ty check` green

**Files:**
- Possibly modify: `scripts/*.py` (only files that produce ty diagnostics)

ty's analysis differs from mypy's and may flag things mypy was silent on, even at default severities. Drive `ty check` to a clean exit without escalating any rule (per spec "defaults now, keep CI green").

- [ ] **Step 1: Run the type checker and capture all diagnostics**

Run:
```sh
uv run ty check
```
Record every diagnostic (file, line, rule name).

- [ ] **Step 2: Triage and resolve each diagnostic, in priority order**

For each reported diagnostic, apply exactly one remedy:

1. **Genuine type bug in the code** → fix the code so the types are correct.
2. **True false-positive / known-safe** → add a line-level suppression with a one-line reason, using the rule name ty printed:
   ```python
   result = thing()  # ty: ignore[<rule-name>]  # <why this is safe>
   ```
3. **A whole rule is too noisy to satisfy right now** → demote it globally with a comment marking it for later tightening:
   ```toml
   [tool.ty.rules]
   # Demoted for the mypy→ty cutover; re-tighten in the deferred ratchet pass.
   <rule-name> = "ignore"
   ```

Do **not** escalate any rule to `error` in this PR.

Note on the pyzotero import: it is already covered by `allowed-unresolved-imports` (Task 2). If — and only if — ty still reports `unresolved-import` for `pyzotero` here (config drift in a pre-1.0 release), add a line-level fallback on the import in `scripts/zotero_push.py`:
```python
from pyzotero import zotero  # ty: ignore[unresolved-import]  # no type stubs shipped
```

- [ ] **Step 3: Confirm a clean exit**

Run:
```sh
uv run ty check
```
Expected: exits 0, "All checks passed" (or ty's equivalent success output), no errors.

- [ ] **Step 4: Confirm nothing else regressed**

Run:
```sh
uv run ruff check scripts tests
```
Expected: passes. (If a `# ty: ignore` comment tripped a ruff rule, fix the comment formatting.)

- [ ] **Step 5: Commit (only if Steps 2 changed files)**

```sh
git add -A
git commit -m "fix: resolve ty diagnostics for the mypy→ty cutover"
```
If Task 3 changed no files (ty was clean on first run), skip this commit and note it.

---

## Task 4: Flip the CI type-check step to ty

**Files:**
- Modify: `.github/workflows/ci.yml` (the `python (pytest)` job, lines ~65-103)

- [ ] **Step 1: Replace the type-check step**

In `.github/workflows/ci.yml`, change:
```yaml
      - name: Type-check (mypy --strict)
        run: uv run mypy
```
to:
```yaml
      - name: Type-check (ty)
        run: uv run ty check
```
Leave every other step in the job unchanged (`uv sync --frozen --python 3.11`, the ruff step, the pytest step). Do **not** rename the job — `name: python (pytest)` stays exactly as-is.

- [ ] **Step 2: Update the stale job comment**

In the same job, the comment at line ~66-67 reads:
```yaml
    # in main's branch protection. The job now also runs ruff + mypy (below).
```
Change `ruff + mypy` to `ruff + ty`:
```yaml
    # in main's branch protection. The job now also runs ruff + ty (below).
```

- [ ] **Step 3: Sanity-check the YAML**

Read the edited `python` job and confirm: job `name:` is still `python (pytest)`; the type-check step now runs `uv run ty check`; no other step changed.

- [ ] **Step 4: Commit**

```sh
git add .github/workflows/ci.yml
git commit -m "ci: run ty instead of mypy in the python job"
```

---

## Task 5: Sweep prose and ignore-file references

**Files:**
- Modify: `README.md` (lines ~161 and ~181)
- Modify: `.gitignore` (line ~23)

- [ ] **Step 1: Update the README command block**

In `README.md`, change line ~162:
```
uv run mypy              # type-check (strict) the scripts/ package
```
to:
```
uv run ty check          # type-check the scripts/ package
```
(Drop "strict" — ty runs on default severities, not a strict mode.)

- [ ] **Step 2: Update the README repo-layout line**

Change line ~181:
```
pyproject.toml       Python deps + ruff/mypy config (single source of truth)
```
to:
```
pyproject.toml       Python deps + ruff/ty config (single source of truth)
```

- [ ] **Step 3: Update .gitignore cache entry**

In `.gitignore`, replace line ~23:
```
.mypy_cache/
```
with:
```
.ty_cache/
```

- [ ] **Step 4: Confirm no current-guidance mypy references remain**

Search the repo for `mypy` (case-insensitive). Expected remaining hits only in:
- `uv.lock` — transitive? No: after Task 1 the lock should not contain mypy. If `mypy`/`mypy-extensions`/`types-requests` still appear in `uv.lock`, the re-lock in Task 1 didn't take — re-run `uv lock` and amend.
- `HANDOFF.md:12` — historical record, intentionally left.
- `docs/superpowers/specs/2026-06-10-switch-mypy-to-ty-design.md` and this plan — they document the migration; leave them.

No hits should remain in `README.md`, `pyproject.toml`, `.github/workflows/ci.yml`, or `.gitignore`.

- [ ] **Step 5: Commit**

```sh
git add README.md .gitignore
git commit -m "docs: point Python tooling docs and gitignore at ty"
```

---

## Task 6: Full local verification (the CI dress rehearsal)

Run exactly what CI will run, in order, and confirm green before opening the PR.

- [ ] **Step 1: Frozen install (mirrors CI)**

Run:
```sh
uv sync --frozen --python 3.11
```
Expected: succeeds — proves `uv.lock` is in sync (the frozen check CI enforces).

- [ ] **Step 2: Lint**

Run:
```sh
uv run ruff check scripts tests
```
Expected: passes.

- [ ] **Step 3: Type-check**

Run:
```sh
uv run ty check
```
Expected: exits 0, all checks pass.

- [ ] **Step 4: Tests (the four files CI runs)**

Run:
```sh
uv run pytest -c tests/pytest.ini -v \
  tests/find_paper_suggest_test.py \
  tests/zotero_push_test.py \
  tests/build_arxiv_taxonomy_test.py \
  tests/render_email_previews_test.py
```
Expected: all pass. Report the count (e.g. "N passed").

- [ ] **Step 5: Confirm clean tree**

Run:
```sh
git status
```
Expected: clean (all changes committed across Tasks 1-5).

---

## Task 7: Open the PR

- [ ] **Step 1: Push the branch**

Run:
```sh
git push -u origin HEAD
```
(Do not push to `main` — the pre-push hook blocks it; PR is required.)

- [ ] **Step 2: Open the PR**

Run:
```sh
gh pr create --title "Switch Python type-checking from mypy to ty" \
  --body "Full cutover of the Python type gate from \`mypy --strict\` to Astral's \`ty\`, per docs/superpowers/specs/2026-06-10-switch-mypy-to-ty-design.md.

- Drops \`mypy\` + \`types-requests\` from the dev group; adds \`ty\`.
- \`[tool.ty]\` mirrors the old mypy scope: \`scripts/\` only, same three SPECTER2 exclusions, pyzotero unresolved-import allowlisted.
- CI \`python (pytest)\` job now runs \`uv run ty check\` (job name unchanged for branch protection).
- Ships on ty default severities; rule tightening is deferred follow-up.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

- [ ] **Step 3: Verify CI status on the PR**

Run:
```sh
gh pr view --json number,state,statusCheckRollup
```
Expected: the `python (pytest)` check is queued/running/passing. Confirm all checks go green before requesting merge.

---

## Done criteria

- `mypy` and `types-requests` appear nowhere in `pyproject.toml` or `uv.lock`.
- `uv run ty check` exits 0 locally and in CI.
- The CI `python (pytest)` job runs `uv run ty check`; ruff and pytest steps unchanged; job name unchanged.
- README and `.gitignore` name ty, not mypy.
- No ty rule was escalated to `error` (deferred to a follow-up ratchet pass).
