#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = ["psycopg[binary]>=3.2"]
# ///
"""Pilot-test helpers for phase 9.2.

Three subcommands:
  flip-rsvp    — transition meeting #6 prep → scheduled (idempotent)
  revert-rsvp  — transition meeting #6 scheduled → prep, clear attendance (idempotent)
  rls          — run tests/rls.sql via psql against $SUPABASE_DB_URL

Run via: uv run scripts/pilot_cli.py <subcommand>
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

import psycopg


REPO_ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = REPO_ROOT / "web" / ".env.local"


@dataclass
class Env:
    db_url: str
    meeting_id: int = 6


def _read_env_file(path: Path) -> dict[str, str]:
    """Parse a simple KEY=VALUE .env file. Ignores comments and blank lines.
    Does not handle quoted multiline values (none expected in web/.env.local).
    """
    if not path.exists():
        return {}
    out: dict[str, str] = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key, _, value = line.partition("=")
        value = value.strip().strip("'").strip('"')
        out[key.strip()] = value
    return out


def load_env() -> Env:
    """Resolve env. Process env wins over web/.env.local."""
    file_env = _read_env_file(ENV_FILE)
    merged = {**file_env, **os.environ}

    db_url = merged.get("SUPABASE_DB_URL") or merged.get("DATABASE_URL", "")
    if not db_url and not (merged.get("PGHOST") and merged.get("PGDATABASE")):
        print(
            "error: SUPABASE_DB_URL not set (and no PGHOST/PGDATABASE fallback). "
            f"Add it to {ENV_FILE} or export it in your shell.",
            file=sys.stderr,
        )
        sys.exit(2)

    meeting_id = int(merged.get("PILOT_MEETING_ID", "6"))
    return Env(db_url=db_url, meeting_id=meeting_id)


def _connect(env: Env) -> psycopg.Connection:
    if env.db_url:
        return psycopg.connect(env.db_url)
    return psycopg.connect()


def cmd_flip_rsvp(env: Env) -> int:
    with _connect(env) as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT type, status, scheduled_at FROM meetings WHERE id = %s",
            (env.meeting_id,),
        )
        row = cur.fetchone()
        if row is None:
            print(f"error: meeting #{env.meeting_id} not found", file=sys.stderr)
            return 1
        meeting_type, status, scheduled_at = row
        if meeting_type != "reading_group":
            print(
                f"error: meeting #{env.meeting_id} is not a reading_group meeting "
                f"(type={meeting_type!r}); aborting",
                file=sys.stderr,
            )
            return 1
        if status == "scheduled":
            print(
                f"meeting #{env.meeting_id} already scheduled "
                f"(scheduled_at={scheduled_at}); no-op"
            )
            return 0
        if status != "prep":
            print(
                f"error: meeting #{env.meeting_id} has unexpected status={status!r} "
                f"(expected 'prep' or 'scheduled' for pilot test); aborting",
                file=sys.stderr,
            )
            return 1
        cur.execute(
            "UPDATE meetings SET status='scheduled', "
            "scheduled_at = now() + interval '1 hour' WHERE id = %s "
            "RETURNING scheduled_at",
            (env.meeting_id,),
        )
        row = cur.fetchone()
        assert row is not None  # RETURNING after a successful UPDATE yields one row
        new_scheduled_at = row[0]
        conn.commit()
        print(
            f"meeting #{env.meeting_id} flipped prep → scheduled "
            f"(scheduled_at={new_scheduled_at})"
        )
        return 0


def cmd_revert_rsvp(env: Env) -> int:
    with _connect(env) as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT status, scheduled_at FROM meetings WHERE id = %s",
            (env.meeting_id,),
        )
        row = cur.fetchone()
        if row is None:
            print(f"error: meeting #{env.meeting_id} not found", file=sys.stderr)
            return 1
        status, scheduled_at = row
        if status == "prep" and scheduled_at is None:
            print(
                f"meeting #{env.meeting_id} already at starting state "
                f"(prep, NULL); no-op"
            )
            return 0
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
        print(
            f"meeting #{env.meeting_id} reverted scheduled → prep, "
            f"cleared {cleared} attendance row(s)"
        )
        return 0


def cmd_rls(env: Env) -> int:
    rls_sql = REPO_ROOT / "tests" / "rls.sql"
    if not rls_sql.exists():
        print(f"error: {rls_sql} not found", file=sys.stderr)
        return 2
    if not env.db_url:
        print(
            "error: rls subcommand requires SUPABASE_DB_URL "
            "(PG* fallback not supported here)",
            file=sys.stderr,
        )
        return 2
    cmd = ["psql", env.db_url, "-v", "ON_ERROR_STOP=1", "-f", str(rls_sql)]
    proc = subprocess.run(cmd, check=False)
    return proc.returncode


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Pilot-test helpers for phase 9.2."
    )
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("flip-rsvp", help="flip meeting #6 prep → scheduled (idempotent)")
    sub.add_parser("revert-rsvp", help="revert meeting #6 scheduled → prep (idempotent)")
    sub.add_parser("rls", help="run tests/rls.sql via psql")
    args = parser.parse_args()

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
