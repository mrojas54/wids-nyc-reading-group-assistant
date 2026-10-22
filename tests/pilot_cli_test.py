"""Tests for scripts/pilot_cli.py — the pure decisions and the I/O around them.

The module is a live-DB operator CLI; it is imported here but never run
against a database. A fake connection records what it was asked to execute.
Run via:
    uv run pytest -c tests/pytest.ini tests/pilot_cli_test.py -v
"""
from __future__ import annotations

from pathlib import Path

import pytest

from scripts import pilot_cli as pc


class FakeCursor:
    def __init__(self, fetch_results: list, rowcount: int = 0) -> None:
        self.fetch_results = list(fetch_results)
        self.rowcount = rowcount
        self.executed: list[tuple[str, tuple]] = []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql: str, params: tuple = ()) -> None:
        self.executed.append((sql, params))

    def fetchone(self):
        return self.fetch_results.pop(0) if self.fetch_results else None


class FakeConn:
    def __init__(self, cursor: FakeCursor) -> None:
        self._cursor = cursor
        self.commits = 0

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def cursor(self):
        return self._cursor

    def commit(self) -> None:
        self.commits += 1


ENV = pc.Env(db_url="postgresql://x", meeting_id=6)


# ── resolve_env ──────────────────────────────────────────────────────────────


def test_resolve_env_prefers_supabase_url_then_database_url():
    assert pc.resolve_env({"SUPABASE_DB_URL": "a", "DATABASE_URL": "b"}).db_url == "a"
    assert pc.resolve_env({"DATABASE_URL": "b"}).db_url == "b"


def test_resolve_env_accepts_pg_fallback_with_empty_url():
    env = pc.resolve_env({"PGHOST": "h", "PGDATABASE": "d"})
    assert env.db_url == "" and env.meeting_id == pc.PILOT_MEETING_ID_DEFAULT


def test_resolve_env_reads_pilot_meeting_id():
    assert pc.resolve_env({"SUPABASE_DB_URL": "a", "PILOT_MEETING_ID": "41"}).meeting_id == 41
    with pytest.raises(pc.EnvError, match="PILOT_MEETING_ID"):
        pc.resolve_env({"SUPABASE_DB_URL": "a", "PILOT_MEETING_ID": "six"})


def test_resolve_env_refuses_when_nothing_names_a_database():
    with pytest.raises(pc.EnvError, match="SUPABASE_DB_URL not set"):
        pc.resolve_env({"PGHOST": "only-host"})


def test_load_env_merges_file_under_process_env(tmp_path, monkeypatch):
    env_file = tmp_path / ".env.local"
    env_file.write_text("SUPABASE_DB_URL=from-file\nPILOT_MEETING_ID=9\n")
    monkeypatch.setattr(pc, "ENV_FILE", env_file)
    monkeypatch.setenv("PILOT_MEETING_ID", "12")
    monkeypatch.delenv("SUPABASE_DB_URL", raising=False)
    env = pc.load_env()
    assert env.db_url == "from-file" and env.meeting_id == 12


def test_load_env_exits_two_with_a_message(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(pc, "ENV_FILE", tmp_path / "absent")
    for k in ("SUPABASE_DB_URL", "DATABASE_URL", "PGHOST", "PGDATABASE"):
        monkeypatch.delenv(k, raising=False)
    with pytest.raises(SystemExit) as exc:
        pc.load_env()
    assert exc.value.code == 2
    assert "SUPABASE_DB_URL not set" in capsys.readouterr().err


def test_pilot_cli_shares_the_env_parser():
    from scripts.env_file import parse_env_file
    assert pc.parse_env_file is parse_env_file


# ── decide_flip ──────────────────────────────────────────────────────────────


@pytest.mark.parametrize("row, rc, stream, apply, needle", [
    (None, 1, "err", False, "not found"),
    (("admin", "prep", None), 1, "err", False, "not a reading_group"),
    (("reading_group", "scheduled", "2026-09-10"), 0, "out", False, "already scheduled"),
    (("reading_group", "done", None), 1, "err", False, "unexpected status='done'"),
    (("reading_group", "cancelled", None), 1, "err", False, "unexpected status"),
    (("reading_group", "prep", None), 0, "out", True, "flipped prep → scheduled"),
])
def test_decide_flip(row, rc, stream, apply, needle):
    d = pc.decide_flip(row, 6)
    assert (d.rc, d.stream, d.apply) == (rc, stream, apply)
    assert needle in d.message and "#6" in d.message


def test_cmd_flip_rsvp_updates_and_commits_only_when_eligible(capsys):
    cur = FakeCursor([("reading_group", "prep", None), ("2026-09-10T18:30:00+00:00",)])
    conn = FakeConn(cur)
    assert pc.cmd_flip_rsvp(ENV, conn=conn) == 0
    sqls = [s for s, _ in cur.executed]
    assert sqls[0].startswith("SELECT type, status, scheduled_at")
    assert "UPDATE meetings SET status='scheduled'" in sqls[1]
    assert all(p == (6,) for _, p in cur.executed)
    assert conn.commits == 1
    assert "scheduled_at=2026-09-10" in capsys.readouterr().out


def test_cmd_flip_rsvp_is_a_no_op_when_already_scheduled(capsys):
    cur = FakeCursor([("reading_group", "scheduled", "x")])
    conn = FakeConn(cur)
    assert pc.cmd_flip_rsvp(ENV, conn=conn) == 0
    assert len(cur.executed) == 1 and conn.commits == 0
    assert "no-op" in capsys.readouterr().out


def test_cmd_flip_rsvp_never_mutates_the_wrong_meeting(capsys):
    cur = FakeCursor([("admin", "prep", None)])
    conn = FakeConn(cur)
    assert pc.cmd_flip_rsvp(ENV, conn=conn) == 1
    assert len(cur.executed) == 1 and conn.commits == 0
    assert "not a reading_group" in capsys.readouterr().err


# ── decide_revert ────────────────────────────────────────────────────────────


@pytest.mark.parametrize("row, rc, apply, needle", [
    (None, 1, False, "not found"),
    (("prep", None), 0, False, "already at starting state"),
    (("prep", "2026-09-10"), 0, True, "reverted"),
    (("scheduled", "2026-09-10"), 0, True, "reverted"),
])
def test_decide_revert(row, rc, apply, needle):
    d = pc.decide_revert(row, 6)
    assert (d.rc, d.apply) == (rc, apply) and needle in d.message


def test_cmd_revert_rsvp_resets_status_and_clears_attendance(capsys):
    cur = FakeCursor([("scheduled", "2026-09-10")], rowcount=3)
    conn = FakeConn(cur)
    assert pc.cmd_revert_rsvp(ENV, conn=conn) == 0
    sqls = [s for s, _ in cur.executed]
    assert "UPDATE meetings SET status='prep', scheduled_at=NULL" in sqls[1]
    assert "DELETE FROM meeting_attendance" in sqls[2]
    assert conn.commits == 1
    assert "cleared 3 attendance row(s)" in capsys.readouterr().out


def test_cmd_revert_rsvp_no_op_touches_nothing(capsys):
    cur = FakeCursor([("prep", None)])
    conn = FakeConn(cur)
    assert pc.cmd_revert_rsvp(ENV, conn=conn) == 0
    assert len(cur.executed) == 1 and conn.commits == 0


# ── rls ──────────────────────────────────────────────────────────────────────


def test_rls_command_shape(tmp_path):
    sql = tmp_path / "rls.sql"
    sql.write_text("select 1;")
    cmd = pc.rls_command(ENV, sql)
    assert cmd == ["psql", "postgresql://x", "-v", "ON_ERROR_STOP=1", "-f", str(sql)]


def test_rls_command_refuses_missing_file_or_pg_fallback(tmp_path):
    with pytest.raises(pc.EnvError, match="not found"):
        pc.rls_command(ENV, tmp_path / "missing.sql")
    sql = tmp_path / "rls.sql"
    sql.write_text("select 1;")
    with pytest.raises(pc.EnvError, match="requires SUPABASE_DB_URL"):
        pc.rls_command(pc.Env(db_url=""), sql)


def test_cmd_rls_runs_psql_against_the_repo_file(monkeypatch):
    calls = []

    class Proc:
        returncode = 0

    monkeypatch.setattr(pc.subprocess, "run", lambda cmd, check: calls.append(cmd) or Proc())
    assert pc.cmd_rls(ENV) == 0
    assert calls[0][0] == "psql" and calls[0][-1].endswith(str(Path("tests") / "rls.sql"))


def test_cli_help_lists_the_three_subcommands(capsys):
    with pytest.raises(SystemExit) as exc:
        pc.main(["--help"])
    assert exc.value.code == 0
    out = capsys.readouterr().out
    for name in ("flip-rsvp", "revert-rsvp", "rls"):
        assert name in out
