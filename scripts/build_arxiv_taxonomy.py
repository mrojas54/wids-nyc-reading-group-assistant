"""Scrape arxiv.org/category_taxonomy into a canonical JSON + generated TS module.

Run via:
    uv run --with httpx --with beautifulsoup4 scripts/build_arxiv_taxonomy.py

Writes:
    data/arxiv-taxonomy.json   (canonical source of truth)
    web/lib/arxiv/taxonomy.ts  (generated; do not hand-edit)

See: docs/superpowers/specs/2026-06-07-arxiv-taxonomy-design.md
"""
from __future__ import annotations

# Archives whose categories are flagged relevant=true for a data-science
# (Women in Data Science) reading group. Archive-level (coarse) by design.
RELEVANT_ARCHIVES = frozenset({"cs", "stat", "math", "eess", "econ", "q-bio", "q-fin"})


def archive_of(code: str) -> str:
    """Return the archive prefix of a category code (part before the first dot)."""
    return code.split(".", 1)[0]


def is_relevant(code: str) -> bool:
    """True when the category's archive is in the WiDS-relevant allowlist."""
    return archive_of(code) in RELEVANT_ARCHIVES
