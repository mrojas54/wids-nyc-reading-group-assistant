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
    with pytest.raises(QuoteDataError):
        assemble_bundle(tmp_path)


def test_assemble_rejects_verified_quote_without_source(tmp_path):
    from scripts.build_quotes import assemble_bundle, QuoteDataError
    f = tmp_path / "ada"
    _author(f, "ada")
    _quotes(f, "20260101_quotes.json", [{"id": "a", "text": "x", "verified": True}])
    with pytest.raises(QuoteDataError):
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
