"""Tests for scripts/zotero_push.py.

Run via:
    uv run --with pytest --with responses --with "psycopg[binary]" --with pyzotero \\
        pytest tests/zotero_push_test.py -v
"""
from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock

import pytest
import responses

ARXIV_ATOM_FIXTURE = (
    Path(__file__).parent / "fixtures" / "arxiv_atom_2405.02411.xml"
).read_text()


def test_module_imports():
    """Smoke test: the script's main entry is importable."""
    from scripts.zotero_push import main
    assert callable(main)


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


def test_record_failure_omits_enrichment_columns_when_absent():
    """No optional kwargs -> the INSERT names only the original four columns."""
    conn = MagicMock()
    cursor = conn.cursor.return_value.__enter__.return_value
    record_failure(conn, name="/wids-make-companion:zotero-push", error="boom")

    sql = next(
        c.args[0] for c in cursor.execute.call_args_list
        if "INSERT INTO command_log" in c.args[0]
    )
    for col in ("actor", "duration_ms", "idempotency_key", "metadata"):
        assert col not in sql


def test_record_failure_includes_enrichment_columns_when_given():
    """Optional kwargs land in the INSERT as named columns + bound params."""
    import json as _json

    conn = MagicMock()
    cursor = conn.cursor.return_value.__enter__.return_value
    record_failure(
        conn,
        name="/wids-make-companion:zotero-push",
        error="boom",
        actor="cron:zotero-retry",
        duration_ms=1234,
        idempotency_key="zotero-push:paper=1",
        metadata={"paper_id": 1, "meeting_id": 2},
    )

    sql, params = next(
        c.args for c in cursor.execute.call_args_list
        if "INSERT INTO command_log" in c.args[0]
    )
    for col in ("actor", "duration_ms", "idempotency_key", "metadata"):
        assert col in sql
    assert "cron:zotero-retry" in params
    assert 1234 in params
    assert "zotero-push:paper=1" in params
    assert _json.dumps({"paper_id": 1, "meeting_id": 2}) in params
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
    with patch("scripts.zotero_push.psycopg.connect"), \
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
    with patch("scripts.zotero_push.psycopg.connect"), \
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


def test_main_returns_two_on_missing_env(capsys):
    """Missing required env var -> rc=2 with stderr message."""
    with patch.dict(os.environ, {
        "SUPABASE_DB_URL": "",
        "ZOTERO_API_KEY": "k",
        "ZOTERO_GROUP_ID": "6540956",
        "WIDS_PROD_HOST": "https://x",
    }, clear=True):
        # Also need to ensure web/.env.local doesn't supply the missing var.
        # The test's clear=True wipes os.environ; the file may still set it.
        # Patch the loader to return only what's in os.environ.
        with patch("scripts.zotero_push._parse_env_file", return_value={}):
            rc = main(argv=["--paper-id=1", "--meeting-id=2"])
    assert rc == 2
    err = capsys.readouterr().err
    assert "missing env var SUPABASE_DB_URL" in err


def test_main_help_exits_zero(capsys):
    with pytest.raises(SystemExit) as exc:
        main(argv=["--help"])
    assert exc.value.code == 0
    out = capsys.readouterr().out
    assert "--paper-id" in out
    assert "--meeting-id" in out
    assert "--from-csv" in out


# ---------------------------------------------------------------------------
# Backfill: CSV historical-readings import
# ---------------------------------------------------------------------------

from scripts.zotero_push import _parse_meeting_date, read_backfill_csv


def test_parse_meeting_date_is_ny_tz():
    """A bare YYYY-MM-DD becomes a New-York-local datetime so weekday
    formatting in build_note_html is stable regardless of host timezone."""
    dt = _parse_meeting_date("2024-11-05")
    assert (dt.year, dt.month, dt.day) == (2024, 11, 5)
    # 2024-11-05 is a Tuesday; build_note_html renders the weekday.
    html = build_note_html(
        meeting_at=dt, leader_name=None, topic_names=[],
        companion_path=None, prod_host="",
    )
    assert "Tuesday, November 5, 2024" in html


_BACKFILL_CSV = (
    "meeting_date,paper_title,paper_url,leader_name,topic_name,paper_id,_notes\n"
    "2024-11-05,The Call,https://arxiv.org/abs/2405.02411,Niki Karanikola,"
    'NLP / AI Ethics,7,"some, quoted note"\n'
    "2026-03-12,Poisoning Attacks,https://arxiv.org/abs/2510.07192,Michelle Rojas,"
    'LLM Security,6,"another note"\n'
)


def test_read_backfill_csv_parses_rows(tmp_path):
    csv_file = tmp_path / "hist.csv"
    csv_file.write_text(_BACKFILL_CSV)
    rows = read_backfill_csv(csv_file)
    assert len(rows) == 2
    first = rows[0]
    assert first["paper_id"] == 7
    assert isinstance(first["paper_id"], int)
    assert first["meeting_date"] == "2024-11-05"
    assert first["paper_url"] == "https://arxiv.org/abs/2405.02411"
    assert first["leader_name"] == "Niki Karanikola"
    assert first["topic_name"] == "NLP / AI Ethics"
    assert rows[1]["paper_id"] == 6


from scripts.zotero_push import push_backfill_row, push_from_csv


def _backfill_row(paper_id=7):
    return {
        "paper_id": paper_id,
        "meeting_date": "2024-11-05",
        "paper_title": "The Call",
        "paper_url": "https://arxiv.org/abs/2405.02411",
        "leader_name": "Niki Karanikola",
        "topic_name": "NLP / AI Ethics",
    }


@patch("scripts.zotero_push.create_zotero_note")
@patch("scripts.zotero_push.create_zotero_item")
@patch("scripts.zotero_push.find_existing_zotero_item")
def test_push_backfill_row_skips_when_zotero_key_set(mock_find, mock_item, mock_note):
    """A row whose paper already has zotero_item_key is skipped untouched."""
    conn = MagicMock()
    cursor = conn.cursor.return_value.__enter__.return_value
    cursor.fetchone.return_value = ("https://arxiv.org/abs/x", "EXISTING1")

    status, detail = push_backfill_row(
        conn, row=_backfill_row(6), api_key="k", group_id="6540956", dry_run=False,
    )
    assert status == "skipped"
    assert detail == "EXISTING1"
    mock_find.assert_not_called()
    mock_item.assert_not_called()
    mock_note.assert_not_called()


@patch("scripts.zotero_push.create_zotero_note")
@patch("scripts.zotero_push.create_zotero_item")
@patch("scripts.zotero_push.find_existing_zotero_item")
@responses.activate
def test_push_backfill_row_dry_run_makes_no_writes(mock_find, mock_item, mock_note):
    """dry_run resolves metadata but never touches Zotero or writes the DB."""
    responses.add(
        responses.GET, "https://export.arxiv.org/api/query",
        body=ARXIV_ATOM_FIXTURE, status=200,
    )
    conn = MagicMock()
    cursor = conn.cursor.return_value.__enter__.return_value
    cursor.fetchone.return_value = ("https://arxiv.org/abs/2405.02411", None)

    status, detail = push_backfill_row(
        conn, row=_backfill_row(7), api_key="k", group_id="6540956", dry_run=True,
    )
    assert status == "dry_run"
    assert "The Call for Socially Aware Language Technologies" in detail
    mock_find.assert_not_called()
    mock_item.assert_not_called()
    mock_note.assert_not_called()
    conn.commit.assert_not_called()


@patch("scripts.zotero_push.create_zotero_note")
@patch("scripts.zotero_push.create_zotero_item")
@patch("scripts.zotero_push.find_existing_zotero_item")
@responses.activate
def test_push_backfill_row_creates_item_and_companion_free_note(
    mock_find, mock_item, mock_note,
):
    responses.add(
        responses.GET, "https://export.arxiv.org/api/query",
        body=ARXIV_ATOM_FIXTURE, status=200,
    )
    mock_find.return_value = None
    mock_item.return_value = "ITEM0007"
    mock_note.return_value = "NOTE0007"

    conn = MagicMock()
    cursor = conn.cursor.return_value.__enter__.return_value
    cursor.fetchone.return_value = ("https://arxiv.org/abs/2405.02411", None)

    status, detail = push_backfill_row(
        conn, row=_backfill_row(7), api_key="k", group_id="6540956", dry_run=False,
    )
    assert status == "created"
    assert detail == "ITEM0007"

    # paper_id correlator is reused — same as forward-going pushes.
    assert mock_item.call_args.kwargs["paper_id"] == 7

    # The note carries meeting/leader/topic but NO companion link.
    note_html = mock_note.call_args.kwargs["note_html"]
    assert "Tuesday, November 5, 2024" in note_html
    assert "Niki Karanikola" in note_html
    assert "NLP / AI Ethics" in note_html
    assert "Companion" not in note_html

    update_calls = [
        c for c in cursor.execute.call_args_list
        if "UPDATE papers" in c.args[0] and "zotero_item_key" in c.args[0]
    ]
    assert len(update_calls) == 1
    assert update_calls[0].args[1] == ("ITEM0007", 7)


@patch("scripts.zotero_push.push_backfill_row")
def test_push_from_csv_iterates_all_rows(mock_row, tmp_path):
    csv_file = tmp_path / "hist.csv"
    csv_file.write_text(_BACKFILL_CSV)
    mock_row.side_effect = [("created", "I1"), ("skipped", "I2")]

    failures = push_from_csv(
        MagicMock(), csv_path=csv_file,
        api_key="k", group_id="6540956", dry_run=False,
    )
    assert failures == 0
    assert mock_row.call_count == 2


@patch("scripts.zotero_push.push_backfill_row")
def test_push_from_csv_counts_failures_and_continues(mock_row, tmp_path):
    """One bad row does not abort the rest; failures are counted."""
    csv_file = tmp_path / "hist.csv"
    csv_file.write_text(_BACKFILL_CSV)
    mock_row.side_effect = [RuntimeError("boom"), ("created", "I2")]

    failures = push_from_csv(
        MagicMock(), csv_path=csv_file,
        api_key="k", group_id="6540956", dry_run=False,
    )
    assert failures == 1
    assert mock_row.call_count == 2


def test_main_from_csv_dry_run_returns_zero(tmp_path):
    csv_file = tmp_path / "hist.csv"
    csv_file.write_text(_BACKFILL_CSV)
    with patch("scripts.zotero_push.psycopg.connect"), \
         patch("scripts.zotero_push.push_from_csv", return_value=0) as push, \
         patch("scripts.zotero_push._parse_env_file", return_value={}), \
         patch.dict(os.environ, {"SUPABASE_DB_URL": "postgresql://x"}, clear=True):
        rc = main(argv=[f"--from-csv={csv_file}", "--dry-run"])
    assert rc == 0
    assert push.call_args.kwargs["dry_run"] is True


def test_main_from_csv_returns_one_when_rows_fail(tmp_path):
    csv_file = tmp_path / "hist.csv"
    csv_file.write_text(_BACKFILL_CSV)
    with patch("scripts.zotero_push.psycopg.connect"), \
         patch("scripts.zotero_push.push_from_csv", return_value=2), \
         patch("scripts.zotero_push._parse_env_file", return_value={}), \
         patch.dict(os.environ, {
             "SUPABASE_DB_URL": "postgresql://x",
             "ZOTERO_API_KEY": "k",
             "ZOTERO_GROUP_ID": "6540956",
         }, clear=True):
        rc = main(argv=[f"--from-csv={csv_file}"])
    assert rc == 1


def test_main_from_csv_missing_zotero_env_returns_two(tmp_path, capsys):
    """Non-dry-run backfill requires Zotero creds."""
    csv_file = tmp_path / "hist.csv"
    csv_file.write_text(_BACKFILL_CSV)
    with patch("scripts.zotero_push._parse_env_file", return_value={}), \
         patch.dict(os.environ, {"SUPABASE_DB_URL": "postgresql://x"}, clear=True):
        rc = main(argv=[f"--from-csv={csv_file}"])
    assert rc == 2
    assert "ZOTERO_API_KEY" in capsys.readouterr().err
