"""Tests for scripts/build_arxiv_taxonomy.py.

Run via:
    uv run --with pytest --with httpx --with beautifulsoup4 \
        pytest tests/build_arxiv_taxonomy_test.py -v
"""
from __future__ import annotations


def test_archive_of_splits_on_first_dot():
    from scripts.build_arxiv_taxonomy import archive_of
    assert archive_of("cs.LG") == "cs"
    assert archive_of("q-bio.PE") == "q-bio"
    assert archive_of("econ.TH") == "econ"
    assert archive_of("astro-ph.CO") == "astro-ph"
    # dotless archive code -> whole string
    assert archive_of("hep-th") == "hep-th"


def test_is_relevant_uses_archive_allowlist():
    from scripts.build_arxiv_taxonomy import is_relevant
    assert is_relevant("cs.LG") is True
    assert is_relevant("stat.ML") is True
    assert is_relevant("eess.SP") is True
    assert is_relevant("q-fin.PM") is True
    assert is_relevant("astro-ph.CO") is False
    assert is_relevant("hep-th") is False


import pathlib

FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "arxiv_taxonomy.html"


def _parse_fixture():
    from scripts.build_arxiv_taxonomy import parse_taxonomy
    return parse_taxonomy(FIXTURE.read_text(encoding="utf-8"))


def test_parse_extracts_all_categories():
    cats = _parse_fixture()
    by_code = {c.code: c for c in cats}
    assert set(by_code) == {"cs.AI", "cs.LG", "math.AG", "stat.ML", "astro-ph.CO"}


def test_parse_resolves_code_name_pairs():
    by_code = {c.code: c for c in _parse_fixture()}
    assert by_code["cs.AI"].name == "Artificial Intelligence"
    assert by_code["stat.ML"].name == "Machine Learning"
    assert by_code["math.AG"].name == "Algebraic Geometry"


def test_parse_captures_group_and_description():
    by_code = {c.code: c for c in _parse_fixture()}
    assert by_code["cs.LG"].group == "Computer Science"
    assert by_code["astro-ph.CO"].group == "Physics"
    assert by_code["cs.LG"].description.startswith("Papers on all aspects")


def test_parse_sets_relevance_flag():
    by_code = {c.code: c for c in _parse_fixture()}
    assert by_code["cs.LG"].relevant is True
    assert by_code["stat.ML"].relevant is True
    assert by_code["astro-ph.CO"].relevant is False


def test_parse_returns_codes_sorted():
    cats = _parse_fixture()
    assert [c.code for c in cats] == sorted(c.code for c in cats)
