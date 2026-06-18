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
from typing import TypedDict

REPO_ROOT = Path(__file__).resolve().parent.parent
BUNDLE_PATH = REPO_ROOT / "web" / "lib" / "quotes.generated.json"
EXPECTED_BUNDLE_VERSION = 1

_FNV_OFFSET = 0x811C9DC5
_FNV_PRIME = 0x01000193
_MASK32 = 0xFFFFFFFF


class _AuthorRequired(TypedDict):
    id: str
    name: str
    role: str


class AuthorRecord(_AuthorRequired, total=False):
    birthdate: str
    deathdate: str
    fields: list[str]
    notable_contributions: str
    wikipediaUrl: str


class _QuoteRequired(TypedDict):
    id: str
    text: str
    verified: bool


class QuoteRecord(_QuoteRequired, total=False):
    year: int | None
    source: str
    sourceUrl: str


class BundleEntry(TypedDict):
    author: AuthorRecord
    quotes: list[QuoteRecord]


class Bundle(TypedDict):
    version: int
    authors: list[BundleEntry]


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
    """A chosen pair — author is entry['author'], quote is one element of entry['quotes']."""

    author: AuthorRecord
    quote: QuoteRecord


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


def load_bundle(path: Path = BUNDLE_PATH) -> Bundle:
    """Read the committed generated bundle, with actionable errors when it is
    missing, corrupt, or an unexpected version."""
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        raise RuntimeError(
            f"Quote bundle not found at {path}. "
            "Run `uv run python scripts/build_quotes.py` to generate it."
        ) from None
    try:
        data: Bundle = json.loads(text)
    except json.JSONDecodeError as exc:
        raise RuntimeError(
            f"Quote bundle at {path} is not valid JSON ({exc}). "
            "Regenerate it with `uv run python scripts/build_quotes.py`."
        ) from exc
    if data.get("version") != EXPECTED_BUNDLE_VERSION:
        raise RuntimeError(
            f"Quote bundle at {path} has version {data.get('version')!r}; "
            f"expected {EXPECTED_BUNDLE_VERSION}. "
            "Regenerate it with `uv run python scripts/build_quotes.py`."
        )
    return data


def eligible_pairs(bundle: Bundle) -> list[Selection]:
    """Flatten verified quotes into (author, quote) pairs, sorted by quote id."""
    pairs = [
        Selection(author=entry["author"], quote=quote)
        for entry in bundle["authors"]
        for quote in entry["quotes"]
        if quote["verified"]
    ]
    pairs.sort(key=lambda s: s.quote["id"])
    return pairs


def select_quote(bundle: Bundle, date_key: int, salt: str = "") -> Selection:
    """Pick a quote for `date_key`, scattered deterministically by FNV-1a.
    Returns FALLBACK when no verified quotes exist. A pure modulo with no
    cross-day state — keeps the Python/TS pair trivially identical."""
    pairs = eligible_pairs(bundle)
    if not pairs:
        return FALLBACK
    return pairs[fnv1a(f"{date_key}{salt}") % len(pairs)]


def quote_tokens(sel: Selection) -> dict[str, str]:
    """Mustache tokens for the email templates."""
    return {
        "quote.text": sel.quote["text"],
        "quote.by": sel.author["name"],
        "quote.role": sel.author["role"],
    }
