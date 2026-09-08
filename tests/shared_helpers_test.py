"""Tests for the helpers shared across scripts: paper_urls, vecmath, env_file.

These pin *policy*, not just behaviour — each of these helpers used to exist
as two or three diverged copies, and the point of the shared module is that
one decision now governs every caller. Run via:
    uv run pytest -c tests/pytest.ini tests/shared_helpers_test.py -v
"""
from __future__ import annotations

import math

import numpy as np
import pytest

from scripts import find_paper_suggest, zotero_push
from scripts.env_file import parse_env_file
from scripts.paper_urls import extract_doi_from_url, is_arxiv_host
from scripts.vecmath import cosine

# ── paper_urls ───────────────────────────────────────────────────────────────


@pytest.mark.parametrize("url, expected", [
    # Publisher URLs that embed the full DOI in the path.
    ("https://www.tandfonline.com/doi/epdf/10.1080/26939169.2023.2276446?needAccess=true",
     "10.1080/26939169.2023.2276446"),
    ("https://dl.acm.org/doi/10.1145/3696410.3714618", "10.1145/3696410.3714618"),
    ("https://doi.org/10.3390/math13101551", "10.3390/math13101551"),
    ("https://doi.org/10.1038/s41586-024-08025-4", "10.1038/s41586-024-08025-4"),
    # A trailing routing segment is not part of the DOI.
    ("https://onlinelibrary.wiley.com/doi/10.1002/abc.123/full", "10.1002/abc.123"),
    # Implicit-prefix and DOI-less URLs.
    ("https://www.nature.com/articles/s41586-024-08025-4", None),
    ("https://www.mdpi.com/2227-7390/13/10/1551", None),
    ("https://www.cs.usfca.edu/~mmalensek/publications/shah2018scalable.pdf", None),
    # The DOI must be in the path — never the query string or fragment.
    ("https://example.org/lookup?doi=10.1000/xyz123", None),
    ("https://example.org/paper#10.1000/xyz123", None),
    # arXiv is always None, whatever the path happens to contain.
    ("https://arxiv.org/abs/2405.02411", None),
    ("https://arxiv.org/abs/1706.03762", None),
    ("https://export.arxiv.org/abs/2405.02411", None),
    ("https://arxiv.org/abs/10.1234/looks-like-a-doi", None),
    ("", None),
])
def test_extract_doi_from_url_policy(url, expected):
    assert extract_doi_from_url(url) == expected


def test_suggest_and_zotero_share_one_doi_extractor():
    """The two send paths must not be able to disagree on a paper's DOI."""
    assert find_paper_suggest.extract_doi_from_url is extract_doi_from_url
    assert zotero_push.extract_doi_from_url is extract_doi_from_url


@pytest.mark.parametrize("netloc, expected", [
    ("arxiv.org", True),
    ("ARXIV.ORG", True),
    ("export.arxiv.org", True),
    ("arxiv.org:443", True),
    ("notarxiv.org", False),
    ("arxiv.org.evil.example", False),
    ("", False),
])
def test_is_arxiv_host(netloc, expected):
    assert is_arxiv_host(netloc) is expected


def test_classify_url_agrees_with_the_shared_extractor():
    assert zotero_push.classify_url("https://arxiv.org/abs/2405.02411") == "arxiv"
    assert zotero_push.classify_url("https://dl.acm.org/doi/10.1145/3696410.3714618") == "doi_in_url"
    assert zotero_push.classify_url("https://www.mdpi.com/2227-7390/13/10/1551") == "needs_meta_lookup"


# ── vecmath ──────────────────────────────────────────────────────────────────


def test_cosine_basic_geometry():
    a = np.array([1.0, 2.0, 3.0])
    assert math.isclose(cosine(a, a), 1.0, abs_tol=1e-9)
    assert math.isclose(cosine(np.array([1.0, 0.0]), np.array([0.0, 1.0])), 0.0, abs_tol=1e-9)
    assert math.isclose(cosine(np.array([1.0, 0.0]), np.array([-1.0, 0.0])), -1.0, abs_tol=1e-9)


def test_cosine_zero_norm_is_zero_not_nan():
    """The guard the verification scripts used to lack: a degenerate embedding
    must score 0.0 in parity exactly as it does in ranking."""
    zero = np.zeros(3)
    assert cosine(zero, np.array([1.0, 2.0, 3.0])) == 0.0
    assert cosine(np.array([1.0, 2.0, 3.0]), zero) == 0.0
    assert cosine(zero, zero) == 0.0


def test_ranking_path_uses_the_shared_cosine():
    assert find_paper_suggest.cosine is cosine


def test_specter2_scripts_import_the_shared_cosine():
    """The heavy SPECTER2 scripts can't be imported here (torch), so check the
    source: no private cosine, and the shared one is imported."""
    from pathlib import Path
    root = Path(__file__).resolve().parent.parent / "scripts"
    for name in ("export_specter2_onnx.py", "verify_specter2_local_vs_s2.py"):
        src = (root / name).read_text(encoding="utf-8")
        assert "def cosine(" not in src, name
        assert "from scripts.vecmath import cosine" in src, name


# ── env_file ─────────────────────────────────────────────────────────────────


def test_parse_env_file(tmp_path):
    env = tmp_path / ".env.local"
    env.write_text(
        "# comment\n"
        "ZOTERO_API_KEY=abc123\n"
        'ZOTERO_GROUP_ID="6540956"\n'
        "WIDS_PROD_HOST='https://x.example'\n"
        "  INDENTED=ok\n"
        "lowercase=ignored\n"
        "not a line\n"
        "\n"
        "EMPTY=\n"
        'LONE_QUOTE="\n'
    )
    assert parse_env_file(env) == {
        "ZOTERO_API_KEY": "abc123",
        "ZOTERO_GROUP_ID": "6540956",
        "WIDS_PROD_HOST": "https://x.example",
        "INDENTED": "ok",
        "EMPTY": "",
        "LONE_QUOTE": '"',
    }


def test_parse_env_file_missing_is_empty(tmp_path):
    assert parse_env_file(tmp_path / "nope") == {}


def test_both_operator_scripts_share_the_env_parser():
    from scripts import generate_prerequisites
    assert zotero_push._parse_env_file is parse_env_file
    assert generate_prerequisites._parse_env_file is parse_env_file
