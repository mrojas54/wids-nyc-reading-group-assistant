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
from urllib.parse import urlparse, urlunparse


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


def main() -> int:
    """CLI entry point. Returns process exit code (0 success, 1 failure)."""
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
