"""Tests for scripts/zotero_push.py.

Run via:
    uv run --with pytest --with responses --with "psycopg[binary]" --with pyzotero \\
        pytest tests/zotero_push_test.py -v
"""
from __future__ import annotations


def test_module_imports():
    """Smoke test: the script's main entry is importable."""
    from scripts.zotero_push import main
    assert callable(main)


import pytest

from scripts.zotero_push import normalize_url


@pytest.mark.parametrize("raw, expected", [
    # arxiv pdf -> abs
    ("https://arxiv.org/pdf/2405.02411",
     "https://arxiv.org/abs/2405.02411"),
    ("https://arxiv.org/pdf/2405.02411.pdf",
     "https://arxiv.org/abs/2405.02411"),
    # arxiv abs is preserved
    ("https://arxiv.org/abs/2405.02411",
     "https://arxiv.org/abs/2405.02411"),
    # arxiv with version suffix
    ("https://arxiv.org/abs/2405.02411v2",
     "https://arxiv.org/abs/2405.02411v2"),
    # arxiv with category-qualified id (older format)
    ("https://arxiv.org/abs/cs.LG/0601001",
     "https://arxiv.org/abs/cs.LG/0601001"),
    # arxiv query params dropped
    ("https://arxiv.org/abs/2405.02411?context=cs.CL",
     "https://arxiv.org/abs/2405.02411"),
    # tandfonline ?needAccess=true dropped
    ("https://www.tandfonline.com/doi/epdf/10.1080/26939169.2023.2276446?needAccess=true",
     "https://www.tandfonline.com/doi/epdf/10.1080/26939169.2023.2276446"),
    # http -> https; lowercase host
    ("http://ARXIV.ORG/abs/2405.02411",
     "https://arxiv.org/abs/2405.02411"),
    # mdpi: untouched (no DOI in path; will be resolved later via meta tag)
    ("https://www.mdpi.com/2227-7390/13/10/1551",
     "https://www.mdpi.com/2227-7390/13/10/1551"),
])
def test_normalize_url(raw, expected):
    assert normalize_url(raw) == expected


from scripts.zotero_push import classify_url


@pytest.mark.parametrize("url, expected", [
    ("https://arxiv.org/abs/2405.02411", "arxiv"),
    ("https://arxiv.org/abs/cs.LG/0601001", "arxiv"),
    # DOI in path
    ("https://www.tandfonline.com/doi/epdf/10.1080/26939169.2023.2276446", "doi_in_url"),
    ("https://dl.acm.org/doi/10.1145/3696410.3714618", "doi_in_url"),
    # Page-fetch needed (no DOI in path)
    ("https://www.mdpi.com/2227-7390/13/10/1551", "needs_meta_lookup"),
    ("https://www.nature.com/articles/s41586-024-08025-4", "needs_meta_lookup"),
    ("https://proceedings.mlr.press/v162/budhathoki22a/budhathoki22a.pdf", "needs_meta_lookup"),
    # Plain hosted PDF without publisher infra
    ("https://www.cs.usfca.edu/~mmalensek/publications/shah2018scalable.pdf", "needs_meta_lookup"),
    ("https://static.googleusercontent.com/media/research.google.com/en//pubs/archive/45530.pdf", "needs_meta_lookup"),
])
def test_classify_url(url, expected):
    assert classify_url(url) == expected
