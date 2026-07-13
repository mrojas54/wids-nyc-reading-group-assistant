"""Generate the newest paper's card fields + editable prerequisites, and render
the new-paper-announcement email.

Two modes (the AI drafting happens in the agent BETWEEN them, so no Anthropic
dependency lives here):

    # 1. emit a generation contract for the newest paper:
    uv run python -m scripts.generate_prerequisites --mode gather

    # 2. after the agent drafts + persists papers.prerequisites, render the email
    #    (per-send tokens — recipient/lead/signoff/links — arrive on stdin as JSON):
    echo '{"recipient.firstName":"Maya", ...}' \\
        | uv run python -m scripts.generate_prerequisites --mode render

Env (from web/.env.local, process env wins):
    SUPABASE_DB_URL   Postgres connection string for the project DB.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import date
from pathlib import Path
from typing import Any

import psycopg

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_ENV_FILE = REPO_ROOT / "web" / ".env.local"
_ENV_LINE_RE = re.compile(r'^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$')

_PAPER_COLS = "id, title, url, abstract, authors, year, prerequisites"


def authors_short(authors: list[str]) -> str:
    """Compact author credit from surnames: 'A', 'A & B', 'A, B & C', 'A et al.'."""
    surnames = [a.strip().rsplit(" ", 1)[-1] for a in authors if a and a.strip()]
    if not surnames:
        return ""
    if len(surnames) == 1:
        return surnames[0]
    if len(surnames) == 2:
        return f"{surnames[0]} & {surnames[1]}"
    if len(surnames) == 3:
        return f"{surnames[0]}, {surnames[1]} & {surnames[2]}"
    return f"{surnames[0]} et al."


def _row_to_paper(row: tuple[Any, ...]) -> dict[str, Any]:
    keys = ("id", "title", "url", "abstract", "authors", "year", "prerequisites")
    paper = dict(zip(keys, row))
    paper["authors"] = list(paper["authors"]) if paper["authors"] else []
    return paper


def select_newest_paper(conn: psycopg.Connection) -> dict[str, Any]:
    """The paper of the most recent meeting that has one; else the newest-added
    paper. Raises LookupError when no papers exist."""
    with conn.cursor() as cur:
        cur.execute(
            f"SELECT p.{_PAPER_COLS.replace(', ', ', p.')} "
            "FROM meetings m JOIN papers p ON p.id = m.paper_id "
            "WHERE m.paper_id IS NOT NULL "
            "ORDER BY m.scheduled_at DESC NULLS LAST, m.id DESC LIMIT 1"
        )
        row = cur.fetchone()
    if row is not None:
        return _row_to_paper(row)
    with conn.cursor() as cur:
        cur.execute(f"SELECT {_PAPER_COLS} FROM papers ORDER BY added_at DESC LIMIT 1")
        row = cur.fetchone()
    if row is None:
        raise LookupError("no papers in the database")
    return _row_to_paper(row)


def build_gather_contract(paper: dict[str, Any]) -> dict[str, Any]:
    """Emit the JSON the agent uses to draft the announcement's generated fields.

    The agent reads this, drafts with Claude, and persists the result to
    papers.prerequisites (status='draft') via the Supabase MCP.
    """
    return {
        "paper_id": paper["id"],
        "title": paper["title"],
        "abstract": paper.get("abstract") or "",
        "authors": paper.get("authors") or [],
        "url": paper["url"],
        "instructions": {
            "produce": ["short_title", "summary", "lede", "items"],
            "items_count": 3,
            "guidance": (
                "short_title: a <=12-word rewrite of the title for the intro line. "
                "summary: ONE sentence (<=30 words) completing 'she'll steer the "
                "discussion on <short_title> — <summary>'. lede: one line framing "
                "the prerequisites. items: exactly 3 concrete things to review "
                "before the discussion (concepts/skills), each <=20 words. "
                "Return JSON {short_title, summary, lede, items:[3]}."
            ),
        },
    }


def build_tokens(
    paper: dict[str, Any],
    prereqs: dict[str, Any],
    per_send: dict[str, str],
    quote: dict[str, str],
) -> dict[str, str]:
    """Assemble every {{ token }} the new-paper-announcement template needs."""
    from scripts.prerequisites import prereq_tokens

    tokens: dict[str, str] = {
        "paper.title": paper["title"],
        "paper.url": paper["url"],
        "paper.shortTitle": prereqs["short_title"],
        "paper.summary": prereqs["summary"],
        "paper.authorsShort": authors_short(paper.get("authors") or []),
    }
    tokens.update(prereq_tokens(prereqs["lede"], list(prereqs["items"])))
    tokens.update(per_send)
    tokens.update(quote)
    return tokens


def render_new_paper_email(tokens: dict[str, str]) -> dict[str, str]:
    """Render the .html + .txt pair; raise ValueError if any token is unresolved."""
    from scripts.render_email_previews import TEMPLATES, render

    out: dict[str, str] = {}
    unresolved: list[str] = []
    for ext, key in (("html", "html"), ("txt", "text")):
        src = (TEMPLATES / f"new-paper-announcement.{ext}").read_text(encoding="utf-8")
        rendered, missing = render(src, tokens)
        unresolved.extend(missing)
        out[key] = rendered
    if unresolved:
        raise ValueError(f"unresolved tokens: {sorted(set(unresolved))}")
    return out


def save_prerequisites(conn: psycopg.Connection, paper_id: int, payload: dict[str, Any]) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE papers SET prerequisites = %s::jsonb WHERE id = %s",
            (json.dumps(payload), paper_id),
        )
    conn.commit()


def _parse_env_file(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.exists():
        return out
    for line in path.read_text().splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        m = _ENV_LINE_RE.match(line)
        if not m:
            continue
        key, val = m.group(1), m.group(2)
        if (val[:1], val[-1:]) in (('"', '"'), ("'", "'")):
            val = val[1:-1]
        out[key] = val
    return out


def _db_url() -> str:
    env = _parse_env_file(DEFAULT_ENV_FILE)
    url = os.environ.get("SUPABASE_DB_URL") or env.get("SUPABASE_DB_URL")
    if not url:
        raise SystemExit("error: missing env var SUPABASE_DB_URL")
    return url


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="generate_prerequisites.py")
    p.add_argument("--mode", choices=("gather", "render"), required=True)
    args = p.parse_args(argv)

    conn = psycopg.connect(_db_url())
    try:
        paper = select_newest_paper(conn)
        if args.mode == "gather":
            json.dump(build_gather_contract(paper), sys.stdout)
            return 0

        # render
        prereqs = paper.get("prerequisites")
        if not prereqs:
            print(
                f"error: papers.prerequisites is empty for paper {paper['id']}; "
                "run --mode gather and persist the agent's draft first.",
                file=sys.stderr,
            )
            return 1
        per_send = json.loads(sys.stdin.read())
        from scripts.quotes import load_bundle, quote_tokens, select_quote
        quote = quote_tokens(select_quote(load_bundle(), date.today().toordinal()))
        tokens = build_tokens(paper, prereqs, per_send, quote)
        rendered = render_new_paper_email(tokens)
        json.dump({"paper_id": paper["id"], **rendered}, sys.stdout)
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
