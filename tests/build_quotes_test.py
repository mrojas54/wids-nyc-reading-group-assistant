"""Tests for scripts/build_quotes.py. Run via:
    uv run pytest -c tests/pytest.ini tests/build_quotes_test.py -v
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest


def _author(folder: Path, slug: str) -> None:
    folder.mkdir(parents=True)
    (folder / "author.json").write_text(
        json.dumps({"id": slug, "name": slug.title(), "role": "Scientist"}),
        encoding="utf-8",
    )


def _quotes(folder: Path, name: str, quotes: list[dict]) -> None:
    (folder / name).write_text(json.dumps(quotes), encoding="utf-8")


def test_newest_quotes_file_picks_latest_date(tmp_path):
    from scripts.build_quotes import newest_quotes_file
    f = tmp_path / "ada"
    _author(f, "ada")
    _quotes(f, "20260101_quotes.json", [{"id": "a", "text": "x", "verified": False}])
    _quotes(f, "20260615_quotes.json", [{"id": "b", "text": "y", "verified": False}])
    assert newest_quotes_file(f).name == "20260615_quotes.json"


def test_assemble_rejects_slug_id_mismatch(tmp_path):
    from scripts.build_quotes import assemble_bundle, QuoteDataError
    f = tmp_path / "ada"
    f.mkdir(parents=True)
    (f / "author.json").write_text(
        json.dumps({"id": "nope", "name": "A", "role": "R"}), encoding="utf-8"
    )
    _quotes(f, "20260101_quotes.json", [{"id": "a", "text": "x", "verified": False}])
    with pytest.raises(QuoteDataError, match="must equal"):
        assemble_bundle(tmp_path)


def test_assemble_rejects_verified_quote_without_source(tmp_path):
    from scripts.build_quotes import assemble_bundle, QuoteDataError
    f = tmp_path / "ada"
    _author(f, "ada")
    _quotes(f, "20260101_quotes.json", [{"id": "a", "text": "x", "verified": True}])
    with pytest.raises(QuoteDataError, match="sourceUrl"):
        assemble_bundle(tmp_path)


def test_assemble_sorts_authors_and_quotes(tmp_path):
    from scripts.build_quotes import assemble_bundle
    fb = tmp_path / "bohr"
    _author(fb, "bohr")
    _quotes(fb, "20260101_quotes.json", [
        {"id": "z", "text": "t", "verified": True, "sourceUrl": "https://x"},
        {"id": "a", "text": "t", "verified": True, "sourceUrl": "https://x"},
    ])
    fa = tmp_path / "ada"
    _author(fa, "ada")
    _quotes(fa, "20260101_quotes.json", [
        {"id": "m", "text": "t", "verified": True, "sourceUrl": "https://x"},
    ])
    bundle = assemble_bundle(tmp_path)
    assert [e["author"]["id"] for e in bundle["authors"]] == ["ada", "bohr"]
    assert [q["id"] for q in bundle["authors"][1]["quotes"]] == ["a", "z"]


def test_newest_quotes_file_raises_on_empty_folder(tmp_path):
    from scripts.build_quotes import QuoteDataError, newest_quotes_file
    d = tmp_path / "grace"
    d.mkdir()
    with pytest.raises(QuoteDataError, match="no YYYYMMDD"):
        newest_quotes_file(d)


def test_newest_quotes_file_ignores_non_dated_names(tmp_path):
    from scripts.build_quotes import newest_quotes_file
    d = tmp_path / "grace"
    d.mkdir()
    (d / "draft_quotes.json").write_text("[]", encoding="utf-8")
    (d / "20260101_quotes.json").write_text("[]", encoding="utf-8")
    assert newest_quotes_file(d).name == "20260101_quotes.json"


def test_assemble_rejects_missing_author_json(tmp_path):
    from scripts.build_quotes import QuoteDataError, assemble_bundle
    d = tmp_path / "ada"
    d.mkdir()
    (d / "20260101_quotes.json").write_text("[]", encoding="utf-8")
    with pytest.raises(QuoteDataError, match="author.json"):
        assemble_bundle(tmp_path)


def test_assemble_rejects_non_list_quotes(tmp_path):
    from scripts.build_quotes import QuoteDataError, assemble_bundle
    f = tmp_path / "ada"
    _author(f, "ada")
    (f / "20260101_quotes.json").write_text(json.dumps({"not": "a list"}), encoding="utf-8")
    with pytest.raises(QuoteDataError, match="JSON array"):
        assemble_bundle(tmp_path)


def test_assemble_rejects_non_dict_quote(tmp_path):
    from scripts.build_quotes import QuoteDataError, assemble_bundle
    f = tmp_path / "ada"
    _author(f, "ada")
    (f / "20260101_quotes.json").write_text(json.dumps(["not a dict"]), encoding="utf-8")
    with pytest.raises(QuoteDataError, match="JSON object"):
        assemble_bundle(tmp_path)


def test_assemble_rejects_duplicate_quote_id(tmp_path):
    from scripts.build_quotes import QuoteDataError, assemble_bundle
    f = tmp_path / "ada"
    _author(f, "ada")
    _quotes(f, "20260101_quotes.json", [
        {"id": "dup", "text": "a", "verified": True, "sourceUrl": "https://x"},
        {"id": "dup", "text": "b", "verified": True, "sourceUrl": "https://x"},
    ])
    with pytest.raises(QuoteDataError, match="duplicate"):
        assemble_bundle(tmp_path)


# --- real-data guards (require data/quotes/ + the committed bundle) ---


def test_committed_bundle_is_in_sync():
    from scripts.build_quotes import assemble_bundle, QUOTES_DIR, BUNDLE_PATH
    fresh = assemble_bundle(QUOTES_DIR)
    committed = json.loads(BUNDLE_PATH.read_text(encoding="utf-8"))
    assert fresh == committed, "Run `uv run python scripts/build_quotes.py` and commit."


def test_real_data_verified_quotes_have_sources():
    from scripts.build_quotes import assemble_bundle, QUOTES_DIR
    bundle = assemble_bundle(QUOTES_DIR)
    assert bundle["authors"], "expected at least one seeded author"
    for entry in bundle["authors"]:
        for q in entry["quotes"]:
            if q["verified"]:
                assert q.get("sourceUrl"), f'{q["id"]}: verified without sourceUrl'
