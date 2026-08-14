#!/usr/bin/env bash
# Idempotent Cloud Agent bootstrap for the WiDS NYC Reading Group Assistant.
#
# Prepares the three toolchains this repo's CI exercises:
#   - Python 3.13 via uv         (scripts/ + tests/: ruff, ty, pytest)
#   - Node 22.22.3 via nvm       (web/: Next.js member portal)
#   - Deno v2.x                  (supabase/functions/: edge-function check + lint)
#
# Safe to run repeatedly: every tool install is guarded, and dependency
# installs come from committed lockfiles (uv.lock, web/package-lock.json).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export PATH="$HOME/.local/bin:$HOME/.deno/bin:$PATH"

# --- uv (Python package/project manager) ---
if ! command -v uv >/dev/null 2>&1; then
  echo "[install] installing uv"
  curl -LsSf https://astral.sh/uv/install.sh | sh
fi
export PATH="$HOME/.local/bin:$PATH"

# --- Deno (edge-function type-check + lint) ---
if ! command -v deno >/dev/null 2>&1; then
  echo "[install] installing deno v2.x"
  curl -fsSL https://deno.land/install.sh | sh -s v2.x
fi
export PATH="$HOME/.deno/bin:$PATH"

# --- Node via nvm, pinned by web/.nvmrc ---
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
NODE_VERSION="$(cat web/.nvmrc)"
echo "[install] ensuring node ${NODE_VERSION} via nvm"
nvm install "$NODE_VERSION" >/dev/null
nvm alias default "$NODE_VERSION" >/dev/null
nvm use "$NODE_VERSION" >/dev/null

# --- Python dependencies (uv fetches managed CPython 3.13 if absent) ---
echo "[install] uv sync --frozen --python 3.13"
uv sync --frozen --python 3.13

# --- Web dependencies (reproducible install from lockfile) ---
echo "[install] npm ci (web)"
( cd web && npm ci )

# --- Persist toolchain PATH for the agent's interactive shells ---
BASHRC="$HOME/.bashrc"
MARKER="# >>> wids cloud-agent toolchain >>>"
if ! grep -qF "$MARKER" "$BASHRC" 2>/dev/null; then
  echo "[install] adding toolchain PATH block to ~/.bashrc"
  cat >> "$BASHRC" <<'RC'
# >>> wids cloud-agent toolchain >>>
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1
nvm use default >/dev/null 2>&1 || true
export PATH="$HOME/.local/bin:$HOME/.deno/bin:$PATH"
# <<< wids cloud-agent toolchain <<<
RC
fi

echo "[install] done"
