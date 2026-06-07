"""Scrape arxiv.org/category_taxonomy into a canonical JSON + generated TS module.

Run via:
    uv run --with httpx --with beautifulsoup4 scripts/build_arxiv_taxonomy.py

Writes:
    data/arxiv-taxonomy.json   (canonical source of truth)
    web/lib/arxiv/taxonomy.ts  (generated; do not hand-edit)

See: docs/superpowers/specs/2026-06-07-arxiv-taxonomy-design.md
"""
from __future__ import annotations

import datetime as dt
import json
import re
import sys
from dataclasses import asdict, dataclass
from pathlib import Path

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

    def __post_init__(self) -> None:
        # Invariant: `relevant` is a pure function of `code` (its archive).
        # Guard against a caller (or a future bug) constructing a row whose
        # flag disagrees with the archive allowlist.
        if self.relevant != is_relevant(self.code):
            raise ValueError(
                f"Category.relevant={self.relevant} is inconsistent with "
                f"is_relevant({self.code!r})={is_relevant(self.code)}"
            )


@dataclass(frozen=True)
class ParseDiagnostics:
    """Parse-health counters surfaced by parse_with_diagnostics for drift detection."""
    total_h4: int
    parsed: int
    skipped: int
    blank_group: int
    blank_description: int


def parse_with_diagnostics(html: str) -> tuple[list[Category], ParseDiagnostics]:
    """Parse the taxonomy HTML, returning code-sorted rows plus health counters.

    Structure assumed: group names in <h2>, each category in an <h4> of the
    form 'cs.AI (Artificial Intelligence)', with its description in a <p>
    inside the same enclosing `.columns` block. `<h4>` elements that don't
    match the code/name shape are counted as `skipped`; missing group/description
    fall back to "" and are counted, so a silent structural change in the page
    becomes visible to the operator rather than producing blank fields quietly.
    """
    soup = BeautifulSoup(html, "html.parser")
    h4s = soup.select("#category_taxonomy_list h4")
    out: list[Category] = []
    skipped = 0
    for h4 in h4s:
        text = h4.get_text(" ", strip=True)
        m = _CODE_NAME_RE.match(text)
        if not m:
            skipped += 1
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
    diagnostics = ParseDiagnostics(
        total_h4=len(h4s),
        parsed=len(out),
        skipped=skipped,
        blank_group=sum(1 for c in out if not c.group),
        blank_description=sum(1 for c in out if not c.description),
    )
    return out, diagnostics


def parse_taxonomy(html: str) -> list[Category]:
    """Parse the taxonomy page HTML into a code-sorted list of Category rows."""
    categories, _ = parse_with_diagnostics(html)
    return categories


SOURCE_URL = "https://arxiv.org/category_taxonomy"


def to_json_obj(categories: list[Category], generated_at: str) -> dict:
    return {
        "generated_at": generated_at,
        "source": SOURCE_URL,
        "categories": [asdict(c) for c in categories],
    }


MIN_CATEGORIES = 100
# Relative drift: warn (non-fatal) when a fresh parse drops more than this
# fraction below the committed baseline count. Complements the absolute
# MIN_CATEGORIES floor, which a partial corruption can clear silently.
DRIFT_THRESHOLD = 0.20
REPO_ROOT = Path(__file__).resolve().parent.parent
JSON_PATH = REPO_ROOT / "data" / "arxiv-taxonomy.json"
TS_PATH = REPO_ROOT / "web" / "lib" / "arxiv" / "taxonomy.ts"


def passes_sanity(categories: list[Category]) -> bool:
    return len(categories) >= MIN_CATEGORIES and any(c.relevant for c in categories)


def drift_warning(
    new_count: int, baseline_count: int, *, threshold: float = DRIFT_THRESHOLD
) -> str | None:
    """Return a warning string when `new_count` drops more than `threshold`
    below `baseline_count`, else None.

    The boundary is exclusive: a drop of exactly `threshold` does not warn.
    Non-fatal by design — arXiv may legitimately retire categories, so this
    surfaces a relative regression for the operator without gating the build.
    """
    if new_count < baseline_count * (1 - threshold):
        pct = (1 - new_count / baseline_count) * 100 if baseline_count else 0.0
        return (
            f"WARNING: parsed {new_count} categories vs baseline {baseline_count} "
            f"({pct:.0f}% drop, threshold {threshold:.0%}). arXiv page structure "
            "may have changed, or categories were removed."
        )
    return None


def render_typescript(categories: list[Category]) -> str:
    lines = [
        "// AUTO-GENERATED by scripts/build_arxiv_taxonomy.py — do not edit by hand.",
        f"// Source: {SOURCE_URL}",
        "",
        "export interface ArxivCategory {",
        "  readonly code: string;",
        "  readonly name: string;",
        "  readonly description: string;",
        "  readonly group: string;",
        "  readonly relevant: boolean;",
        "}",
        "",
        "export const ARXIV_TAXONOMY: readonly ArxivCategory[] = [",
    ]
    for c in categories:
        lines.append("  " + json.dumps(asdict(c), ensure_ascii=False) + ",")
    lines += [
        "];",
        "",
        "export const RELEVANT_CATEGORIES: readonly ArxivCategory[] =",
        "  ARXIV_TAXONOMY.filter((c) => c.relevant);",
        "",
    ]
    return "\n".join(lines)


def main() -> int:
    import httpx
    resp = httpx.get(SOURCE_URL, timeout=15.0, follow_redirects=True)
    resp.raise_for_status()
    categories, diagnostics = parse_with_diagnostics(resp.text)
    if not passes_sanity(categories):
        print(
            f"ERROR: parsed {len(categories)} categories "
            f"({sum(c.relevant for c in categories)} relevant); "
            "page structure may have changed.",
            file=sys.stderr,
        )
        return 1
    if diagnostics.skipped or diagnostics.blank_group or diagnostics.blank_description:
        print(
            f"WARNING: parse health — {diagnostics.skipped} <h4> skipped "
            f"(no code/name match), {diagnostics.blank_group} blank group, "
            f"{diagnostics.blank_description} blank description "
            f"(of {diagnostics.parsed} parsed). arXiv page structure may have changed.",
            file=sys.stderr,
        )
    # Relative drift check against the committed baseline (non-fatal). Skipped
    # silently on first run; a malformed/old baseline never crashes the build.
    if JSON_PATH.exists():
        try:
            existing = json.loads(JSON_PATH.read_text(encoding="utf-8"))
            baseline_count = len(existing["categories"])
        except (ValueError, KeyError, TypeError, OSError) as exc:
            print(
                f"NOTE: skipping relative drift check — could not read baseline "
                f"{JSON_PATH} ({exc}).",
                file=sys.stderr,
            )
        else:
            message = drift_warning(len(categories), baseline_count)
            if message:
                print(message, file=sys.stderr)
    generated_at = dt.date.today().isoformat()
    JSON_PATH.parent.mkdir(parents=True, exist_ok=True)
    TS_PATH.parent.mkdir(parents=True, exist_ok=True)
    JSON_PATH.write_text(
        json.dumps(to_json_obj(categories, generated_at), indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    TS_PATH.write_text(render_typescript(categories), encoding="utf-8")
    print(f"Wrote {len(categories)} categories to {JSON_PATH} and {TS_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
