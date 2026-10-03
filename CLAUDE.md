# WiDS NYC Reading Group Assistant

Operator tooling for a reading group: Claude Code slash commands over a Supabase
project, Python helper scripts, Deno edge functions, and a Next.js member portal.
See [README.md](README.md) for the operator handbook and [HANDOFF.md](HANDOFF.md)
for the live investigation state.

## Layout

| Path | What lives there |
|---|---|
| `web/` | Next.js member portal (Node, npm) |
| `scripts/`, `tests/` | Python helpers and pytest/SQL tests (uv) |
| `supabase/functions/` | Deno edge functions |
| `migrations/` | SQL migrations, applied in numeric order |
| `.claude/commands/` | Operator slash commands |

## Checks to run before pushing

CI (`.github/workflows/ci.yml`) runs three jobs. Run the matching ones locally.
Cloud sessions install dependencies automatically via `.claude/hooks/session-start.sh`.

**Web** (from `web/`):

```sh
npm run lint
npm run typecheck
npm run test
node --experimental-strip-types --test scripts/check-audit.test.mts   # audit policy tests
node --experimental-strip-types scripts/check-audit.mts               # npm audit gate
```

**Python** (from the repo root):

```sh
uv sync --frozen --python 3.13
uv run ruff check scripts tests
uv run ty check
uv run pytest -c tests/pytest.ini -v tests/
```

**Edge functions** (from `supabase/functions/`, Deno version pinned in `.dvmrc`):

```sh
deno check '**/*.ts'
deno lint
```

## Rules that are easy to get wrong

- **Destructive SQL needs explicit confirmation.** `DELETE`, `TRUNCATE`, and
  `DROP TABLE/COLUMN` on `members`, `meetings`, `papers`, `availability`, or
  `command_log` are blocked by a hook. Paste the exact statement, run a `SELECT`
  preview, and wait for a direct yes before re-issuing. See README "Destructive SQL guard".
- **Never push to `main`.** A git hook blocks it; open a PR from a branch.
- **Keep lockfiles in sync.** Use `npm ci` (never `npm install`) in `web/`. After
  changing Python deps, run `uv lock`; CI uses `uv sync --frozen` and fails on drift.
- **Python 3.13 everywhere except SPECTER2.** The three SPECTER2 scripts and
  `export-specter2.yml` stay on `--python 3.11` with `--no-project`, because 3.13
  resolves a wrong `optimum` package. Do not "fix" this. See the comment at the top
  of `pyproject.toml`.
- **New tests are collected automatically.** Name Python tests `tests/*_test.py`;
  do not maintain a file list.

## Permissions

`.claude/settings.json` allows routine dev tooling (`uv`, `npm run`, `node`, `deno`,
read-only shell utilities, non-force `git`) and denies force pushes and
`git reset --hard`. Anything else, including `curl`, `rm`, `vercel`, and `supabase`
CLIs, prompts for approval. To permit a command for yourself only, add it to
`.claude/settings.local.json`.
