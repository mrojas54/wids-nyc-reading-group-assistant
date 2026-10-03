#!/bin/bash
# Installs Python (uv) and web (npm) dependencies for Claude Code cloud sessions.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"

# Enforce the repo's push-to-main guard.
git config core.hooksPath .githooks

# Put the venv on PATH for the session.
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo "export PATH=\"$PWD/.venv/bin:\$PATH\"" >> "$CLAUDE_ENV_FILE"
fi

# Python: locked deps + dev group (pytest, ruff, ty). Python 3.13 is the CI
# version. --frozen matches ci.yml and never rewrites uv.lock.
install_python() {
  uv sync --frozen --python 3.13
}

# Web: npm ci installs exactly what package-lock.json pins and never rewrites
# it, but it deletes and reinstalls node_modules (~20s) every time. Skip it when
# node_modules was already built from this exact lockfile (resumed sessions,
# cached environment images).
install_web() {
  local stamp="web/node_modules/.lock-sha256"
  local want
  want=$(sha256sum web/package-lock.json web/package.json | sha256sum | cut -d' ' -f1)
  if [ -d web/node_modules ] && [ "$(cat "$stamp" 2>/dev/null)" = "$want" ]; then
    echo "web: node_modules up to date, skipping npm ci"
    return 0
  fi
  (cd web && npm ci --no-audit --no-fund --prefer-offline)
  echo "$want" > "$stamp"
}

# The two installs are independent, so run them side by side.
install_python & py_pid=$!
install_web & web_pid=$!

status=0
wait "$py_pid" || { echo "session-start: uv sync failed" >&2; status=1; }
wait "$web_pid" || { echo "session-start: npm ci failed" >&2; status=1; }
exit "$status"
