#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
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
import os
import re
import sys
import xml.etree.ElementTree as ET
from datetime import datetime
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse, urlunparse
from zoneinfo import ZoneInfo

import psycopg
from psycopg import Connection
import requests
from pyzotero import Zotero


_ARXIV_PDF_RE = re.compile(r"^/pdf/(.+?)(?:\.pdf)?$")
_NY_TZ = ZoneInfo("America/New_York")

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_ENV_FILE = REPO_ROOT / "web" / ".env.local"

_ENV_LINE_RE = re.compile(r'^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$')


def normalize_url(url: str) -> str:
    """Canonicalize paper URLs for source classification and idempotency.

    - http -> https; lowercase host
    - arxiv.org/pdf/<id>(.pdf)? -> arxiv.org/abs/<id>
    - drop query string on arxiv.org URLs and on `?needAccess=` params
    - leave fragments off
    """
    parsed = urlparse(url.strip())
    scheme = "https" if parsed.scheme in ("http", "https") else parsed.scheme
    host = parsed.netloc.lower()
    path = parsed.path
    query = parsed.query

    if host == "arxiv.org":
        m = _ARXIV_PDF_RE.match(path)
        if m:
            path = f"/abs/{m.group(1)}"
        query = ""  # always drop query on arxiv

    if "needaccess" in query.lower():
        # tandfonline-style epdf links — drop the param
        query = ""

    return urlunparse((scheme, host, path, "", query, ""))


_DOI_IN_URL_RE = re.compile(r"/(10\.\d{4,9}/[^?#]+)")

_CITATION_DOI_RE = re.compile(
    rb'<meta\s+name=["\']citation_doi["\']\s+content=["\']([^"\']+)["\']',
    re.IGNORECASE,
)

_ARXIV_API_URL = "https://export.arxiv.org/api/query"
_ARXIV_NS = {"atom": "http://www.w3.org/2005/Atom"}


def classify_url(url: str) -> str:
    """Decide which extractor to use.

    Returns one of: "arxiv", "doi_in_url", "needs_meta_lookup".
    "needs_meta_lookup" means: try to find a citation_doi <meta> tag by
    fetching the page; if that fails, fall back to DB metadata.
    """
    parsed = urlparse(url)
    if parsed.netloc == "arxiv.org":
        return "arxiv"
    if _DOI_IN_URL_RE.search(parsed.path):
        return "doi_in_url"
    return "needs_meta_lookup"


def _arxiv_id_from_url(url: str) -> str:
    """Extract the arXiv id from a normalized abs URL."""
    parsed = urlparse(url)
    # path is "/abs/<id>" or "/abs/<category>/<id>"
    return parsed.path[len("/abs/"):]


def extract_arxiv_metadata(url: str) -> Optional[dict]:
    """Fetch metadata from the arXiv API for a normalized abs URL.

    Returns None if the API returns no entry (404-equivalent).
    """
    arxiv_id = _arxiv_id_from_url(url)
    resp = requests.get(
        _ARXIV_API_URL,
        params={"id_list": arxiv_id},
        timeout=10,
    )
    resp.raise_for_status()
    root = ET.fromstring(resp.text)
    entry = root.find("atom:entry", _ARXIV_NS)
    if entry is None:
        return None

    title_el = entry.find("atom:title", _ARXIV_NS)
    summary_el = entry.find("atom:summary", _ARXIV_NS)
    published_el = entry.find("atom:published", _ARXIV_NS)
    authors = [
        (a.find("atom:name", _ARXIV_NS).text or "").strip()
        for a in entry.findall("atom:author", _ARXIV_NS)
    ]
    year = None
    if published_el is not None and published_el.text:
        year = int(published_el.text[:4])

    return {
        "item_type": "preprint",
        "title": (title_el.text or "").strip() if title_el is not None else "",
        "authors": authors,
        "abstract": (summary_el.text or "").strip() if summary_el is not None else "",
        "year": year,
        "arxiv_id": arxiv_id,
        "url": url,
    }


def extract_doi_from_url(url: str) -> Optional[str]:
    """Find a DOI literal embedded in the URL path."""
    parsed = urlparse(url)
    if parsed.netloc == "arxiv.org":
        return None  # arXiv URLs sometimes contain unrelated number patterns
    m = _DOI_IN_URL_RE.search(parsed.path)
    return m.group(1) if m else None


def extract_doi_from_meta_tag(url: str) -> Optional[str]:
    """Fetch the page and read the Highwire-Press <meta name="citation_doi"> tag.

    Returns None on timeout, non-200, non-HTML content, or no matching tag.
    """
    try:
        resp = requests.get(url, timeout=5, allow_redirects=True)
    except requests.RequestException:
        return None
    if resp.status_code != 200:
        return None
    content_type = resp.headers.get("Content-Type", "").lower()
    if "html" not in content_type:
        return None
    m = _CITATION_DOI_RE.search(resp.content)
    return m.group(1).decode("utf-8") if m else None


_CROSSREF_API_URL = "https://api.crossref.org/works/"

_CROSSREF_TYPE_TO_ZOTERO = {
    "journal-article": "journalArticle",
    "proceedings-article": "conferencePaper",
    "book-chapter": "bookSection",
    "book": "book",
    "report": "report",
    "posted-content": "preprint",
}

_JATS_TAG_RE = re.compile(r"<[^>]+>")


def _strip_jats(text: str) -> str:
    """CrossRef abstracts are JATS XML; strip tags down to plain text."""
    return _JATS_TAG_RE.sub("", text).strip()


def extract_crossref_metadata(doi: str, *, paper_url: str) -> Optional[dict]:
    """Fetch metadata from CrossRef for a DOI.

    `paper_url` is the original URL we got from papers.url; we keep it as the
    canonical link in the Zotero item rather than swapping in CrossRef's
    doi.org URL — humans browsing the bibliography expect the publisher link.
    """
    resp = requests.get(_CROSSREF_API_URL + doi, timeout=10)
    if resp.status_code == 404:
        return None
    resp.raise_for_status()
    msg = resp.json().get("message", {})

    title_list = msg.get("title") or []
    title = title_list[0].strip() if title_list else ""

    authors = []
    for a in msg.get("author") or []:
        given = (a.get("given") or "").strip()
        family = (a.get("family") or "").strip()
        full = (given + " " + family).strip()
        if full:
            authors.append(full)

    abstract_raw = msg.get("abstract") or ""
    abstract = _strip_jats(abstract_raw) if abstract_raw else ""

    container = msg.get("container-title") or []
    venue = container[0] if container else None

    year = None
    issued = msg.get("issued") or {}
    parts = issued.get("date-parts") or []
    if parts and parts[0]:
        year = int(parts[0][0])

    crossref_type = msg.get("type", "")
    item_type = _CROSSREF_TYPE_TO_ZOTERO.get(crossref_type, "webpage")

    canonical_doi = msg.get("DOI") or doi

    return {
        "item_type": item_type,
        "title": title,
        "authors": authors,
        "abstract": abstract,
        "venue": venue,
        "year": year,
        "doi": canonical_doi,
        "url": paper_url,
    }


def extract_db_fallback_metadata(conn: Connection, *, paper_id: int) -> dict:
    """Read metadata for the given paper directly from `papers`.

    Always returns a dict (raises ValueError if the row is missing). Used
    when no remote source (arXiv/CrossRef/citation_doi) yields metadata.
    """
    with conn.cursor() as cur:
        cur.execute(
            "SELECT title, url, abstract, authors, venue, year "
            "FROM papers WHERE id = %s",
            (paper_id,),
        )
        row = cur.fetchone()
    if row is None:
        raise ValueError(f"paper_id={paper_id} not found in papers")
    title, url, abstract, authors, venue, year = row
    return {
        "item_type": "webpage",
        "title": title,
        "authors": list(authors) if authors else [],
        "abstract": abstract or "",
        "venue": venue,
        "year": year,
        "url": url,
    }


def extract_metadata(conn: Connection, *, paper_id: int, paper_url: str) -> dict:
    """Top-level metadata extractor.

    Order: normalize URL -> classify -> try the matching remote source ->
    fall back to DB if remote yields nothing.
    """
    url = normalize_url(paper_url)
    source = classify_url(url)

    if source == "arxiv":
        meta = extract_arxiv_metadata(url)
        if meta is not None:
            return meta

    elif source == "doi_in_url":
        doi = extract_doi_from_url(url)
        if doi is not None:
            meta = extract_crossref_metadata(doi, paper_url=url)
            if meta is not None:
                return meta

    elif source == "needs_meta_lookup":
        doi = extract_doi_from_meta_tag(url)
        if doi is not None:
            meta = extract_crossref_metadata(doi, paper_url=url)
            if meta is not None:
                return meta

    return extract_db_fallback_metadata(conn, paper_id=paper_id)


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


def _split_author(name: str) -> dict:
    """Split a 'First Last' string into Zotero's creator shape.

    Single-token names go in lastName (Zotero's convention for mononyms);
    multi-token names split on the last whitespace.
    """
    parts = name.strip().rsplit(" ", 1)
    if len(parts) == 1:
        return {"creatorType": "author", "firstName": "", "lastName": parts[0]}
    first, last = parts
    return {"creatorType": "author", "firstName": first, "lastName": last}


def _fill_item_template(template: dict, meta: dict, paper_id: int) -> dict:
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
    meta: dict,
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
    return successful["0"]["key"]


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
    return result["successful"]["0"]["key"]


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
                return key
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


def read_backfill_csv(path: Path) -> list[dict]:
    """Read the historical-readings CSV into a list of row dicts.

    Each row must carry a `paper_id` (added as a preprocessing step by
    matching titles/URLs against the `papers` table); it is parsed to int.
    """
    rows: list[dict] = []
    with path.open(newline="", encoding="utf-8") as fh:
        for raw in csv.DictReader(fh):
            row = {col: (raw.get(col) or "").strip() for col in _BACKFILL_COLUMNS}
            row["paper_id"] = int(row["paper_id"])
            rows.append(row)
    return rows


def push_backfill_row(
    conn: Connection,
    *,
    row: dict,
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
        except Exception as e:  # noqa: BLE001 — per-row boundary; keep going
            failures += 1
            print(f"  ✗ {label}: {type(e).__name__}: {e}", file=sys.stderr)
        else:
            print(f"  · {label}: {status} -> {detail}")

    pushed = len(rows) - failures
    print(f"Zotero backfill done: {pushed} ok, {failures} failed.")
    return failures


def record_failure(conn: Connection, *, name: str, error: str) -> None:
    """Write a failure row to command_log so /wids-zotero-retry knows what to fix."""
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO command_log (source, name, status, error) "
            "VALUES ('slash_command', %s, 'failure', %s)",
            (name, error),
        )
    conn.commit()


def _parse_env_file(path: Path) -> dict[str, str]:
    """Tiny .env parser: KEY=VALUE per line, # comments, optional quotes."""
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
        if (val.startswith('"') and val.endswith('"')) or \
           (val.startswith("'") and val.endswith("'")):
            val = val[1:-1]
        out[key] = val
    return out


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
        except Exception as e:  # noqa: BLE001 — top-level boundary
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
            except Exception as inner:  # noqa: BLE001
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
