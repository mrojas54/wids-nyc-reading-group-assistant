#!/usr/bin/env python3
# /// script
# requires-python = ">=3.13"
# dependencies = [
#   "psycopg[binary]>=3.2",
#   "requests>=2.31",
#   "pyzotero>=1.5",
# ]
# ///
"""Push a paper to the WiDS NYC public Zotero group library (6540956).

Invoked by /wids-make-companion after the companion artifact ships.
Idempotent via papers.zotero_item_key + a wids_paper_id correlator in
Zotero's `extra` field.

Usage:
    # single paper (invoked by /wids-make-companion):
    uv run scripts/zotero_push.py --paper-id=<id> --meeting-id=<id>

    # backfill historical readings from the enriched CSV:
    uv run scripts/zotero_push.py --from-csv=docs/superpowers/specs/wids-zotero-historical-readings.csv
    uv run scripts/zotero_push.py --from-csv=<path> --dry-run   # preview, no writes

Env (from web/.env.local):
    SUPABASE_DB_URL    Postgres connection string for the project DB.
    ZOTERO_API_KEY     Zotero API key with library-write access to group 6540956.
    ZOTERO_GROUP_ID    Numeric Zotero group ID (6540956 in prod).
    WIDS_PROD_HOST     Base URL (e.g. https://wids-nyc-reading-group-assistant.vercel.app).
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Optional
from zoneinfo import ZoneInfo

import psycopg
from psycopg import Connection
from pyzotero import Zotero

# Invoked as `uv run scripts/zotero_push.py`, which puts scripts/ on sys.path
# but not the repo root; the shared helpers live in the package.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.env_file import parse_env_file as _parse_env_file
from scripts.paper_metadata import extract_metadata


_NY_TZ = ZoneInfo("America/New_York")

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_ENV_FILE = REPO_ROOT / "web" / ".env.local"


def build_note_html(
    *,
    meeting_at: Optional[datetime],
    leader_name: Optional[str],
    topic_names: list[str],
    companion_path: Optional[str],
    prod_host: str,
) -> str:
    """Render the WiDS context note attached as a child of the Zotero item.

    Lines for missing inputs are omitted entirely (no "Leader: None").
    """
    lines = [
        "<p><strong>WiDS NYC Reading Group</strong></p>",
        "<ul>",
    ]
    if meeting_at is not None:
        meeting_local = meeting_at.astimezone(_NY_TZ)
        meeting_str = meeting_local.strftime("%A, %B %-d, %Y")
        lines.append(f"  <li><strong>Meeting:</strong> {meeting_str}</li>")
    if leader_name:
        lines.append(f"  <li><strong>Leader:</strong> {leader_name}</li>")
    if topic_names:
        joined = " / ".join(topic_names)
        lines.append(f"  <li><strong>Topic:</strong> {joined}</li>")
    if companion_path:
        full = prod_host.rstrip("/") + companion_path
        lines.append(
            f'  <li><strong>Companion:</strong> <a href="{full}">{full}</a></li>'
        )
    lines.append("</ul>")
    return "\n".join(lines)


def _split_author(name: str) -> dict[str, str]:
    """Split a 'First Last' string into Zotero's creator shape.

    Single-token names go in lastName (Zotero's convention for mononyms);
    multi-token names split on the last whitespace.
    """
    parts = name.strip().rsplit(" ", 1)
    if len(parts) == 1:
        return {"creatorType": "author", "firstName": "", "lastName": parts[0]}
    first, last = parts
    return {"creatorType": "author", "firstName": first, "lastName": last}


def _fill_item_template(
    template: dict[str, Any], meta: dict[str, Any], paper_id: int
) -> dict[str, Any]:
    """Overlay our metadata onto a pyzotero item template."""
    extra_lines = [f"wids_paper_id:{paper_id}"]
    if meta.get("arxiv_id"):
        extra_lines.append(f"arXiv:{meta['arxiv_id']}")

    item = dict(template)
    item["title"] = meta.get("title", "")
    item["creators"] = [_split_author(a) for a in meta.get("authors", []) if a]
    item["abstractNote"] = meta.get("abstract") or ""
    item["url"] = meta.get("url", "")
    item["extra"] = "\n".join(extra_lines)
    item["tags"] = [{"tag": "WiDS NYC Reading Group"}]

    if meta.get("year") is not None:
        item["date"] = str(meta["year"])

    if meta.get("doi"):
        item["DOI"] = meta["doi"]
    if meta.get("venue"):
        if meta["item_type"] == "journalArticle":
            item["publicationTitle"] = meta["venue"]
        elif meta["item_type"] == "conferencePaper":
            item["proceedingsTitle"] = meta["venue"]
        elif meta["item_type"] == "bookSection":
            item["bookTitle"] = meta["venue"]

    return item


def create_zotero_item(
    *,
    meta: dict[str, Any],
    paper_id: int,
    api_key: str,
    group_id: str,
) -> str:
    """Create a Zotero item via pyzotero; return the assigned 8-char item key.

    Raises RuntimeError if Zotero reports the item as failed.
    """
    zot = Zotero(library_id=group_id, library_type="group", api_key=api_key)
    template = zot.item_template(meta["item_type"])
    payload = [_fill_item_template(template, meta, paper_id)]

    result = zot.create_items(payload)
    if result.get("failed"):
        raise RuntimeError(f"Zotero rejected item: {result['failed']}")
    successful = result.get("successful") or {}
    if "0" not in successful:
        raise RuntimeError(f"Zotero response missing successful[0]: {result}")
    return str(successful["0"]["key"])


def create_zotero_note(
    *,
    parent_item_key: str,
    note_html: str,
    api_key: str,
    group_id: str,
) -> str:
    """Create a child note attached to `parent_item_key` via pyzotero."""
    zot = Zotero(library_id=group_id, library_type="group", api_key=api_key)
    payload = [{
        "itemType": "note",
        "parentItem": parent_item_key,
        "note": note_html,
        "tags": [],
    }]
    result = zot.create_items(payload)
    if result.get("failed"):
        raise RuntimeError(f"Zotero rejected note: {result['failed']}")
    return str(result["successful"]["0"]["key"])


def find_existing_zotero_item(
    *,
    paper_id: int,
    api_key: str,
    group_id: str,
) -> Optional[str]:
    """Return the Zotero item key of any existing item whose `extra`
    contains `wids_paper_id:<paper_id>`, else None.

    Defense-in-depth: covers the rare case where a previous run created
    a Zotero item but crashed before writing papers.zotero_item_key.
    """
    correlator = f"wids_paper_id:{paper_id}"
    zot = Zotero(library_id=group_id, library_type="group", api_key=api_key)
    items = zot.items(q=correlator, qmode="everything")
    for item in items:
        extra = (item.get("data", {}) or {}).get("extra") or ""
        if correlator in extra:
            key = item.get("key")
            if key:
                return str(key)
    return None


def _read_paper_for_push(conn: Connection, paper_id: int) -> tuple[str, Optional[str]]:
    """Return (papers.url, papers.zotero_item_key) for the given paper."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT url, zotero_item_key FROM papers WHERE id = %s",
            (paper_id,),
        )
        row = cur.fetchone()
    if row is None:
        raise ValueError(f"paper_id={paper_id} not found")
    return row[0], row[1]


def _read_meeting_context(conn: Connection, meeting_id: int) -> tuple[Optional[datetime], Optional[str], list[str], Optional[str]]:
    """Return (scheduled_at, leader_name, topic_names, companion_path)."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT
                m.scheduled_at,
                ldr.name AS leader_name,
                COALESCE(
                    array_agg(t.name ORDER BY t.name)
                        FILTER (WHERE t.name IS NOT NULL),
                    ARRAY[]::text[]
                ) AS topic_names,
                p.companion_url
            FROM meetings m
            LEFT JOIN members ldr ON ldr.id = m.leader_id
            LEFT JOIN papers p ON p.id = m.paper_id
            LEFT JOIN paper_topics pt ON pt.paper_id = p.id
            LEFT JOIN topics t ON t.id = pt.topic_id
            WHERE m.id = %s
            GROUP BY m.scheduled_at, ldr.name, p.companion_url
            """,
            (meeting_id,),
        )
        row = cur.fetchone()
    if row is None:
        raise ValueError(f"meeting_id={meeting_id} not found")
    return row


def _save_zotero_item_key(conn: Connection, *, paper_id: int, item_key: str) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE papers SET zotero_item_key = %s WHERE id = %s",
            (item_key, paper_id),
        )
    conn.commit()


def push_to_zotero(
    conn: Connection,
    *,
    paper_id: int,
    meeting_id: int,
    api_key: str,
    group_id: str,
    prod_host: str,
) -> str:
    """Idempotently push a paper to the WiDS NYC Zotero group library.

    Returns the Zotero item key (existing or newly created).
    """
    paper_url, existing_key = _read_paper_for_push(conn, paper_id)
    if existing_key:
        return existing_key

    # Defense-in-depth: a prior run might have POSTed but crashed before UPDATE.
    recovered = find_existing_zotero_item(
        paper_id=paper_id, api_key=api_key, group_id=group_id,
    )
    if recovered:
        _save_zotero_item_key(conn, paper_id=paper_id, item_key=recovered)
        return recovered

    meta = extract_metadata(conn, paper_id=paper_id, paper_url=paper_url)
    item_key = create_zotero_item(
        meta=meta,
        paper_id=paper_id,
        api_key=api_key,
        group_id=group_id,
    )
    _save_zotero_item_key(conn, paper_id=paper_id, item_key=item_key)

    scheduled_at, leader_name, topic_names, companion_path = _read_meeting_context(
        conn, meeting_id,
    )
    note_html = build_note_html(
        meeting_at=scheduled_at,
        leader_name=leader_name,
        topic_names=list(topic_names) if topic_names else [],
        companion_path=companion_path,
        prod_host=prod_host,
    )
    create_zotero_note(
        parent_item_key=item_key,
        note_html=note_html,
        api_key=api_key,
        group_id=group_id,
    )
    return item_key


# ---------------------------------------------------------------------------
# Backfill mode: import historical readings from a CSV.
#
# Historical readings pre-date the live pipeline but already have `papers`
# rows, so the backfill reuses the forward-going `wids_paper_id` correlator
# and the standard idempotency check on `papers.zotero_item_key`. The only
# difference from a normal push is the note: these meetings never had a
# companion page, so the note carries no Companion link.
# ---------------------------------------------------------------------------

_BACKFILL_COLUMNS = (
    "meeting_date", "paper_title", "paper_url", "leader_name",
    "topic_name", "paper_id",
)


def _parse_meeting_date(value: str) -> datetime:
    """Parse a bare `YYYY-MM-DD` into a New-York-local datetime.

    The CSV stores meeting dates without a time or zone. Anchoring to
    America/New_York keeps `build_note_html`'s weekday rendering stable
    regardless of the host machine's timezone.
    """
    naive = datetime.strptime(value.strip(), "%Y-%m-%d")
    return naive.replace(tzinfo=_NY_TZ)


def read_backfill_csv(path: Path) -> list[dict[str, Any]]:
    """Read the historical-readings CSV into a list of row dicts.

    Each row must carry a `paper_id` (added as a preprocessing step by
    matching titles/URLs against the `papers` table); it is parsed to int.
    """
    rows: list[dict[str, Any]] = []
    with path.open(newline="", encoding="utf-8") as fh:
        for raw in csv.DictReader(fh):
            row = {col: (raw.get(col) or "").strip() for col in _BACKFILL_COLUMNS}
            row["paper_id"] = int(row["paper_id"])
            rows.append(row)
    return rows


def push_backfill_row(
    conn: Connection,
    *,
    row: dict[str, Any],
    api_key: str,
    group_id: str,
    dry_run: bool,
) -> tuple[str, str]:
    """Push one historical-readings row to Zotero.

    Returns `(status, detail)` where status is one of:
      - "skipped"   — papers.zotero_item_key already set
      - "recovered" — found on the Zotero side via the correlator
      - "dry_run"   — metadata resolved, nothing written
      - "created"   — new item + note created
    `detail` is the relevant Zotero item key, or a metadata summary for
    dry runs.
    """
    paper_id = row["paper_id"]
    paper_url, existing_key = _read_paper_for_push(conn, paper_id)
    if existing_key:
        return "skipped", existing_key

    if dry_run:
        meta = extract_metadata(conn, paper_id=paper_id, paper_url=paper_url)
        return "dry_run", f"{meta['item_type']}: {meta.get('title', '')}"

    recovered = find_existing_zotero_item(
        paper_id=paper_id, api_key=api_key, group_id=group_id,
    )
    if recovered:
        _save_zotero_item_key(conn, paper_id=paper_id, item_key=recovered)
        return "recovered", recovered

    meta = extract_metadata(conn, paper_id=paper_id, paper_url=paper_url)
    item_key = create_zotero_item(
        meta=meta, paper_id=paper_id, api_key=api_key, group_id=group_id,
    )
    _save_zotero_item_key(conn, paper_id=paper_id, item_key=item_key)

    note_html = build_note_html(
        meeting_at=_parse_meeting_date(row["meeting_date"]),
        leader_name=row["leader_name"] or None,
        topic_names=[row["topic_name"]] if row["topic_name"] else [],
        companion_path=None,  # historical readings never had a companion page
        prod_host="",
    )
    create_zotero_note(
        parent_item_key=item_key,
        note_html=note_html,
        api_key=api_key,
        group_id=group_id,
    )
    return "created", item_key


def push_from_csv(
    conn: Connection,
    *,
    csv_path: Path,
    api_key: str,
    group_id: str,
    dry_run: bool,
) -> int:
    """Push every row of the historical-readings CSV. Returns the failure count.

    A failing row is logged and skipped; the remaining rows still run. Since
    each successful row commits its own `zotero_item_key`, a re-run after a
    partial failure resumes cleanly.
    """
    rows = read_backfill_csv(csv_path)
    mode = "DRY RUN — no writes" if dry_run else "live push"
    print(f"Zotero backfill ({mode}): {len(rows)} rows from {csv_path}")

    failures = 0
    for row in rows:
        label = f"paper {row['paper_id']} ({row['meeting_date']})"
        try:
            status, detail = push_backfill_row(
                conn, row=row, api_key=api_key, group_id=group_id, dry_run=dry_run,
            )
        except Exception as e:  # per-row boundary; keep going
            failures += 1
            print(f"  ✗ {label}: {type(e).__name__}: {e}", file=sys.stderr)
        else:
            print(f"  · {label}: {status} -> {detail}")

    pushed = len(rows) - failures
    print(f"Zotero backfill done: {pushed} ok, {failures} failed.")
    return failures


def record_failure(
    conn: Connection,
    *,
    name: str,
    error: str,
    actor: Optional[str] = None,
    duration_ms: Optional[int] = None,
    idempotency_key: Optional[str] = None,
    metadata: Optional[dict[str, object]] = None,
) -> None:
    """Write a failure row to command_log so /wids-zotero-retry knows what to fix.

    The four originally-required columns (source, name, status, error) are
    always written; ``source``/``status`` stay SQL literals so the base call
    is byte-for-byte unchanged. The enrichment columns added in migration 020
    are appended only when supplied, so callers (and existing rows) that don't
    care about them are unaffected.
    """
    columns = ["source", "name", "status", "error"]
    placeholders = ["'slash_command'", "%s", "'failure'", "%s"]
    params: list[object] = [name, error]

    if actor is not None:
        columns.append("actor")
        placeholders.append("%s")
        params.append(actor)
    if duration_ms is not None:
        columns.append("duration_ms")
        placeholders.append("%s")
        params.append(duration_ms)
    if idempotency_key is not None:
        columns.append("idempotency_key")
        placeholders.append("%s")
        params.append(idempotency_key)
    if metadata is not None:
        columns.append("metadata")
        placeholders.append("%s::jsonb")
        params.append(json.dumps(metadata))

    sql = (
        f"INSERT INTO command_log ({', '.join(columns)}) "
        f"VALUES ({', '.join(placeholders)})"
    )
    with conn.cursor() as cur:
        # sql is composed solely from hard-coded column/placeholder literals
        # (values are parameterized via `params`), so it is injection-safe even
        # though it is not a LiteralString to the type checker.
        cur.execute(sql, tuple(params))  # ty: ignore[invalid-argument-type]
    conn.commit()


def _load_env() -> dict[str, str]:
    """Merge web/.env.local into os.environ-like dict (process env wins)."""
    file_env = _parse_env_file(DEFAULT_ENV_FILE)
    merged = dict(file_env)
    merged.update({k: v for k, v in os.environ.items() if k in {
        "SUPABASE_DB_URL", "ZOTERO_API_KEY", "ZOTERO_GROUP_ID", "WIDS_PROD_HOST",
    }})
    return merged


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="zotero_push.py",
        description="Push a paper to the WiDS NYC Zotero group library (6540956).",
    )
    p.add_argument("--paper-id", type=int,
                   help="papers.id of the paper to push (single-paper mode)")
    p.add_argument("--meeting-id", type=int,
                   help="meetings.id whose context becomes the child note "
                        "(single-paper mode)")
    p.add_argument("--from-csv", metavar="PATH",
                   help="Backfill mode: push every row of a historical-readings "
                        "CSV (columns include paper_id). Mutually exclusive with "
                        "--paper-id/--meeting-id.")
    p.add_argument("--dry-run", action="store_true",
                   help="Backfill only: resolve and print metadata for each row "
                        "without writing anything to Zotero or the database.")
    return p


def _run_backfill(args: argparse.Namespace, env: dict[str, str]) -> int:
    """Backfill-mode entry point. Returns process exit code."""
    required = ["SUPABASE_DB_URL"]
    if not args.dry_run:
        required += ["ZOTERO_API_KEY", "ZOTERO_GROUP_ID"]
    for var in required:
        if not env.get(var):
            print(f"error: missing env var {var}", file=sys.stderr)
            return 2

    csv_path = Path(args.from_csv)
    if not csv_path.exists():
        print(f"error: CSV not found: {csv_path}", file=sys.stderr)
        return 2

    conn = psycopg.connect(env["SUPABASE_DB_URL"])
    try:
        failures = push_from_csv(
            conn,
            csv_path=csv_path,
            api_key=env.get("ZOTERO_API_KEY", ""),
            group_id=env.get("ZOTERO_GROUP_ID", ""),
            dry_run=args.dry_run,
        )
    finally:
        conn.close()
    return 1 if failures else 0


def main(argv: Optional[list[str]] = None) -> int:
    """CLI entry point. Returns process exit code (0 success, 1 failure, 2 config)."""
    args = _build_parser().parse_args(argv)
    env = _load_env()

    if args.from_csv:
        return _run_backfill(args, env)

    if args.paper_id is None or args.meeting_id is None:
        print("error: --paper-id and --meeting-id are required "
              "(or use --from-csv for backfill)", file=sys.stderr)
        return 2

    for required in ("SUPABASE_DB_URL", "ZOTERO_API_KEY",
                     "ZOTERO_GROUP_ID", "WIDS_PROD_HOST"):
        if not env.get(required):
            print(f"error: missing env var {required}", file=sys.stderr)
            return 2

    conn = psycopg.connect(env["SUPABASE_DB_URL"])
    try:
        try:
            item_key = push_to_zotero(
                conn,
                paper_id=args.paper_id,
                meeting_id=args.meeting_id,
                api_key=env["ZOTERO_API_KEY"],
                group_id=env["ZOTERO_GROUP_ID"],
                prod_host=env["WIDS_PROD_HOST"],
            )
        except Exception as e:  # top-level boundary
            error_msg = f"{type(e).__name__}: {e}"
            print(
                f"⚠ Zotero push failed for paper {args.paper_id}: {error_msg}\n"
                f"   Re-run with: /wids-zotero-retry {args.meeting_id}",
                file=sys.stderr,
            )
            try:
                record_failure(
                    conn,
                    name="/wids-make-companion:zotero-push",
                    error=error_msg,
                )
            except Exception as inner:  # logging boundary; the original error still returns
                print(f"   (also failed to write command_log: {inner})",
                      file=sys.stderr)
            return 1
        else:
            print(f"Zotero push: paper {args.paper_id} -> item {item_key}")
            return 0
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
