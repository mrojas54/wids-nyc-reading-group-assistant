# Switch Python type-checking from mypy to ty

**Date:** 2026-06-10
**Status:** Approved design, ready for implementation plan
**Scope:** Replace `mypy --strict` with Astral's `ty` as the sole Python type gate.

## Goal

Cut the Python CI type-check over from `mypy --strict` to `ty`, completing the
all-Astral toolchain (uv + ruff + ty). End state: mypy and `types-requests` are
removed entirely; `ty check` is the only type gate.

This is a **full cutover** delivered as a **single PR** (Approach A). No
transition period running both checkers.

## Decisions (from brainstorming)

- **Motivation:** speed + single-vendor toolchain; full cutover.
- **Strictness:** ship on **ty defaults** ("gradual" severities). Do **not**
  escalate rules to `error` in this PR. Tightening is deferred follow-up work.
- **Scope:** keep the exact scope mypy checked today — `scripts/` only, with the
  same three SPECTER2 exclusions. `tests/` remains un-type-checked (unchanged).
- **No `--strict` analog:** ty has no single switch reproducing mypy strict's
  `disallow_untyped_defs` mandate. Accepting a slightly looser gate is an
  explicit, accepted trade-off.

## Constraints

- The CI job is named **`python (pytest)`** and is a **required status check in
  main's branch protection** (see comment at `.github/workflows/ci.yml:66`). The
  job name must stay byte-identical. The cutover happens *inside* that job.
- CI installs with `uv sync --frozen`, which fails if `uv.lock` is out of sync
  with `pyproject.toml`. The PR must include a re-locked `uv.lock`.

## Changes

### 1. `pyproject.toml`

**Remove** from `[dependency-groups].dev`:
- `mypy>=1.10`
- `types-requests`

**Remove** entirely:
- the `[tool.mypy]` block
- the `[[tool.mypy.overrides]]` block (the `pyzotero` `ignore_missing_imports`)

**Add** to `[dependency-groups].dev`:
- `ty` (latest)

**Add** a `[tool.ty]` configuration that maps the *intent* of the old mypy
config onto ty:

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

[tool.ty.overrides.analysis]
# pyzotero ships no type information (was `ignore_missing_imports` under mypy).
allowed-unresolved-imports = ["pyzotero.**"]
```

Carry-overs from the mypy config: **same scope** (`scripts` only) and the **same
three SPECTER2 exclusions**.

### 2. `.github/workflows/ci.yml`

In the `python (pytest)` job, replace the type-check step:

```yaml
      # was:
      - name: Type-check (mypy --strict)
        run: uv run mypy

      # now:
      - name: Type-check (ty)
        run: uv run ty check
```

Scope and exclusions come from `[tool.ty.src]`, so the command takes no path
args (mirrors how bare `uv run mypy` read `[tool.mypy]`). Every other step in
the job — frozen `uv sync`, ruff, pytest — is unchanged.

### 3. Loose-end sweep

- **`.githooks/pre-push`** — if it invokes `mypy`, swap to `ty check` so the
  local gate matches CI.
- **`README.md` / `docs/**`** — update any prose naming mypy as the type checker.

## Verification (local, before pushing)

1. `uv sync` — regenerates `uv.lock` (ty in; mypy + types-requests out).
2. `uv run ty check` — must exit 0.
3. `uv run ruff check scripts tests` — still green.
4. pytest suite (the four files listed in CI) — still green.

### Handling ty diagnostics mypy didn't raise

ty's analysis differs from mypy's; it may flag things mypy was silent on even at
default severities. To keep CI green without escalating rules, in priority order:

1. **Genuine bug** → fix the code.
2. **True false-positive / known-safe** → targeted `# ty: ignore[rule-name]` on
   the line, with a brief reason.
3. **Whole rule too noisy right now** → demote it in `[tool.ty.rules]` with a
   comment marking it a candidate to re-tighten later.

No rule is escalated to `error` in this PR.

## Out of scope (YAGNI / deferred)

- Expanding type-checking to `tests/`.
- Escalating any ty rule severity to `error`.
- Type-checking the SPECTER2 `ml` scripts.
