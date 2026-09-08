#!/usr/bin/env bash
# Idempotent Cloud Agent bootstrap for the WiDS NYC Reading Group Assistant.
#
# Prepares the three toolchains this repo's CI exercises:
#   - Python 3.13 via uv         (scripts/ + tests/: ruff, ty, pytest)
#   - Node 22.22.3 via nvm       (web/: Next.js member portal)
#   - Deno, pinned by .dvmrc     (supabase/functions/: edge-function check + lint)
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
# Version comes from .dvmrc, the single source this script and CI share:
# ci.yml's edge-functions job passes the same file to setup-deno via
# `deno-version-file`. Previously this installed "latest stable" while CI
# resolved `v2.x`; both landed on 2.x, so the divergence was dormant — but it
# would have activated silently on the Deno 3 release, type-checking edge
# functions here on a major CI had never run.
#
# Pinning exactly (rather than a `2.x` range) mirrors how web/.nvmrc pins Node
# to 22.22.3. The install script takes a concrete version tag, not a range, so
# an exact pin is also the only form both consumers can share verbatim.
DENO_VERSION="$(cat .dvmrc)"
if [ "$(deno --version 2>/dev/null | head -1 | cut -d' ' -f2)" != "$DENO_VERSION" ]; then
  echo "[install] installing deno ${DENO_VERSION}"
  curl -fsSL https://deno.land/install.sh | sh -s "v${DENO_VERSION}"
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
# Rewrite the marked block on every run so content changes take effect
# (rather than skipping when an older block is already present).
BASHRC="$HOME/.bashrc"
BEGIN="# >>> wids cloud-agent toolchain >>>"
END="# <<< wids cloud-agent toolchain <<<"
echo "[install] refreshing toolchain PATH block in ~/.bashrc"
touch "$BASHRC"
sed -i "/$BEGIN/,/$END/d" "$BASHRC"
cat >> "$BASHRC" <<'RC'
# >>> wids cloud-agent toolchain >>>
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1
nvm use default >/dev/null 2>&1 || true
# Prepend the resolved nvm node bin so the pinned version wins over any
# node earlier on PATH (the exec-daemon ships its own node).
__wids_node_bin="$(dirname "$(nvm which current 2>/dev/null)" 2>/dev/null || true)"
export PATH="${__wids_node_bin:+$__wids_node_bin:}$HOME/.local/bin:$HOME/.deno/bin:$PATH"
unset __wids_node_bin
# <<< wids cloud-agent toolchain <<<
RC

echo "[install] done"
