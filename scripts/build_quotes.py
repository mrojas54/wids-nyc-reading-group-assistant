"""Validate per-author quote folders and emit the generated bundle.

Source of truth:  data/quotes/<slug>/author.json + <slug>/YYYYMMDD_quotes.json
Generated:        web/lib/quotes.generated.json   (committed; drift-guarded)

The newest YYYYMMDD_quotes.json per folder is "current" (dates sort
lexicographically, so max-by-name == newest). The quotes.json symlink is a
human convenience only: ignored for resolution, refreshed best-effort after a
successful run.

Run via:
    uv run python scripts/build_quotes.py
Tests:
    uv run pytest -c tests/pytest.ini tests/build_quotes_test.py -v
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
QUOTES_DIR = REPO_ROOT / "data" / "quotes"
BUNDLE_PATH = REPO_ROOT / "web" / "lib" / "quotes.generated.json"
BUNDLE_VERSION = 1

_AUTHOR_REQUIRED = ("id", "name", "role")
_DATED_QUOTES_RE = re.compile(r"\d{8}_quotes\.json")


class QuoteDataError(ValueError):
    """Raised when an author folder violates the schema or sourcing rules."""


def newest_quotes_file(folder: Path) -> Path:
    """Return the newest YYYYMMDD_quotes.json in `folder`.

    Only 8-digit-date-prefixed names count, so a stray `draft_quotes.json` or the
    dateless `quotes.json` symlink can never become "current". Dates sort
    lexicographically, so max-by-name == newest.
    """
    candidates = sorted(
        p for p in folder.glob("*_quotes.json") if _DATED_QUOTES_RE.fullmatch(p.name)
    )
    if not candidates:
        raise QuoteDataError(f"{folder.name}: no YYYYMMDD_quotes.json found")
    return candidates[-1]


def load_author(folder: Path) -> dict[str, Any]:
    author_path = folder / "author.json"
    if not author_path.exists():
        raise QuoteDataError(f"{folder.name}: missing author.json")
    try:
        author: dict[str, Any] = json.loads(author_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise QuoteDataError(f"{folder.name}: author.json is not valid JSON: {exc}") from exc
    for field in _AUTHOR_REQUIRED:
        if not author.get(field):
            raise QuoteDataError(f"{folder.name}: author.{field} is required")
    if author["id"] != folder.name:
        raise QuoteDataError(
            f"{folder.name}: author.id={author['id']!r} must equal the folder slug"
        )
    return author


def load_quotes(folder: Path) -> list[dict[str, Any]]:
    newest = newest_quotes_file(folder)
    try:
        quotes: Any = json.loads(newest.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise QuoteDataError(f"{folder.name}: {newest.name} is not valid JSON: {exc}") from exc
    if not isinstance(quotes, list):
        raise QuoteDataError(f"{folder.name}: quotes file must be a JSON array")
    seen: set[str] = set()
    for q in quotes:
        if not isinstance(q, dict):
            raise QuoteDataError(
                f"{folder.name}: each quote must be a JSON object, got {type(q).__name__}"
            )
        qid = q.get("id")
        if not qid:
            raise QuoteDataError(f"{folder.name}: a quote is missing 'id'")
        if not q.get("text"):
            raise QuoteDataError(f"{folder.name}/{qid}: 'text' is required")
        if "verified" not in q:
            raise QuoteDataError(f"{folder.name}/{qid}: 'verified' is required")
        if q["verified"] and not q.get("sourceUrl"):
            raise QuoteDataError(
                f"{folder.name}/{qid}: verified quotes require a 'sourceUrl'"
            )
        if q["verified"] and not q.get("source"):
            raise QuoteDataError(
                f"{folder.name}/{qid}: verified quotes require a 'source' note"
            )
        if qid in seen:
            raise QuoteDataError(f"{folder.name}: duplicate quote id {qid!r}")
        seen.add(qid)
    return quotes


def assemble_bundle(quotes_dir: Path) -> dict[str, Any]:
    """Validate every author folder and return the normalized bundle dict."""
    entries: list[dict[str, Any]] = []
    for folder in sorted(p for p in quotes_dir.iterdir() if p.is_dir()):
        author = load_author(folder)
        quotes = sorted(load_quotes(folder), key=lambda q: q["id"])
        entries.append({"author": author, "quotes": quotes})
    entries.sort(key=lambda e: e["author"]["id"])
    return {"version": BUNDLE_VERSION, "authors": entries}


def refresh_symlink(folder: Path, newest: Path) -> None:
    """Best-effort: point folder/quotes.json at `newest`. Warn, never fail."""
    link = folder / "quotes.json"
    try:
        if link.is_symlink() or link.exists():
            link.unlink()
        link.symlink_to(newest.name)
    except OSError as exc:  # platforms without symlink support
        print(f"WARNING: could not refresh {link}: {exc}", file=sys.stderr)


def write_bundle(bundle: dict[str, Any]) -> None:
    BUNDLE_PATH.parent.mkdir(parents=True, exist_ok=True)
    BUNDLE_PATH.write_text(
        json.dumps(bundle, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )


def main() -> int:
    try:
        bundle = assemble_bundle(QUOTES_DIR)
    except QuoteDataError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    write_bundle(bundle)
    for folder in sorted(p for p in QUOTES_DIR.iterdir() if p.is_dir()):
        try:
            newest = newest_quotes_file(folder)
        except QuoteDataError as exc:
            print(f"WARNING: skipping symlink refresh — {exc}", file=sys.stderr)
            continue
        refresh_symlink(folder, newest)
    n_quotes = sum(len(e["quotes"]) for e in bundle["authors"])
    print(f"Wrote {len(bundle['authors'])} authors / {n_quotes} quotes to {BUNDLE_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
