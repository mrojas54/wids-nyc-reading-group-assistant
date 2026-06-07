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
