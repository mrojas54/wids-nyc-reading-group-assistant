"""Tests for scripts/zotero_push.py.

Run via:
    uv run --with pytest --with responses --with "psycopg[binary]" --with pyzotero \\
        pytest tests/zotero_push_test.py -v
"""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

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

from scripts.zotero_push import _parse_meeting_date, build_note_html, read_backfill_csv


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
