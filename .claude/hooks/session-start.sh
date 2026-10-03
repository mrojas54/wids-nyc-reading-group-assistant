#!/bin/bash
# Installs Python (uv) and web (npm) dependencies for Claude Code cloud sessions.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"

# Python: locked deps + dev group (pytest, ruff, ty). Python 3.13 is the CI version.
uv sync --python 3.13

# Web: npm ci installs exactly what package-lock.json pins and never rewrites it.
(cd web && npm ci --no-audit --no-fund)

# Enforce the repo's push-to-main guard.
git config core.hooksPath .githooks

# Put the venv on PATH for the session.
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo "export PATH=\"$PWD/.venv/bin:\$PATH\"" >> "$CLAUDE_ENV_FILE"
fi
