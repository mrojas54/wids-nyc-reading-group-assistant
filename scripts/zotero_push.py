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
    uv run scripts/zotero_push.py --paper-id=<id> --meeting-id=<id>

Env (from web/.env.local):
    SUPABASE_DB_URL    Postgres connection string for the project DB.
    ZOTERO_API_KEY     Zotero API key with library-write access to group 6540956.
    ZOTERO_GROUP_ID    Numeric Zotero group ID (6540956 in prod).
    WIDS_PROD_HOST     Base URL (e.g. https://wids-nyc-reading-group-assistant.vercel.app).
"""
from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from typing import Optional
from urllib.parse import urlparse, urlunparse

import requests


_ARXIV_PDF_RE = re.compile(r"^/pdf/(.+?)(?:\.pdf)?$")


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

    return {
        "item_type": item_type,
        "title": title,
        "authors": authors,
        "abstract": abstract,
        "venue": venue,
        "year": year,
        "doi": doi,
        "url": paper_url,
    }


def extract_db_fallback_metadata(conn, *, paper_id: int) -> dict:
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


def main() -> int:
    """CLI entry point. Returns process exit code (0 success, 1 failure)."""
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
