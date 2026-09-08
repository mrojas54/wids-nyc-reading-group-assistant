#!/usr/bin/env python3
# /// script
# requires-python = ">=3.13"
# dependencies = ["psycopg[binary]>=3.2"]
# ///
"""Pilot-test helpers for phase 9.2.

Three subcommands:
  flip-rsvp    — transition meeting #6 prep → scheduled (idempotent)
  revert-rsvp  — transition meeting #6 scheduled → prep, clear attendance (idempotent)
  rls          — run tests/rls.sql via psql against $SUPABASE_DB_URL

Run via: uv run scripts/pilot_cli.py <subcommand>

Structure: every decision (is this meeting eligible, is this a no-op, what
to print, what exit code) is a pure function of the row that was read —
``decide_flip`` / ``decide_revert`` / ``resolve_env`` — and the ``cmd_*``
functions only do the I/O around it. The pure halves are unit-tested in
tests/pilot_cli_test.py with a fake connection; this module itself is a
live-DB operator CLI and is never collected as a test.
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

# Invoked as `uv run scripts/pilot_cli.py`, which puts scripts/ on sys.path
# but not the repo root; the shared .env parser lives in the package.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import psycopg

from scripts.env_file import parse_env_file

REPO_ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = REPO_ROOT / "web" / ".env.local"

PILOT_MEETING_ID_DEFAULT = 6


@dataclass
class Env:
    db_url: str
    meeting_id: int = PILOT_MEETING_ID_DEFAULT


class EnvError(RuntimeError):
    """The environment cannot name a database to talk to."""


@dataclass(frozen=True)
class Decision:
    """What a command decided from the row it read.

    ``apply`` is whether the mutation should run; ``rc`` is the exit code
    when it does not (or the code to return after applying it succeeds).
    """

    rc: int
    message: str
    stream: Literal["out", "err"] = "out"
    apply: bool = False


def resolve_env(merged: Mapping[str, str]) -> Env:
    """Pure: pick the DB URL and pilot meeting id out of an already-merged
    environment (file values overridden by process values)."""
    db_url = merged.get("SUPABASE_DB_URL") or merged.get("DATABASE_URL", "")
    if not db_url and not (merged.get("PGHOST") and merged.get("PGDATABASE")):
        raise EnvError(
            "SUPABASE_DB_URL not set (and no PGHOST/PGDATABASE fallback). "
            f"Add it to {ENV_FILE} or export it in your shell."
        )
    raw = merged.get("PILOT_MEETING_ID", str(PILOT_MEETING_ID_DEFAULT))
    try:
        meeting_id = int(raw)
    except ValueError as exc:
        raise EnvError(f"PILOT_MEETING_ID must be an integer, got {raw!r}") from exc
    return Env(db_url=db_url, meeting_id=meeting_id)


def load_env() -> Env:
    """Resolve env. Process env wins over web/.env.local."""
    merged = {**parse_env_file(ENV_FILE), **os.environ}
    try:
        return resolve_env(merged)
    except EnvError as exc:
        print(f"error: {exc}", file=sys.stderr)
        sys.exit(2)


def _connect(env: Env) -> psycopg.Connection:
    if env.db_url:
        return psycopg.connect(env.db_url)
    return psycopg.connect()


def _emit(d: Decision) -> int:
    print(d.message, file=sys.stderr if d.stream == "err" else sys.stdout)
    return d.rc


# ── flip-rsvp ────────────────────────────────────────────────────────────────


def decide_flip(row: tuple[Any, ...] | None, meeting_id: int) -> Decision:
    """Pure: given ``(type, status, scheduled_at)`` for the pilot meeting (or
    ``None`` if absent), decide whether to flip it prep → scheduled."""
    if row is None:
        return Decision(1, f"error: meeting #{meeting_id} not found", "err")
    meeting_type, status, scheduled_at = row
    if meeting_type != "reading_group":
        return Decision(
            1,
            f"error: meeting #{meeting_id} is not a reading_group meeting "
            f"(type={meeting_type!r}); aborting",
            "err",
        )
    if status == "scheduled":
        return Decision(
            0, f"meeting #{meeting_id} already scheduled (scheduled_at={scheduled_at}); no-op"
        )
    if status != "prep":
        return Decision(
            1,
            f"error: meeting #{meeting_id} has unexpected status={status!r} "
            f"(expected 'prep' or 'scheduled' for pilot test); aborting",
            "err",
        )
    return Decision(0, f"meeting #{meeting_id} flipped prep → scheduled", apply=True)


def cmd_flip_rsvp(env: Env, conn: Any = None) -> int:
    with (conn or _connect(env)) as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT type, status, scheduled_at FROM meetings WHERE id = %s",
            (env.meeting_id,),
        )
        d = decide_flip(cur.fetchone(), env.meeting_id)
        if not d.apply:
            return _emit(d)
        cur.execute(
            "UPDATE meetings SET status='scheduled', "
            "scheduled_at = now() + interval '1 hour' WHERE id = %s "
            "RETURNING scheduled_at",
            (env.meeting_id,),
        )
        row = cur.fetchone()
        assert row is not None  # RETURNING after a successful UPDATE yields one row
        conn.commit()
        print(f"{d.message} (scheduled_at={row[0]})")
        return d.rc


# ── revert-rsvp ──────────────────────────────────────────────────────────────


def decide_revert(row: tuple[Any, ...] | None, meeting_id: int) -> Decision:
    """Pure: given ``(status, scheduled_at)`` for the pilot meeting (or
    ``None``), decide whether to revert it to ``(prep, NULL)``."""
    if row is None:
        return Decision(1, f"error: meeting #{meeting_id} not found", "err")
    status, scheduled_at = row
    if status == "prep" and scheduled_at is None:
        return Decision(0, f"meeting #{meeting_id} already at starting state (prep, NULL); no-op")
    return Decision(0, f"meeting #{meeting_id} reverted scheduled → prep", apply=True)


def cmd_revert_rsvp(env: Env, conn: Any = None) -> int:
    with (conn or _connect(env)) as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT status, scheduled_at FROM meetings WHERE id = %s",
            (env.meeting_id,),
        )
        d = decide_revert(cur.fetchone(), env.meeting_id)
        if not d.apply:
            return _emit(d)
        cur.execute(
            "UPDATE meetings SET status='prep', scheduled_at=NULL WHERE id = %s",
            (env.meeting_id,),
        )
        cur.execute(
            "DELETE FROM meeting_attendance WHERE meeting_id = %s",
            (env.meeting_id,),
        )
        cleared = cur.rowcount
        conn.commit()
        print(f"{d.message}, cleared {cleared} attendance row(s)")
        return d.rc


# ── rls ──────────────────────────────────────────────────────────────────────


def rls_command(env: Env, rls_sql: Path) -> list[str]:
    """Pure: the psql invocation, or an :class:`EnvError` explaining why not."""
    if not rls_sql.exists():
        raise EnvError(f"{rls_sql} not found")
    if not env.db_url:
        raise EnvError("rls subcommand requires SUPABASE_DB_URL (PG* fallback not supported here)")
    return ["psql", env.db_url, "-v", "ON_ERROR_STOP=1", "-f", str(rls_sql)]


def cmd_rls(env: Env) -> int:
    try:
        cmd = rls_command(env, REPO_ROOT / "tests" / "rls.sql")
    except EnvError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    proc = subprocess.run(cmd, check=False)
    return proc.returncode


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Pilot-test helpers for phase 9.2."
    )
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("flip-rsvp", help="flip meeting #6 prep → scheduled (idempotent)")
    sub.add_parser("revert-rsvp", help="revert meeting #6 scheduled → prep (idempotent)")
    sub.add_parser("rls", help="run tests/rls.sql via psql")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    env = load_env()
    if args.cmd == "flip-rsvp":
        return cmd_flip_rsvp(env)
    if args.cmd == "revert-rsvp":
        return cmd_revert_rsvp(env)
    if args.cmd == "rls":
        return cmd_rls(env)
    return 2


if __name__ == "__main__":
    sys.exit(main())
