"""Tests for scripts/paper_urls.py: the scheme guards shared by the suggest
and Zotero paths."""
from __future__ import annotations

import pytest

from scripts.paper_urls import extract_doi_from_url, has_refused_scheme, is_http_url


@pytest.mark.parametrize("url, expected", [
    ("https://arxiv.org/abs/1706.03762", True),
    ("http://arxiv.org/abs/1706.03762", True),
    ("HTTPS://ARXIV.ORG/abs/1706.03762", True),
    ("  https://arxiv.org/abs/1706.03762  ", True),
    # Not a web link
    ("javascript:alert(1)", False),
    ("JavaScript:alert(1)", False),
    ("data:text/html,<script>alert(1)</script>", False),
    ("file:///etc/passwd", False),
    # Scheme present but no host
    ("https://", False),
    # Bare identifiers and relative paths are not absolute URLs
    ("10.3390/math13101551", False),
    ("arxiv.org/abs/1706.03762", False),
    ("/papers/2", False),
    ("", False),
])
def test_is_http_url(url, expected):
    assert is_http_url(url) is expected


@pytest.mark.parametrize("url, expected", [
    # http(s) and the doi identifier prefix are parsed, not refused
    ("https://arxiv.org/abs/1706.03762", False),
    ("http://arxiv.org/abs/1706.03762", False),
    ("doi:10.3390/math13101551", False),
    ("DOI:10.3390/math13101551", False),
    # Bare identifiers carry no scheme, so they are left alone
    ("10.3390/math13101551", False),
    ("2501.12345", False),
    ("", False),
    # Refused
    ("javascript:alert(1)", True),
    ("JavaScript:alert(1)", True),
    ("data:text/html,x", True),
    ("file:///etc/passwd", True),
    ("vbscript:msgbox(1)", True),
])
def test_has_refused_scheme(url, expected):
    assert has_refused_scheme(url) is expected


@pytest.mark.parametrize("url", [
    # The DOI is searched for in the path, so a script URL carrying one in its
    # body would otherwise yield a DOI and pull the paper into the pipeline.
    "javascript:void('10.3390/math13101551')",
    "data:text/plain,10.3390/math13101551",
])
def test_extract_doi_from_url_refuses_non_http_schemes(url):
    assert extract_doi_from_url(url) is None
