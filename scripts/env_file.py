"""Tiny ``.env`` reader shared by the operator scripts that fall back to
``web/.env.local`` when a variable is not exported in the shell.

``KEY=VALUE`` per line, ``#`` comments, optional single or double quotes
around the value. Missing file → empty mapping. Deliberately not a full
dotenv implementation: no interpolation, no ``export`` prefix, no multi-line
values.
"""
from __future__ import annotations

import re
from pathlib import Path

ENV_LINE_RE = re.compile(r"^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$")


def parse_env_file(path: Path) -> dict[str, str]:
    """Parse ``path`` into ``{KEY: VALUE}``; an absent file yields ``{}``."""
    out: dict[str, str] = {}
    if not path.exists():
        return out
    for line in path.read_text().splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        m = ENV_LINE_RE.match(line)
        if not m:
            continue
        key, val = m.group(1), m.group(2)
        quoted = (val.startswith('"') and val.endswith('"')) or (
            val.startswith("'") and val.endswith("'")
        )
        if quoted and len(val) >= 2:
            val = val[1:-1]
        out[key] = val
    return out
