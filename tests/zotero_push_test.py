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


import responses

from scripts.zotero_push import extract_arxiv_metadata

ARXIV_ATOM_FIXTURE = """<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2405.02411v1</id>
    <updated>2024-05-04T00:00:00Z</updated>
    <published>2024-05-03T00:00:00Z</published>
    <title>The Call for Socially Aware Language Technologies</title>
    <summary>Some abstract text here. Multiple sentences.</summary>
    <author><name>Diyi Yang</name></author>
    <author><name>Dirk Hovy</name></author>
    <author><name>David Jurgens</name></author>
    <category term="cs.CL" />
  </entry>
</feed>
"""


@responses.activate
def test_extract_arxiv_metadata_happy():
    responses.add(
        responses.GET,
        "https://export.arxiv.org/api/query",
        body=ARXIV_ATOM_FIXTURE,
        status=200,
        content_type="application/atom+xml",
    )
    meta = extract_arxiv_metadata("https://arxiv.org/abs/2405.02411")
    assert meta["item_type"] == "preprint"
    assert meta["title"] == "The Call for Socially Aware Language Technologies"
    assert meta["authors"] == ["Diyi Yang", "Dirk Hovy", "David Jurgens"]
    assert "Some abstract text" in meta["abstract"]
    assert meta["year"] == 2024
    assert meta["arxiv_id"] == "2405.02411"
    assert meta["url"] == "https://arxiv.org/abs/2405.02411"


@responses.activate
def test_extract_arxiv_metadata_404_returns_none():
    responses.add(
        responses.GET,
        "https://export.arxiv.org/api/query",
        body="<feed xmlns='http://www.w3.org/2005/Atom'></feed>",
        status=200,
    )
    meta = extract_arxiv_metadata("https://arxiv.org/abs/9999.99999")
    assert meta is None


@pytest.mark.parametrize("url, expected_id", [
    ("https://arxiv.org/abs/2405.02411", "2405.02411"),
    ("https://arxiv.org/abs/2405.02411v3", "2405.02411v3"),
    ("https://arxiv.org/abs/cs.LG/0601001", "cs.LG/0601001"),
])
def test_arxiv_id_parsed_from_url(url, expected_id):
    from scripts.zotero_push import _arxiv_id_from_url
    assert _arxiv_id_from_url(url) == expected_id


from scripts.zotero_push import extract_doi_from_url, extract_doi_from_meta_tag


@pytest.mark.parametrize("url, expected", [
    ("https://www.tandfonline.com/doi/epdf/10.1080/26939169.2023.2276446",
     "10.1080/26939169.2023.2276446"),
    ("https://dl.acm.org/doi/10.1145/3696410.3714618",
     "10.1145/3696410.3714618"),
    ("https://doi.org/10.3390/math13101551",
     "10.3390/math13101551"),
    ("https://www.mdpi.com/2227-7390/13/10/1551", None),
    ("https://arxiv.org/abs/2405.02411", None),
])
def test_extract_doi_from_url(url, expected):
    assert extract_doi_from_url(url) == expected


@responses.activate
def test_extract_doi_from_meta_tag_found():
    html = """<html><head>
      <meta name="citation_doi" content="10.3390/math13101551" />
      <meta name="citation_title" content="Some Math Paper" />
    </head><body></body></html>"""
    responses.add(
        responses.GET,
        "https://www.mdpi.com/2227-7390/13/10/1551",
        body=html,
        status=200,
        content_type="text/html",
    )
    assert extract_doi_from_meta_tag("https://www.mdpi.com/2227-7390/13/10/1551") \
        == "10.3390/math13101551"


@responses.activate
def test_extract_doi_from_meta_tag_absent():
    responses.add(
        responses.GET,
        "https://example.com/paper",
        body="<html><head></head></html>",
        status=200,
        content_type="text/html",
    )
    assert extract_doi_from_meta_tag("https://example.com/paper") is None


@responses.activate
def test_extract_doi_from_meta_tag_404_is_none():
    responses.add(
        responses.GET,
        "https://example.com/missing",
        status=404,
    )
    assert extract_doi_from_meta_tag("https://example.com/missing") is None


@responses.activate
def test_extract_doi_from_meta_tag_pdf_is_none():
    """A direct PDF URL has no meta tags — must return None, not blow up."""
    responses.add(
        responses.GET,
        "https://example.com/paper.pdf",
        body=b"%PDF-1.4 binary content",
        status=200,
        content_type="application/pdf",
    )
    assert extract_doi_from_meta_tag("https://example.com/paper.pdf") is None
