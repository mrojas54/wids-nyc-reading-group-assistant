"""Rotating women-in-STEM quote selection (shared spec, Python side).

Loads the generated bundle (web/lib/quotes.generated.json) and selects a quote
deterministically from an integer date key. Mirrors web/lib/quotes.ts — keep the
two in sync; the FNV-1a test vectors pin the algorithm in both languages.

Run tests via:
    uv run pytest -c tests/pytest.ini tests/quotes_select_test.py -v
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
BUNDLE_PATH = REPO_ROOT / "web" / "lib" / "quotes.generated.json"

_FNV_OFFSET = 0x811C9DC5
_FNV_PRIME = 0x01000193
_MASK32 = 0xFFFFFFFF


def fnv1a(s: str) -> int:
    """32-bit FNV-1a hash. Date keys + salt are ASCII, so this agrees
    byte-for-byte with the charCodeAt-based TypeScript implementation."""
    h = _FNV_OFFSET
    for byte in s.encode("utf-8"):
        h ^= byte
        h = (h * _FNV_PRIME) & _MASK32
    return h


@dataclass(frozen=True)
class Selection:
    """A chosen (author, quote) pair — both are the raw bundle dicts."""

    author: dict[str, Any]
    quote: dict[str, Any]


FALLBACK = Selection(
    author={
        "id": "grace-hopper",
        "name": "Grace Hopper",
        "role": "Computer scientist · US Navy rear admiral",
    },
    quote={
        "id": "hopper-always-done",
        "text": "The most dangerous phrase in the language is, "
        "'we've always done it this way.'",
        "verified": True,
    },
)


def load_bundle(path: Path = BUNDLE_PATH) -> dict[str, Any]:
    """Read the committed generated bundle."""
    return json.loads(path.read_text(encoding="utf-8"))


def eligible_pairs(bundle: dict[str, Any]) -> list[Selection]:
    """Flatten verified quotes into (author, quote) pairs, sorted by quote id."""
    pairs = [
        Selection(author=entry["author"], quote=quote)
        for entry in bundle.get("authors", [])
        for quote in entry.get("quotes", [])
        if quote.get("verified")
    ]
    pairs.sort(key=lambda s: s.quote["id"])
    return pairs


def _pick_idx(date_key: int, n: int, salt: str, prev_idx: int | None) -> int:
    """Return the final index for *date_key*, bumping by 1 if it would repeat
    *prev_idx*. Does not recurse — caller supplies the already-resolved
    previous-day index."""
    idx = fnv1a(f"{date_key}{salt}") % n
    if n > 1 and prev_idx is not None and idx == prev_idx:
        idx = (idx + 1) % n
    return idx


def select_quote(bundle: dict[str, Any], date_key: int, salt: str = "") -> Selection:
    """Pick a quote for `date_key`, scattered by FNV-1a, with no back-to-back
    repeat. Returns FALLBACK when no verified quotes exist."""
    pairs = eligible_pairs(bundle)
    if not pairs:
        return FALLBACK
    n = len(pairs)
    # Resolve yesterday's *final* index (one extra look-back is enough because
    # _pick_idx never bumps more than once — a bump cannot itself repeat the
    # day before that day's bump, given that _pick_idx is self-consistent).
    prev_prev_idx = fnv1a(f"{date_key - 2}{salt}") % n
    prev_idx = _pick_idx(date_key - 1, n, salt, prev_prev_idx)
    return pairs[_pick_idx(date_key, n, salt, prev_idx)]


def quote_tokens(sel: Selection) -> dict[str, str]:
    """Mustache tokens for the email templates."""
    return {
        "quote.text": sel.quote["text"],
        "quote.by": sel.author["name"],
        "quote.role": sel.author["role"],
    }
