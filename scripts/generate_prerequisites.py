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

from typing import Any

import psycopg

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
