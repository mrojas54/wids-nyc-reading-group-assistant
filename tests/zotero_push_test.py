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


from scripts.zotero_push import extract_crossref_metadata


CROSSREF_FIXTURE = {
    "status": "ok",
    "message": {
        "DOI": "10.3390/math13101551",
        "title": ["Some Math Paper Title"],
        "author": [
            {"given": "Alice", "family": "Smith"},
            {"given": "Bob", "family": "Jones"},
        ],
        "abstract": "<jats:p>Abstract text here.</jats:p>",
        "container-title": ["Mathematics"],
        "issued": {"date-parts": [[2025, 5, 15]]},
        "type": "journal-article",
        "URL": "https://doi.org/10.3390/math13101551",
    },
}


@responses.activate
def test_extract_crossref_metadata_happy():
    responses.add(
        responses.GET,
        "https://api.crossref.org/works/10.3390/math13101551",
        json=CROSSREF_FIXTURE,
        status=200,
    )
    meta = extract_crossref_metadata("10.3390/math13101551",
                                     paper_url="https://www.mdpi.com/2227-7390/13/10/1551")
    assert meta["item_type"] == "journalArticle"
    assert meta["title"] == "Some Math Paper Title"
    assert meta["authors"] == ["Alice Smith", "Bob Jones"]
    assert "Abstract text here" in meta["abstract"]
    assert "<jats:p>" not in meta["abstract"]
    assert meta["venue"] == "Mathematics"
    assert meta["year"] == 2025
    assert meta["doi"] == "10.3390/math13101551"
    assert meta["url"] == "https://www.mdpi.com/2227-7390/13/10/1551"


@responses.activate
def test_extract_crossref_metadata_404_returns_none():
    responses.add(
        responses.GET,
        "https://api.crossref.org/works/10.bogus/123",
        status=404,
    )
    meta = extract_crossref_metadata("10.bogus/123", paper_url="https://example.com")
    assert meta is None


@responses.activate
def test_extract_crossref_metadata_proceedings_article_type():
    fixture = {
        "status": "ok",
        "message": {
            "DOI": "10.1145/x",
            "title": ["Proc Paper"],
            "author": [{"given": "X", "family": "Y"}],
            "container-title": ["Proc. ACM Conf"],
            "issued": {"date-parts": [[2022]]},
            "type": "proceedings-article",
            "URL": "https://doi.org/10.1145/x",
        },
    }
    responses.add(
        responses.GET,
        "https://api.crossref.org/works/10.1145/x",
        json=fixture,
        status=200,
    )
    meta = extract_crossref_metadata("10.1145/x", paper_url="https://dl.acm.org/doi/10.1145/x")
    assert meta["item_type"] == "conferencePaper"
    assert meta["year"] == 2022


from unittest.mock import MagicMock

from scripts.zotero_push import extract_db_fallback_metadata


def test_extract_db_fallback_metadata_full_row():
    conn = MagicMock()
    cursor = conn.cursor.return_value.__enter__.return_value
    cursor.fetchone.return_value = (
        "Some Title",
        "https://example.com/paper.pdf",
        "Plain abstract.",
        ["Alice", "Bob"],
        "Some Venue",
        2023,
    )
    meta = extract_db_fallback_metadata(conn, paper_id=42)
    assert meta == {
        "item_type": "webpage",
        "title": "Some Title",
        "authors": ["Alice", "Bob"],
        "abstract": "Plain abstract.",
        "venue": "Some Venue",
        "year": 2023,
        "url": "https://example.com/paper.pdf",
    }


def test_extract_db_fallback_metadata_missing_optional_fields():
    conn = MagicMock()
    cursor = conn.cursor.return_value.__enter__.return_value
    cursor.fetchone.return_value = (
        "Bare Title", "https://x.example", None, None, None, None,
    )
    meta = extract_db_fallback_metadata(conn, paper_id=7)
    assert meta["title"] == "Bare Title"
    assert meta["authors"] == []
    assert meta["abstract"] == ""
    assert meta["venue"] is None
    assert meta["year"] is None


def test_extract_db_fallback_metadata_no_paper_raises():
    conn = MagicMock()
    cursor = conn.cursor.return_value.__enter__.return_value
    cursor.fetchone.return_value = None
    with pytest.raises(ValueError, match="paper_id=999 not found"):
        extract_db_fallback_metadata(conn, paper_id=999)


# ---------------------------------------------------------------------------
# Task 9: extract_metadata orchestrator
# ---------------------------------------------------------------------------
from scripts.zotero_push import extract_metadata


@responses.activate
def test_extract_metadata_arxiv_path():
    responses.add(
        responses.GET, "https://export.arxiv.org/api/query",
        body=ARXIV_ATOM_FIXTURE, status=200,
    )
    conn = MagicMock()
    meta = extract_metadata(
        conn,
        paper_id=1,
        paper_url="https://arxiv.org/abs/2405.02411",
    )
    assert meta["item_type"] == "preprint"
    assert meta["arxiv_id"] == "2405.02411"
    conn.cursor.assert_not_called()


@responses.activate
def test_extract_metadata_doi_in_url_path():
    responses.add(
        responses.GET, "https://api.crossref.org/works/10.1080/26939169.2023.2276446",
        json=CROSSREF_FIXTURE, status=200,
    )
    conn = MagicMock()
    meta = extract_metadata(
        conn,
        paper_id=1,
        paper_url="https://www.tandfonline.com/doi/epdf/10.1080/26939169.2023.2276446",
    )
    assert meta["item_type"] == "journalArticle"
    assert meta["doi"] == "10.3390/math13101551"
    conn.cursor.assert_not_called()


@responses.activate
def test_extract_metadata_meta_tag_path():
    """needs_meta_lookup: page fetch finds DOI, then CrossRef succeeds."""
    html = b'<html><head><meta name="citation_doi" content="10.3390/math13101551"/></head></html>'
    responses.add(
        responses.GET, "https://www.mdpi.com/2227-7390/13/10/1551",
        body=html, status=200, content_type="text/html",
    )
    responses.add(
        responses.GET, "https://api.crossref.org/works/10.3390/math13101551",
        json=CROSSREF_FIXTURE, status=200,
    )
    conn = MagicMock()
    meta = extract_metadata(
        conn,
        paper_id=1,
        paper_url="https://www.mdpi.com/2227-7390/13/10/1551",
    )
    assert meta["item_type"] == "journalArticle"
    conn.cursor.assert_not_called()


@responses.activate
def test_extract_metadata_falls_back_when_arxiv_returns_no_entry():
    """arXiv API returns empty feed -> fall back to DB."""
    responses.add(
        responses.GET, "https://export.arxiv.org/api/query",
        body="<feed xmlns='http://www.w3.org/2005/Atom'></feed>",
        status=200,
    )
    conn = MagicMock()
    cursor = conn.cursor.return_value.__enter__.return_value
    cursor.fetchone.return_value = (
        "Fallback Title", "https://arxiv.org/abs/9999.99", None, None, None, None,
    )
    meta = extract_metadata(
        conn, paper_id=1,
        paper_url="https://arxiv.org/abs/9999.99",
    )
    assert meta["item_type"] == "webpage"
    assert meta["title"] == "Fallback Title"


@responses.activate
def test_extract_metadata_falls_back_when_no_meta_doi_found():
    """needs_meta_lookup with no citation_doi -> DB fallback."""
    responses.add(
        responses.GET, "https://example.com/paper.pdf",
        body=b"%PDF-1.4", status=200, content_type="application/pdf",
    )
    conn = MagicMock()
    cursor = conn.cursor.return_value.__enter__.return_value
    cursor.fetchone.return_value = (
        "PDF Title", "https://example.com/paper.pdf", None, ["X"], None, 2020,
    )
    meta = extract_metadata(conn, paper_id=1, paper_url="https://example.com/paper.pdf")
    assert meta["item_type"] == "webpage"
    assert meta["authors"] == ["X"]


# ---------------------------------------------------------------------------
# Task 10: build_note_html
# ---------------------------------------------------------------------------

from datetime import datetime, timezone

from scripts.zotero_push import build_note_html


def test_build_note_html_full():
    # 2026-03-12 19:00 UTC = 2026-03-12 15:00 EDT (Wednesday)
    meeting_dt = datetime(2026, 3, 12, 19, 0, tzinfo=timezone.utc)
    html = build_note_html(
        meeting_at=meeting_dt,
        leader_name="Michelle Rojas",
        topic_names=["LLM Security", "Adversarial ML"],
        companion_path="/papers/12",
        prod_host="https://wids-nyc-reading-group-assistant.vercel.app",
    )
    assert "<strong>WiDS NYC Reading Group</strong>" in html
    assert "Thursday, March 12, 2026" in html
    assert "Michelle Rojas" in html
    assert "LLM Security / Adversarial ML" in html
    assert "https://wids-nyc-reading-group-assistant.vercel.app/papers/12" in html


def test_build_note_html_omits_missing_fields():
    html = build_note_html(
        meeting_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        leader_name=None,
        topic_names=[],
        companion_path=None,
        prod_host="https://x.example",
    )
    assert "WiDS NYC" in html
    assert "Leader" not in html
    assert "Topic" not in html
    assert "Companion" not in html
    assert "None" not in html
    assert "January 1, 2026" in html or "December 31, 2025" in html


def test_build_note_html_meeting_at_none():
    """meeting_at=None (e.g. meeting in 'prep' status) -> Meeting line omitted."""
    html = build_note_html(
        meeting_at=None,
        leader_name="Some Leader",
        topic_names=["Topic A"],
        companion_path="/papers/1",
        prod_host="https://x.example",
    )
    assert "<strong>WiDS NYC Reading Group</strong>" in html
    assert "Meeting:" not in html  # line omitted
    assert "Some Leader" in html  # other fields still rendered
    assert "Topic A" in html
    assert "https://x.example/papers/1" in html


def test_build_note_html_single_topic():
    html = build_note_html(
        meeting_at=datetime(2026, 5, 15, 14, 0, tzinfo=timezone.utc),
        leader_name="X",
        topic_names=["Causal Inference"],
        companion_path="/papers/1",
        prod_host="https://x.example",
    )
    assert "Causal Inference" in html
    assert " / " not in html.split("Topic:")[1].split("</li>")[0]


# ---------------------------------------------------------------------------
# Task 11: create_zotero_item
# ---------------------------------------------------------------------------

from unittest.mock import patch

from scripts.zotero_push import create_zotero_item


def _preprint_template():
    return {
        "itemType": "preprint",
        "title": "",
        "creators": [{"creatorType": "author", "firstName": "", "lastName": ""}],
        "abstractNote": "",
        "url": "",
        "date": "",
        "extra": "",
        "tags": [],
    }


def _journal_template():
    return {
        "itemType": "journalArticle",
        "title": "",
        "creators": [{"creatorType": "author", "firstName": "", "lastName": ""}],
        "abstractNote": "",
        "url": "",
        "DOI": "",
        "publicationTitle": "",
        "date": "",
        "extra": "",
        "tags": [],
    }


def _webpage_template():
    return {
        "itemType": "webpage",
        "title": "",
        "creators": [{"creatorType": "author", "firstName": "", "lastName": ""}],
        "abstractNote": "",
        "url": "",
        "date": "",
        "extra": "",
        "tags": [],
    }


@patch("scripts.zotero_push.Zotero")
def test_create_zotero_item_arxiv_preprint(mock_zotero_cls):
    mock_zot = mock_zotero_cls.return_value
    mock_zot.item_template.return_value = _preprint_template()
    mock_zot.create_items.return_value = {
        "successful": {"0": {"key": "ABCD1234"}},
        "failed": {},
    }

    meta = {
        "item_type": "preprint",
        "title": "T",
        "authors": ["Alice Smith", "Bob"],
        "abstract": "A.",
        "year": 2024,
        "arxiv_id": "2405.02411",
        "url": "https://arxiv.org/abs/2405.02411",
    }
    key = create_zotero_item(
        meta=meta, paper_id=42, api_key="fake-key", group_id="6540956",
    )
    assert key == "ABCD1234"

    mock_zotero_cls.assert_called_once_with(
        library_id="6540956",
        library_type="group",
        api_key="fake-key",
    )
    mock_zot.item_template.assert_called_once_with("preprint")

    sent_items = mock_zot.create_items.call_args[0][0]
    assert isinstance(sent_items, list) and len(sent_items) == 1
    item = sent_items[0]
    assert item["itemType"] == "preprint"
    assert item["title"] == "T"
    assert item["url"] == "https://arxiv.org/abs/2405.02411"
    assert item["abstractNote"] == "A."
    assert item["date"] == "2024"
    assert item["creators"] == [
        {"creatorType": "author", "firstName": "Alice", "lastName": "Smith"},
        {"creatorType": "author", "firstName": "", "lastName": "Bob"},
    ]
    assert "wids_paper_id:42" in item["extra"]
    assert "arXiv:2405.02411" in item["extra"]
    assert {"tag": "WiDS NYC Reading Group"} in item["tags"]


@patch("scripts.zotero_push.Zotero")
def test_create_zotero_item_journal_article(mock_zotero_cls):
    mock_zot = mock_zotero_cls.return_value
    mock_zot.item_template.return_value = _journal_template()
    mock_zot.create_items.return_value = {
        "successful": {"0": {"key": "WXYZ0001"}},
        "failed": {},
    }

    meta = {
        "item_type": "journalArticle",
        "title": "Math Paper",
        "authors": ["A B"],
        "abstract": "abc",
        "venue": "Mathematics",
        "year": 2025,
        "doi": "10.3390/math13101551",
        "url": "https://www.mdpi.com/2227-7390/13/10/1551",
    }
    key = create_zotero_item(meta=meta, paper_id=7, api_key="k", group_id="6540956")
    assert key == "WXYZ0001"

    mock_zot.item_template.assert_called_once_with("journalArticle")

    sent = mock_zot.create_items.call_args[0][0][0]
    assert sent["itemType"] == "journalArticle"
    assert sent["DOI"] == "10.3390/math13101551"
    assert sent["publicationTitle"] == "Mathematics"
    assert isinstance(sent["extra"], str)
    assert "wids_paper_id:7" in sent["extra"]


@patch("scripts.zotero_push.Zotero")
def test_create_zotero_item_failed_payload_raises(mock_zotero_cls):
    mock_zot = mock_zotero_cls.return_value
    mock_zot.item_template.return_value = _webpage_template()
    mock_zot.create_items.return_value = {
        "successful": {},
        "failed": {"0": {"code": 400, "message": "bad"}},
    }
    meta = {
        "item_type": "webpage", "title": "T", "authors": [], "abstract": "",
        "venue": None, "year": None, "url": "https://x.example",
    }
    with pytest.raises(RuntimeError, match="Zotero rejected item"):
        create_zotero_item(meta=meta, paper_id=1, api_key="k", group_id="6540956")


# ---------------------------------------------------------------------------
# create_zotero_note
# ---------------------------------------------------------------------------

from scripts.zotero_push import create_zotero_note


@patch("scripts.zotero_push.Zotero")
def test_create_zotero_note_attaches_to_parent(mock_zotero_cls):
    mock_zot = mock_zotero_cls.return_value
    mock_zot.create_items.return_value = {
        "successful": {"0": {"key": "NOTE0001"}},
        "failed": {},
    }

    note_html = "<p>WiDS</p>"
    note_key = create_zotero_note(
        parent_item_key="ABCD1234",
        note_html=note_html,
        api_key="k",
        group_id="6540956",
    )
    assert note_key == "NOTE0001"

    mock_zotero_cls.assert_called_once_with(
        library_id="6540956",
        library_type="group",
        api_key="k",
    )
    sent = mock_zot.create_items.call_args[0][0][0]
    assert sent["itemType"] == "note"
    assert sent["parentItem"] == "ABCD1234"
    assert sent["note"] == note_html


@patch("scripts.zotero_push.Zotero")
def test_create_zotero_note_failed_payload_raises(mock_zotero_cls):
    mock_zot = mock_zotero_cls.return_value
    mock_zot.create_items.return_value = {
        "successful": {},
        "failed": {"0": {"code": 400, "message": "bad parent"}},
    }
    with pytest.raises(RuntimeError, match="Zotero rejected note"):
        create_zotero_note(
            parent_item_key="BAD",
            note_html="<p/>",
            api_key="k",
            group_id="6540956",
        )


from scripts.zotero_push import find_existing_zotero_item


@patch("scripts.zotero_push.Zotero")
def test_find_existing_zotero_item_match_found(mock_zotero_cls):
    mock_zot = mock_zotero_cls.return_value
    mock_zot.items.return_value = [
        {"key": "OLD12345", "data": {"extra": "wids_paper_id:42\narXiv:x"}},
        {"key": "OTHER567", "data": {"extra": "wids_paper_id:9999"}},
    ]
    key = find_existing_zotero_item(paper_id=42, api_key="k", group_id="6540956")
    assert key == "OLD12345"

    mock_zotero_cls.assert_called_once_with(
        library_id="6540956",
        library_type="group",
        api_key="k",
    )
    mock_zot.items.assert_called_once_with(q="wids_paper_id:42", qmode="everything")


@patch("scripts.zotero_push.Zotero")
def test_find_existing_zotero_item_no_match(mock_zotero_cls):
    mock_zot = mock_zotero_cls.return_value
    mock_zot.items.return_value = [
        {"key": "OTHER567", "data": {"extra": "wids_paper_id:9999"}},
    ]
    assert find_existing_zotero_item(paper_id=42, api_key="k", group_id="6540956") is None


@patch("scripts.zotero_push.Zotero")
def test_find_existing_zotero_item_empty_results(mock_zotero_cls):
    mock_zot = mock_zotero_cls.return_value
    mock_zot.items.return_value = []
    assert find_existing_zotero_item(paper_id=42, api_key="k", group_id="6540956") is None


# ---------------------------------------------------------------------------
# Task 14: push_to_zotero orchestrator
# ---------------------------------------------------------------------------

from scripts.zotero_push import push_to_zotero


def _meeting_row(scheduled_at, leader_name, topic_names, companion_path):
    """Helper: shape returned by the meeting-context query."""
    return (scheduled_at, leader_name, topic_names, companion_path)


@patch("scripts.zotero_push.create_zotero_note")
@patch("scripts.zotero_push.create_zotero_item")
@patch("scripts.zotero_push.find_existing_zotero_item")
@responses.activate
def test_push_to_zotero_happy_path_arxiv(mock_find, mock_item, mock_note):
    responses.add(
        responses.GET, "https://export.arxiv.org/api/query",
        body=ARXIV_ATOM_FIXTURE, status=200,
    )
    mock_find.return_value = None
    mock_item.return_value = "ITEM0001"
    mock_note.return_value = "NOTE0001"

    conn = MagicMock()
    cursor = conn.cursor.return_value.__enter__.return_value
    cursor.fetchone.side_effect = [
        ("https://arxiv.org/abs/2405.02411", None),
        _meeting_row(
            datetime(2026, 3, 12, 19, 0, tzinfo=timezone.utc),
            "Michelle Rojas",
            ["LLM Security"],
            "/papers/12",
        ),
    ]

    item_key = push_to_zotero(
        conn,
        paper_id=12,
        meeting_id=42,
        api_key="k",
        group_id="6540956",
        prod_host="https://wids-nyc-reading-group-assistant.vercel.app",
    )
    assert item_key == "ITEM0001"

    mock_find.assert_called_once_with(paper_id=12, api_key="k", group_id="6540956")
    mock_item.assert_called_once()
    mock_note.assert_called_once()

    update_calls = [
        c for c in cursor.execute.call_args_list
        if "UPDATE papers" in c.args[0] and "zotero_item_key" in c.args[0]
    ]
    assert len(update_calls) == 1
    assert update_calls[0].args[1] == ("ITEM0001", 12)
    conn.commit.assert_called()


@patch("scripts.zotero_push.create_zotero_note")
@patch("scripts.zotero_push.create_zotero_item")
@patch("scripts.zotero_push.find_existing_zotero_item")
def test_push_to_zotero_skips_when_db_already_set(mock_find, mock_item, mock_note):
    """papers.zotero_item_key already populated -> skip everything, no Zotero ops."""
    conn = MagicMock()
    cursor = conn.cursor.return_value.__enter__.return_value
    cursor.fetchone.return_value = ("https://x", "EXISTING1")

    item_key = push_to_zotero(
        conn, paper_id=1, meeting_id=1,
        api_key="k", group_id="6540956",
        prod_host="https://x.example",
    )
    assert item_key == "EXISTING1"
    mock_find.assert_not_called()
    mock_item.assert_not_called()
    mock_note.assert_not_called()


@patch("scripts.zotero_push.create_zotero_note")
@patch("scripts.zotero_push.create_zotero_item")
@patch("scripts.zotero_push.find_existing_zotero_item")
def test_push_to_zotero_recovers_from_partial_crash(mock_find, mock_item, mock_note):
    """DB column null but Zotero correlator-query finds an existing item -> heal the DB, skip create."""
    mock_find.return_value = "RECOVERED"

    conn = MagicMock()
    cursor = conn.cursor.return_value.__enter__.return_value
    cursor.fetchone.side_effect = [
        ("https://arxiv.org/abs/x", None),
    ]

    item_key = push_to_zotero(
        conn, paper_id=5, meeting_id=1,
        api_key="k", group_id="6540956",
        prod_host="https://x.example",
    )
    assert item_key == "RECOVERED"
    mock_find.assert_called_once()
    mock_item.assert_not_called()
    mock_note.assert_not_called()
    update_calls = [
        c for c in cursor.execute.call_args_list
        if "UPDATE papers" in c.args[0] and "zotero_item_key" in c.args[0]
    ]
    assert len(update_calls) == 1
    assert update_calls[0].args[1] == ("RECOVERED", 5)
    conn.commit.assert_called()


# ---------------------------------------------------------------------------
# Task 15 – record_failure
# ---------------------------------------------------------------------------

from scripts.zotero_push import record_failure


def test_record_failure_inserts_command_log_row():
    conn = MagicMock()
    cursor = conn.cursor.return_value.__enter__.return_value
    record_failure(conn, name="/wids-make-companion:zotero-push", error="boom")

    insert = next(
        c for c in cursor.execute.call_args_list
        if "INSERT INTO command_log" in c.args[0]
    )
    sql, params = insert.args
    assert "slash_command" in sql
    assert "failure" in sql
    assert params == ("/wids-make-companion:zotero-push", "boom")
    conn.commit.assert_called()


# ---------------------------------------------------------------------------
# Task 16 – _parse_env_file + main CLI
# ---------------------------------------------------------------------------

import os
from unittest.mock import patch

from scripts.zotero_push import _parse_env_file, main


def test_parse_env_file_simple(tmp_path):
    env = tmp_path / ".env.local"
    env.write_text(
        "# comment\n"
        "ZOTERO_API_KEY=abc123\n"
        'ZOTERO_GROUP_ID="6540956"\n'
        "WIDS_PROD_HOST='https://x.example'\n"
        "\n"
        "EMPTY=\n"
    )
    parsed = _parse_env_file(env)
    assert parsed == {
        "ZOTERO_API_KEY": "abc123",
        "ZOTERO_GROUP_ID": "6540956",
        "WIDS_PROD_HOST": "https://x.example",
        "EMPTY": "",
    }


def test_main_returns_zero_on_success():
    """main() returns 0 when push_to_zotero completes."""
    with patch("scripts.zotero_push.psycopg.connect") as connect, \
         patch("scripts.zotero_push.push_to_zotero") as push, \
         patch.dict(os.environ, {
             "SUPABASE_DB_URL": "postgresql://x",
             "ZOTERO_API_KEY": "k",
             "ZOTERO_GROUP_ID": "6540956",
             "WIDS_PROD_HOST": "https://x",
         }, clear=False):
        push.return_value = "ITEM0001"
        rc = main(argv=["--paper-id=1", "--meeting-id=2"])
    assert rc == 0
    push.assert_called_once()


def test_main_returns_one_and_records_failure_on_exception():
    """A push exception -> rc=1, command_log row written, no traceback to caller."""
    with patch("scripts.zotero_push.psycopg.connect") as connect, \
         patch("scripts.zotero_push.push_to_zotero", side_effect=RuntimeError("boom")), \
         patch("scripts.zotero_push.record_failure") as rec, \
         patch.dict(os.environ, {
             "SUPABASE_DB_URL": "postgresql://x",
             "ZOTERO_API_KEY": "k",
             "ZOTERO_GROUP_ID": "6540956",
             "WIDS_PROD_HOST": "https://x",
         }, clear=False):
        rc = main(argv=["--paper-id=1", "--meeting-id=2"])
    assert rc == 1
    rec.assert_called_once()
    args, kwargs = rec.call_args
    assert kwargs["name"] == "/wids-make-companion:zotero-push"
    assert "boom" in kwargs["error"]


def test_main_help_exits_zero(capsys):
    with pytest.raises(SystemExit) as exc:
        main(argv=["--help"])
    assert exc.value.code == 0
    out = capsys.readouterr().out
    assert "--paper-id" in out
    assert "--meeting-id" in out
