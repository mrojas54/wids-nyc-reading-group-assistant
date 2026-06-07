"""Scrape arxiv.org/category_taxonomy into a canonical JSON + generated TS module.

Run via:
    uv run --with httpx --with beautifulsoup4 scripts/build_arxiv_taxonomy.py

Writes:
    data/arxiv-taxonomy.json   (canonical source of truth)
    web/lib/arxiv/taxonomy.ts  (generated; do not hand-edit)

See: docs/superpowers/specs/2026-06-07-arxiv-taxonomy-design.md
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from bs4 import BeautifulSoup

# Archives whose categories are flagged relevant=true for a data-science
# (Women in Data Science) reading group. Archive-level (coarse) by design.
RELEVANT_ARCHIVES = frozenset({"cs", "stat", "math", "eess", "econ", "q-bio", "q-fin"})


def archive_of(code: str) -> str:
    """Return the archive prefix of a category code (part before the first dot)."""
    return code.split(".", 1)[0]


def is_relevant(code: str) -> bool:
    """True when the category's archive is in the WiDS-relevant allowlist."""
    return archive_of(code) in RELEVANT_ARCHIVES


_CODE_NAME_RE = re.compile(r"^(\S+)\s*\((.+)\)\s*$")


@dataclass(frozen=True)
class Category:
    code: str
    name: str
    description: str
    group: str
    relevant: bool


def parse_taxonomy(html: str) -> list[Category]:
    """Parse the taxonomy page HTML into a code-sorted list of Category rows.

    Structure assumed: group names in <h2>, each category in an <h4> of the
    form 'cs.AI (Artificial Intelligence)', with its description in a <p>
    inside the same enclosing `.columns` block.
    """
    soup = BeautifulSoup(html, "html.parser")
    out: list[Category] = []
    for h4 in soup.select("#category_taxonomy_list h4"):
        text = h4.get_text(" ", strip=True)
        m = _CODE_NAME_RE.match(text)
        if not m:
            continue
        code = m.group(1)
        name = m.group(2).strip()
        group_h2 = h4.find_previous("h2")
        group = group_h2.get_text(strip=True) if group_h2 else ""
        columns = h4.find_parent(class_="columns")
        p = columns.find("p") if columns else None
        description = p.get_text(" ", strip=True) if p else ""
        out.append(Category(code=code, name=name, description=description,
                            group=group, relevant=is_relevant(code)))
    out.sort(key=lambda c: c.code)
    return out
