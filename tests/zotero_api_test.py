"""Tests for scripts/zotero_api.py: Zotero item and note payloads and the pyzotero calls."""
from __future__ import annotations

import pytest


# ---------------------------------------------------------------------------
# Task 10: build_note_html
# ---------------------------------------------------------------------------

from datetime import datetime, timezone

from scripts.zotero_api import build_note_html


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

from scripts.zotero_api import create_zotero_item


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


@patch("scripts.zotero_api.Zotero")
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


@patch("scripts.zotero_api.Zotero")
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


@patch("scripts.zotero_api.Zotero")
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

from scripts.zotero_api import create_zotero_note


@patch("scripts.zotero_api.Zotero")
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


@patch("scripts.zotero_api.Zotero")
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


from scripts.zotero_api import find_existing_zotero_item


@patch("scripts.zotero_api.Zotero")
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


@patch("scripts.zotero_api.Zotero")
def test_find_existing_zotero_item_no_match(mock_zotero_cls):
    mock_zot = mock_zotero_cls.return_value
    mock_zot.items.return_value = [
        {"key": "OTHER567", "data": {"extra": "wids_paper_id:9999"}},
    ]
    assert find_existing_zotero_item(paper_id=42, api_key="k", group_id="6540956") is None


@patch("scripts.zotero_api.Zotero")
def test_find_existing_zotero_item_empty_results(mock_zotero_cls):
    mock_zot = mock_zotero_cls.return_value
    mock_zot.items.return_value = []
    assert find_existing_zotero_item(paper_id=42, api_key="k", group_id="6540956") is None
