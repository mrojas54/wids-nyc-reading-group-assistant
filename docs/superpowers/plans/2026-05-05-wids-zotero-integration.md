# WiDS Zotero Library-of-Record Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Push every newly-read paper to a public Zotero group library at `/wids-make-companion` time, with a child note containing meeting date, leader, topic, and companion URL.

**Architecture:** A single Python script (`scripts/zotero_push.py`, runnable via `uv run` with PEP 723 inline deps) reads `papers` + `meetings` from Supabase via psycopg, looks up rich metadata from arXiv API or CrossRef (with a citation_doi page-fetch step for non-arXiv URLs whose DOI isn't in the path), then POSTs an item + child note to the Zotero web API. Idempotent via a new `papers.zotero_item_key` column plus a `wids_paper_id:<id>` correlator stored in Zotero's `extra` field for crash-safety. Soft-fail integration: failures don't block the companion artifact; an operator-run `/wids-zotero-retry <meeting-id>` slash command reruns the push.

**Tech Stack:** Python 3.11+, `psycopg[binary]>=3.2` (Supabase Postgres direct), `requests>=2.31` (HTTP). Tests use `pytest` + `responses` for HTTP mocking, both injected via `uv run --with`. arXiv Atom XML parsed with stdlib `xml.etree.ElementTree`. NY-time date formatting via stdlib `zoneinfo`.

**Spec:** [docs/superpowers/specs/2026-05-05-wids-zotero-integration-design.md](../specs/2026-05-05-wids-zotero-integration-design.md)

---

## Task 1: Database migration — add `papers.zotero_item_key`

**Files:**
- Create: `migrations/009_papers_zotero_item_key.sql`

- [ ] **Step 1: Write the migration**

Create `migrations/009_papers_zotero_item_key.sql`:

```sql
-- 009_papers_zotero_item_key.sql
-- Adds a column to track which Zotero group-library item corresponds to a
-- given paper. Set on first successful push by /wids-make-companion (via
-- scripts/zotero_push.py). NULL = not yet pushed.

ALTER TABLE papers ADD COLUMN zotero_item_key TEXT;

COMMENT ON COLUMN papers.zotero_item_key IS
  'Zotero item key (8-char alphanumeric, e.g. "ABCD1234") for the WiDS NYC '
  'group library (group 6540956). NULL = not yet pushed.';
```

- [ ] **Step 2: Apply the migration to local Supabase**

Run:
```bash
psql "$SUPABASE_DB_URL" -f migrations/009_papers_zotero_item_key.sql
```

Expected output:
```
ALTER TABLE
COMMENT
```

- [ ] **Step 3: Verify the column exists**

Run:
```bash
psql "$SUPABASE_DB_URL" -c "\d papers" | grep zotero
```

Expected output (one line):
```
 zotero_item_key | text                     |
```

- [ ] **Step 4: Commit**

```bash
git add migrations/009_papers_zotero_item_key.sql
git commit -m "feat(db): add papers.zotero_item_key column for Zotero idempotency"
```

---

## Task 2: Set up scripts/ package + test plumbing

**Files:**
- Create: `scripts/__init__.py`
- Create: `tests/conftest.py`
- Create: `scripts/zotero_push.py` (skeleton only)
- Create: `tests/zotero_push_test.py` (one trivial smoke test)

- [ ] **Step 1: Create the empty package init**

Create `scripts/__init__.py` with no content (zero bytes — empty file).

- [ ] **Step 2: Create the test conftest**

Create `tests/conftest.py`:

```python
"""Pytest configuration: ensure repo root is on sys.path so tests can
import top-level packages like `scripts`."""
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))
```

- [ ] **Step 3: Create the skeleton script**

Create `scripts/zotero_push.py`:

```python
#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "psycopg[binary]>=3.2",
#   "requests>=2.31",
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


def main() -> int:
    """CLI entry point. Returns process exit code (0 success, 1 failure)."""
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Write a smoke test that imports the script**

Create `tests/zotero_push_test.py`:

```python
"""Tests for scripts/zotero_push.py.

Run via:
    uv run --with pytest --with responses --with "psycopg[binary]" \\
        pytest tests/zotero_push_test.py -v
"""
from __future__ import annotations


def test_module_imports():
    """Smoke test: the script's main entry is importable."""
    from scripts.zotero_push import main
    assert callable(main)
```

- [ ] **Step 5: Run the smoke test**

Run:
```bash
uv run --with pytest --with responses --with "psycopg[binary]" \
    pytest tests/zotero_push_test.py -v
```

Expected output (key lines):
```
tests/zotero_push_test.py::test_module_imports PASSED
====== 1 passed in 0.0Xs ======
```

- [ ] **Step 6: Commit**

```bash
git add scripts/__init__.py scripts/zotero_push.py tests/conftest.py tests/zotero_push_test.py
git commit -m "feat(zotero): scaffold zotero_push.py + test harness"
```

---

## Task 3: URL normalization

**Files:**
- Modify: `scripts/zotero_push.py` (add `normalize_url`)
- Modify: `tests/zotero_push_test.py` (add tests)

- [ ] **Step 1: Write the failing tests**

Append to `tests/zotero_push_test.py`:

```python
import pytest

from scripts.zotero_push import normalize_url


@pytest.mark.parametrize("raw, expected", [
    # arxiv pdf -> abs
    ("https://arxiv.org/pdf/2405.02411",
     "https://arxiv.org/abs/2405.02411"),
    ("https://arxiv.org/pdf/2405.02411.pdf",
     "https://arxiv.org/abs/2405.02411"),
    # arxiv abs is preserved
    ("https://arxiv.org/abs/2405.02411",
     "https://arxiv.org/abs/2405.02411"),
    # arxiv with version suffix
    ("https://arxiv.org/abs/2405.02411v2",
     "https://arxiv.org/abs/2405.02411v2"),
    # arxiv with category-qualified id (older format)
    ("https://arxiv.org/abs/cs.LG/0601001",
     "https://arxiv.org/abs/cs.LG/0601001"),
    # arxiv query params dropped
    ("https://arxiv.org/abs/2405.02411?context=cs.CL",
     "https://arxiv.org/abs/2405.02411"),
    # tandfonline ?needAccess=true dropped
    ("https://www.tandfonline.com/doi/epdf/10.1080/26939169.2023.2276446?needAccess=true",
     "https://www.tandfonline.com/doi/epdf/10.1080/26939169.2023.2276446"),
    # http -> https; lowercase host
    ("http://ARXIV.ORG/abs/2405.02411",
     "https://arxiv.org/abs/2405.02411"),
    # mdpi: untouched (no DOI in path; will be resolved later via meta tag)
    ("https://www.mdpi.com/2227-7390/13/10/1551",
     "https://www.mdpi.com/2227-7390/13/10/1551"),
])
def test_normalize_url(raw, expected):
    assert normalize_url(raw) == expected
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
uv run --with pytest --with responses --with "psycopg[binary]" \
    pytest tests/zotero_push_test.py::test_normalize_url -v
```

Expected: `ImportError: cannot import name 'normalize_url'` — collection failure.

- [ ] **Step 3: Implement `normalize_url`**

Append to `scripts/zotero_push.py` (above `def main()`):

```python
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
uv run --with pytest --with responses --with "psycopg[binary]" \
    pytest tests/zotero_push_test.py::test_normalize_url -v
```

Expected: 9 passed.

- [ ] **Step 5: Commit**

```bash
git add scripts/zotero_push.py tests/zotero_push_test.py
git commit -m "feat(zotero): URL normalization for arxiv/pdf, query params, host casing"
```

---

## Task 4: Source classification

**Files:**
- Modify: `scripts/zotero_push.py` (add `classify_url`)
- Modify: `tests/zotero_push_test.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/zotero_push_test.py`:

```python
from scripts.zotero_push import classify_url


@pytest.mark.parametrize("url, expected", [
    ("https://arxiv.org/abs/2405.02411", "arxiv"),
    ("https://arxiv.org/abs/cs.LG/0601001", "arxiv"),
    # DOI in path
    ("https://www.tandfonline.com/doi/epdf/10.1080/26939169.2023.2276446", "doi_in_url"),
    ("https://dl.acm.org/doi/10.1145/3696410.3714618", "doi_in_url"),
    # Page-fetch needed (no DOI in path)
    ("https://www.mdpi.com/2227-7390/13/10/1551", "needs_meta_lookup"),
    ("https://www.nature.com/articles/s41586-024-08025-4", "needs_meta_lookup"),
    ("https://proceedings.mlr.press/v162/budhathoki22a/budhathoki22a.pdf", "needs_meta_lookup"),
    # Plain hosted PDF without publisher infra
    ("https://www.cs.usfca.edu/~mmalensek/publications/shah2018scalable.pdf", "needs_meta_lookup"),
    ("https://static.googleusercontent.com/media/research.google.com/en//pubs/archive/45530.pdf", "needs_meta_lookup"),
])
def test_classify_url(url, expected):
    assert classify_url(url) == expected
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
uv run --with pytest --with responses --with "psycopg[binary]" \
    pytest tests/zotero_push_test.py::test_classify_url -v
```

Expected: `ImportError: cannot import name 'classify_url'`.

- [ ] **Step 3: Implement `classify_url`**

Append to `scripts/zotero_push.py`:

```python
_DOI_IN_URL_RE = re.compile(r"/(10\.\d{4,9}/[^?#]+)")


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
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
uv run --with pytest --with responses --with "psycopg[binary]" \
    pytest tests/zotero_push_test.py::test_classify_url -v
```

Expected: 9 passed.

- [ ] **Step 5: Commit**

```bash
git add scripts/zotero_push.py tests/zotero_push_test.py
git commit -m "feat(zotero): classify URL as arxiv / doi_in_url / needs_meta_lookup"
```

---

## Task 5: arXiv metadata extraction

**Files:**
- Modify: `scripts/zotero_push.py`
- Modify: `tests/zotero_push_test.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/zotero_push_test.py`:

```python
import responses

from scripts.zotero_push import extract_arxiv_metadata

ARXIV_ATOM_FIXTURE = """<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2405.02411v1</id>
    <updated>2024-05-04T00:00:00Z</updated>
    <published>2024-05-03T00:00:00Z</published>
    <title>The Call for Socially Aware Language Technologies</title>
    <summary>Some abstract text here. Multiple sentences.</summary>
    <author><name>Diyi Yang</name></author>
    <author><name>Dirk Hovy</name></author>
    <author><name>David Jurgens</name></author>
    <category term="cs.CL" />
  </entry>
</feed>
"""


@responses.activate
def test_extract_arxiv_metadata_happy():
    responses.add(
        responses.GET,
        "https://export.arxiv.org/api/query",
        body=ARXIV_ATOM_FIXTURE,
        status=200,
        content_type="application/atom+xml",
    )
    meta = extract_arxiv_metadata("https://arxiv.org/abs/2405.02411")
    assert meta["item_type"] == "preprint"
    assert meta["title"] == "The Call for Socially Aware Language Technologies"
    assert meta["authors"] == ["Diyi Yang", "Dirk Hovy", "David Jurgens"]
    assert "Some abstract text" in meta["abstract"]
    assert meta["year"] == 2024
    assert meta["arxiv_id"] == "2405.02411"
    assert meta["url"] == "https://arxiv.org/abs/2405.02411"


@responses.activate
def test_extract_arxiv_metadata_404_returns_none():
    responses.add(
        responses.GET,
        "https://export.arxiv.org/api/query",
        body="<feed xmlns='http://www.w3.org/2005/Atom'></feed>",
        status=200,
    )
    meta = extract_arxiv_metadata("https://arxiv.org/abs/9999.99999")
    assert meta is None


@pytest.mark.parametrize("url, expected_id", [
    ("https://arxiv.org/abs/2405.02411", "2405.02411"),
    ("https://arxiv.org/abs/2405.02411v3", "2405.02411v3"),
    ("https://arxiv.org/abs/cs.LG/0601001", "cs.LG/0601001"),
])
def test_arxiv_id_parsed_from_url(url, expected_id):
    from scripts.zotero_push import _arxiv_id_from_url
    assert _arxiv_id_from_url(url) == expected_id
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
uv run --with pytest --with responses --with "psycopg[binary]" \
    pytest tests/zotero_push_test.py -v -k "arxiv"
```

Expected: ImportError.

- [ ] **Step 3: Implement `_arxiv_id_from_url` and `extract_arxiv_metadata`**

Append to `scripts/zotero_push.py`:

```python
import xml.etree.ElementTree as ET
from typing import Optional

import requests


_ARXIV_API_URL = "https://export.arxiv.org/api/query"
_ARXIV_NS = {"atom": "http://www.w3.org/2005/Atom"}


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
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
uv run --with pytest --with responses --with "psycopg[binary]" \
    pytest tests/zotero_push_test.py -v -k "arxiv"
```

Expected: 5 passed (3 from `test_arxiv_id_parsed_from_url` + 2 named tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/zotero_push.py tests/zotero_push_test.py
git commit -m "feat(zotero): arXiv API metadata extraction with Atom XML parsing"
```

---

## Task 6: DOI extraction (URL + meta tag)

**Files:**
- Modify: `scripts/zotero_push.py`
- Modify: `tests/zotero_push_test.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/zotero_push_test.py`:

```python
from scripts.zotero_push import extract_doi_from_url, extract_doi_from_meta_tag


@pytest.mark.parametrize("url, expected", [
    ("https://www.tandfonline.com/doi/epdf/10.1080/26939169.2023.2276446",
     "10.1080/26939169.2023.2276446"),
    ("https://dl.acm.org/doi/10.1145/3696410.3714618",
     "10.1145/3696410.3714618"),
    ("https://doi.org/10.3390/math13101551",
     "10.3390/math13101551"),
    ("https://www.mdpi.com/2227-7390/13/10/1551", None),
    ("https://arxiv.org/abs/2405.02411", None),
])
def test_extract_doi_from_url(url, expected):
    assert extract_doi_from_url(url) == expected


@responses.activate
def test_extract_doi_from_meta_tag_found():
    html = """<html><head>
      <meta name="citation_doi" content="10.3390/math13101551" />
      <meta name="citation_title" content="Some Math Paper" />
    </head><body></body></html>"""
    responses.add(
        responses.GET,
        "https://www.mdpi.com/2227-7390/13/10/1551",
        body=html,
        status=200,
        content_type="text/html",
    )
    assert extract_doi_from_meta_tag("https://www.mdpi.com/2227-7390/13/10/1551") \
        == "10.3390/math13101551"


@responses.activate
def test_extract_doi_from_meta_tag_absent():
    responses.add(
        responses.GET,
        "https://example.com/paper",
        body="<html><head></head></html>",
        status=200,
        content_type="text/html",
    )
    assert extract_doi_from_meta_tag("https://example.com/paper") is None


@responses.activate
def test_extract_doi_from_meta_tag_404_is_none():
    responses.add(
        responses.GET,
        "https://example.com/missing",
        status=404,
    )
    assert extract_doi_from_meta_tag("https://example.com/missing") is None


@responses.activate
def test_extract_doi_from_meta_tag_pdf_is_none():
    """A direct PDF URL has no meta tags — must return None, not blow up."""
    responses.add(
        responses.GET,
        "https://example.com/paper.pdf",
        body=b"%PDF-1.4 binary content",
        status=200,
        content_type="application/pdf",
    )
    assert extract_doi_from_meta_tag("https://example.com/paper.pdf") is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
uv run --with pytest --with responses --with "psycopg[binary]" \
    pytest tests/zotero_push_test.py -v -k "doi"
```

Expected: ImportError.

- [ ] **Step 3: Implement DOI extractors**

Append to `scripts/zotero_push.py`:

```python
_CITATION_DOI_RE = re.compile(
    rb'<meta\s+name=["\']citation_doi["\']\s+content=["\']([^"\']+)["\']',
    re.IGNORECASE,
)


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
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
uv run --with pytest --with responses --with "psycopg[binary]" \
    pytest tests/zotero_push_test.py -v -k "doi"
```

Expected: 9 passed (5 from `test_extract_doi_from_url` + 4 meta-tag tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/zotero_push.py tests/zotero_push_test.py
git commit -m "feat(zotero): DOI extraction from URL path and citation_doi meta tag"
```

---

## Task 7: CrossRef metadata extraction

**Files:**
- Modify: `scripts/zotero_push.py`
- Modify: `tests/zotero_push_test.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/zotero_push_test.py`:

```python
from scripts.zotero_push import extract_crossref_metadata


CROSSREF_FIXTURE = {
    "status": "ok",
    "message": {
        "DOI": "10.3390/math13101551",
        "title": ["Some Math Paper Title"],
        "author": [
            {"given": "Alice", "family": "Smith"},
            {"given": "Bob", "family": "Jones"},
        ],
        "abstract": "<jats:p>Abstract text here.</jats:p>",
        "container-title": ["Mathematics"],
        "issued": {"date-parts": [[2025, 5, 15]]},
        "type": "journal-article",
        "URL": "https://doi.org/10.3390/math13101551",
    },
}


@responses.activate
def test_extract_crossref_metadata_happy():
    responses.add(
        responses.GET,
        "https://api.crossref.org/works/10.3390/math13101551",
        json=CROSSREF_FIXTURE,
        status=200,
    )
    meta = extract_crossref_metadata("10.3390/math13101551",
                                     paper_url="https://www.mdpi.com/2227-7390/13/10/1551")
    assert meta["item_type"] == "journalArticle"
    assert meta["title"] == "Some Math Paper Title"
    assert meta["authors"] == ["Alice Smith", "Bob Jones"]
    assert "Abstract text here" in meta["abstract"]
    assert "<jats:p>" not in meta["abstract"]  # tags stripped
    assert meta["venue"] == "Mathematics"
    assert meta["year"] == 2025
    assert meta["doi"] == "10.3390/math13101551"
    # Original URL is what we want to keep visible to humans
    assert meta["url"] == "https://www.mdpi.com/2227-7390/13/10/1551"


@responses.activate
def test_extract_crossref_metadata_404_returns_none():
    responses.add(
        responses.GET,
        "https://api.crossref.org/works/10.bogus/123",
        status=404,
    )
    meta = extract_crossref_metadata("10.bogus/123", paper_url="https://example.com")
    assert meta is None


@responses.activate
def test_extract_crossref_metadata_proceedings_article_type():
    """CrossRef's 'proceedings-article' type maps to Zotero conferencePaper."""
    fixture = {
        "status": "ok",
        "message": {
            "DOI": "10.1145/x",
            "title": ["Proc Paper"],
            "author": [{"given": "X", "family": "Y"}],
            "container-title": ["Proc. ACM Conf"],
            "issued": {"date-parts": [[2022]]},
            "type": "proceedings-article",
            "URL": "https://doi.org/10.1145/x",
        },
    }
    responses.add(
        responses.GET,
        "https://api.crossref.org/works/10.1145/x",
        json=fixture,
        status=200,
    )
    meta = extract_crossref_metadata("10.1145/x", paper_url="https://dl.acm.org/doi/10.1145/x")
    assert meta["item_type"] == "conferencePaper"
    assert meta["year"] == 2022
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
uv run --with pytest --with responses --with "psycopg[binary]" \
    pytest tests/zotero_push_test.py -v -k "crossref"
```

Expected: ImportError.

- [ ] **Step 3: Implement `extract_crossref_metadata`**

Append to `scripts/zotero_push.py`:

```python
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
uv run --with pytest --with responses --with "psycopg[binary]" \
    pytest tests/zotero_push_test.py -v -k "crossref"
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add scripts/zotero_push.py tests/zotero_push_test.py
git commit -m "feat(zotero): CrossRef API metadata extraction with JATS abstract stripping"
```

---

## Task 8: DB fallback metadata extraction

**Files:**
- Modify: `scripts/zotero_push.py`
- Modify: `tests/zotero_push_test.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/zotero_push_test.py`:

```python
from unittest.mock import MagicMock

from scripts.zotero_push import extract_db_fallback_metadata


def test_extract_db_fallback_metadata_full_row():
    conn = MagicMock()
    cursor = conn.cursor.return_value.__enter__.return_value
    cursor.fetchone.return_value = (
        "Some Title",                        # title
        "https://example.com/paper.pdf",     # url
        "Plain abstract.",                   # abstract
        ["Alice", "Bob"],                    # authors (TEXT[])
        "Some Venue",                        # venue
        2023,                                # year
    )
    meta = extract_db_fallback_metadata(conn, paper_id=42)
    assert meta == {
        "item_type": "webpage",
        "title": "Some Title",
        "authors": ["Alice", "Bob"],
        "abstract": "Plain abstract.",
        "venue": "Some Venue",
        "year": 2023,
        "url": "https://example.com/paper.pdf",
    }


def test_extract_db_fallback_metadata_missing_optional_fields():
    conn = MagicMock()
    cursor = conn.cursor.return_value.__enter__.return_value
    cursor.fetchone.return_value = (
        "Bare Title", "https://x.example", None, None, None, None,
    )
    meta = extract_db_fallback_metadata(conn, paper_id=7)
    assert meta["title"] == "Bare Title"
    assert meta["authors"] == []
    assert meta["abstract"] == ""
    assert meta["venue"] is None
    assert meta["year"] is None


def test_extract_db_fallback_metadata_no_paper_raises():
    conn = MagicMock()
    cursor = conn.cursor.return_value.__enter__.return_value
    cursor.fetchone.return_value = None
    with pytest.raises(ValueError, match="paper_id=999 not found"):
        extract_db_fallback_metadata(conn, paper_id=999)
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
uv run --with pytest --with responses --with "psycopg[binary]" \
    pytest tests/zotero_push_test.py -v -k "fallback"
```

Expected: ImportError.

- [ ] **Step 3: Implement `extract_db_fallback_metadata`**

Append to `scripts/zotero_push.py`:

```python
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
uv run --with pytest --with responses --with "psycopg[binary]" \
    pytest tests/zotero_push_test.py -v -k "fallback"
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add scripts/zotero_push.py tests/zotero_push_test.py
git commit -m "feat(zotero): DB fallback metadata reader for non-arXiv non-DOI papers"
```

---

## Task 9: Unified `extract_metadata` orchestrator

**Files:**
- Modify: `scripts/zotero_push.py`
- Modify: `tests/zotero_push_test.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/zotero_push_test.py`:

```python
from scripts.zotero_push import extract_metadata


@responses.activate
def test_extract_metadata_arxiv_path():
    responses.add(
        responses.GET, "https://export.arxiv.org/api/query",
        body=ARXIV_ATOM_FIXTURE, status=200,
    )
    conn = MagicMock()
    meta = extract_metadata(
        conn,
        paper_id=1,
        paper_url="https://arxiv.org/abs/2405.02411",
    )
    assert meta["item_type"] == "preprint"
    assert meta["arxiv_id"] == "2405.02411"
    # DB fallback should NOT have been queried
    conn.cursor.assert_not_called()


@responses.activate
def test_extract_metadata_doi_in_url_path():
    responses.add(
        responses.GET, "https://api.crossref.org/works/10.1080/26939169.2023.2276446",
        json=CROSSREF_FIXTURE, status=200,
    )
    conn = MagicMock()
    meta = extract_metadata(
        conn,
        paper_id=1,
        paper_url="https://www.tandfonline.com/doi/epdf/10.1080/26939169.2023.2276446",
    )
    assert meta["item_type"] == "journalArticle"
    assert meta["doi"] == "10.3390/math13101551"  # from fixture
    conn.cursor.assert_not_called()


@responses.activate
def test_extract_metadata_meta_tag_path():
    """needs_meta_lookup: page fetch finds DOI, then CrossRef succeeds."""
    html = b'<html><head><meta name="citation_doi" content="10.3390/math13101551"/></head></html>'
    responses.add(
        responses.GET, "https://www.mdpi.com/2227-7390/13/10/1551",
        body=html, status=200, content_type="text/html",
    )
    responses.add(
        responses.GET, "https://api.crossref.org/works/10.3390/math13101551",
        json=CROSSREF_FIXTURE, status=200,
    )
    conn = MagicMock()
    meta = extract_metadata(
        conn,
        paper_id=1,
        paper_url="https://www.mdpi.com/2227-7390/13/10/1551",
    )
    assert meta["item_type"] == "journalArticle"
    conn.cursor.assert_not_called()


@responses.activate
def test_extract_metadata_falls_back_when_arxiv_returns_no_entry():
    """arXiv API returns empty feed -> fall back to DB."""
    responses.add(
        responses.GET, "https://export.arxiv.org/api/query",
        body="<feed xmlns='http://www.w3.org/2005/Atom'></feed>",
        status=200,
    )
    conn = MagicMock()
    cursor = conn.cursor.return_value.__enter__.return_value
    cursor.fetchone.return_value = (
        "Fallback Title", "https://arxiv.org/abs/9999.99", None, None, None, None,
    )
    meta = extract_metadata(
        conn, paper_id=1,
        paper_url="https://arxiv.org/abs/9999.99",
    )
    assert meta["item_type"] == "webpage"
    assert meta["title"] == "Fallback Title"


@responses.activate
def test_extract_metadata_falls_back_when_no_meta_doi_found():
    """needs_meta_lookup with no citation_doi -> DB fallback."""
    responses.add(
        responses.GET, "https://example.com/paper.pdf",
        body=b"%PDF-1.4", status=200, content_type="application/pdf",
    )
    conn = MagicMock()
    cursor = conn.cursor.return_value.__enter__.return_value
    cursor.fetchone.return_value = (
        "PDF Title", "https://example.com/paper.pdf", None, ["X"], None, 2020,
    )
    meta = extract_metadata(conn, paper_id=1, paper_url="https://example.com/paper.pdf")
    assert meta["item_type"] == "webpage"
    assert meta["authors"] == ["X"]
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
uv run --with pytest --with responses --with "psycopg[binary]" \
    pytest tests/zotero_push_test.py -v -k "extract_metadata"
```

Expected: ImportError.

- [ ] **Step 3: Implement `extract_metadata`**

Append to `scripts/zotero_push.py`:

```python
def extract_metadata(conn, *, paper_id: int, paper_url: str) -> dict:
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
uv run --with pytest --with responses --with "psycopg[binary]" \
    pytest tests/zotero_push_test.py -v -k "extract_metadata"
```

Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add scripts/zotero_push.py tests/zotero_push_test.py
git commit -m "feat(zotero): unified extract_metadata orchestrator with fallback chain"
```

---

## Task 10: WiDS context note HTML

**Files:**
- Modify: `scripts/zotero_push.py`
- Modify: `tests/zotero_push_test.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/zotero_push_test.py`:

```python
from datetime import datetime, timezone

from scripts.zotero_push import build_note_html


def test_build_note_html_full():
    # 2026-03-12 19:00 UTC = 2026-03-12 15:00 EDT (Wednesday)
    meeting_dt = datetime(2026, 3, 12, 19, 0, tzinfo=timezone.utc)
    html = build_note_html(
        meeting_at=meeting_dt,
        leader_name="Michelle Rojas",
        topic_names=["LLM Security", "Adversarial ML"],
        companion_path="/papers/12",
        prod_host="https://wids-nyc-reading-group-assistant.vercel.app",
    )
    assert "<strong>WiDS NYC Reading Group</strong>" in html
    assert "Thursday, March 12, 2026" in html  # NY-tz formatted
    assert "Michelle Rojas" in html
    assert "LLM Security / Adversarial ML" in html
    assert "https://wids-nyc-reading-group-assistant.vercel.app/papers/12" in html


def test_build_note_html_omits_missing_fields():
    """Lines for missing data are dropped, not rendered with 'None'."""
    html = build_note_html(
        meeting_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        leader_name=None,
        topic_names=[],
        companion_path=None,
        prod_host="https://x.example",
    )
    assert "WiDS NYC" in html
    assert "Leader" not in html
    assert "Topic" not in html
    assert "Companion" not in html
    assert "None" not in html
    assert "January 1, 2026" in html or "December 31, 2025" in html  # tz-dependent display


def test_build_note_html_single_topic():
    html = build_note_html(
        meeting_at=datetime(2026, 5, 15, 14, 0, tzinfo=timezone.utc),
        leader_name="X",
        topic_names=["Causal Inference"],
        companion_path="/papers/1",
        prod_host="https://x.example",
    )
    assert "Causal Inference" in html
    assert " / " not in html.split("Topic:")[1].split("</li>")[0]
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
uv run --with pytest --with responses --with "psycopg[binary]" \
    pytest tests/zotero_push_test.py -v -k "note_html"
```

Expected: ImportError.

- [ ] **Step 3: Implement `build_note_html`**

Append to `scripts/zotero_push.py`:

```python
from datetime import datetime
from zoneinfo import ZoneInfo


_NY_TZ = ZoneInfo("America/New_York")


def build_note_html(
    *,
    meeting_at: datetime,
    leader_name: Optional[str],
    topic_names: list[str],
    companion_path: Optional[str],
    prod_host: str,
) -> str:
    """Render the WiDS context note attached as a child of the Zotero item.

    Lines for missing inputs are omitted entirely (no "Leader: None").
    """
    meeting_local = meeting_at.astimezone(_NY_TZ)
    meeting_str = meeting_local.strftime("%A, %B %-d, %Y")

    lines = [
        "<p><strong>WiDS NYC Reading Group</strong></p>",
        "<ul>",
        f"  <li><strong>Meeting:</strong> {meeting_str}</li>",
    ]
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
uv run --with pytest --with responses --with "psycopg[binary]" \
    pytest tests/zotero_push_test.py -v -k "note_html"
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add scripts/zotero_push.py tests/zotero_push_test.py
git commit -m "feat(zotero): WiDS context note HTML template with NY-tz date formatting"
```

---

## Task 11: Zotero item create

**Files:**
- Modify: `scripts/zotero_push.py`
- Modify: `tests/zotero_push_test.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/zotero_push_test.py`:

```python
import json

from scripts.zotero_push import create_zotero_item


@responses.activate
def test_create_zotero_item_arxiv_preprint():
    responses.add(
        responses.POST,
        "https://api.zotero.org/groups/6540956/items",
        json={"successful": {"0": {"key": "ABCD1234"}}, "failed": {}},
        status=200,
    )
    meta = {
        "item_type": "preprint",
        "title": "T",
        "authors": ["Alice Smith", "Bob"],
        "abstract": "A.",
        "year": 2024,
        "arxiv_id": "2405.02411",
        "url": "https://arxiv.org/abs/2405.02411",
    }
    key = create_zotero_item(
        meta=meta,
        paper_id=42,
        api_key="fake-key",
        group_id="6540956",
    )
    assert key == "ABCD1234"

    sent = json.loads(responses.calls[0].request.body)
    assert isinstance(sent, list) and len(sent) == 1
    item = sent[0]
    assert item["itemType"] == "preprint"
    assert item["title"] == "T"
    assert item["url"] == "https://arxiv.org/abs/2405.02411"
    assert item["abstractNote"] == "A."
    assert item["date"] == "2024"
    # Authors split into given/family for Zotero
    assert item["creators"] == [
        {"creatorType": "author", "firstName": "Alice", "lastName": "Smith"},
        {"creatorType": "author", "firstName": "", "lastName": "Bob"},
    ]
    # The wids correlator is in `extra`
    assert "wids_paper_id:42" in item["extra"]
    # arXiv preprint also gets the arxiv id in extra
    assert "arXiv:2405.02411" in item["extra"]


@responses.activate
def test_create_zotero_item_journal_article():
    responses.add(
        responses.POST,
        "https://api.zotero.org/groups/6540956/items",
        json={"successful": {"0": {"key": "WXYZ0001"}}, "failed": {}},
        status=200,
    )
    meta = {
        "item_type": "journalArticle",
        "title": "Math Paper",
        "authors": ["A B"],
        "abstract": "abc",
        "venue": "Mathematics",
        "year": 2025,
        "doi": "10.3390/math13101551",
        "url": "https://www.mdpi.com/2227-7390/13/10/1551",
    }
    key = create_zotero_item(meta=meta, paper_id=7, api_key="k", group_id="6540956")
    assert key == "WXYZ0001"

    sent = json.loads(responses.calls[0].request.body)[0]
    assert sent["itemType"] == "journalArticle"
    assert sent["DOI"] == "10.3390/math13101551"
    assert sent["publicationTitle"] == "Mathematics"
    assert isinstance(sent["extra"], str)
    assert "wids_paper_id:7" in sent["extra"]


@responses.activate
def test_create_zotero_item_4xx_raises():
    responses.add(
        responses.POST,
        "https://api.zotero.org/groups/6540956/items",
        json={"error": "bad"},
        status=400,
    )
    meta = {
        "item_type": "webpage", "title": "T", "authors": [], "abstract": "",
        "venue": None, "year": None, "url": "https://x.example",
    }
    with pytest.raises(requests.HTTPError):
        create_zotero_item(meta=meta, paper_id=1, api_key="k", group_id="6540956")


@responses.activate
def test_create_zotero_item_failed_payload_raises():
    """Zotero returns 200 but reports the item as failed in the JSON."""
    responses.add(
        responses.POST,
        "https://api.zotero.org/groups/6540956/items",
        json={"successful": {}, "failed": {"0": {"code": 400, "message": "bad"}}},
        status=200,
    )
    meta = {
        "item_type": "webpage", "title": "T", "authors": [], "abstract": "",
        "venue": None, "year": None, "url": "https://x.example",
    }
    with pytest.raises(RuntimeError, match="Zotero rejected item"):
        create_zotero_item(meta=meta, paper_id=1, api_key="k", group_id="6540956")
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
uv run --with pytest --with responses --with "psycopg[binary]" \
    pytest tests/zotero_push_test.py -v -k "create_zotero_item"
```

Expected: ImportError.

- [ ] **Step 3: Implement `create_zotero_item`**

Append to `scripts/zotero_push.py`:

```python
_ZOTERO_API_BASE = "https://api.zotero.org"


def _split_author(name: str) -> dict:
    """Split a 'First Last' string into Zotero's creator shape.

    Single-token names go in lastName (matching Zotero's convention for
    mononyms); multi-token names split on the last whitespace.
    """
    parts = name.strip().rsplit(" ", 1)
    if len(parts) == 1:
        return {"creatorType": "author", "firstName": "", "lastName": parts[0]}
    first, last = parts
    return {"creatorType": "author", "firstName": first, "lastName": last}


def _build_item_payload(meta: dict, paper_id: int) -> dict:
    """Translate a metadata dict into a Zotero-API item body."""
    extra_lines = [f"wids_paper_id:{paper_id}"]
    if meta.get("arxiv_id"):
        extra_lines.append(f"arXiv:{meta['arxiv_id']}")

    item = {
        "itemType": meta["item_type"],
        "title": meta.get("title", ""),
        "creators": [_split_author(a) for a in meta.get("authors", []) if a],
        "abstractNote": meta.get("abstract") or "",
        "url": meta.get("url", ""),
        "extra": "\n".join(extra_lines),
        "tags": [{"tag": "WiDS NYC Reading Group"}],
    }

    year = meta.get("year")
    if year is not None:
        item["date"] = str(year)

    if meta.get("doi"):
        item["DOI"] = meta["doi"]
    if meta.get("venue"):
        # Zotero's field name varies by item type — these three cover ours.
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
    """POST a Zotero item; return the assigned 8-char item key.

    Raises requests.HTTPError on transport-level failure (4xx/5xx).
    Raises RuntimeError if Zotero returns 200 with an item-level failure.
    """
    payload = [_build_item_payload(meta, paper_id)]
    resp = requests.post(
        f"{_ZOTERO_API_BASE}/groups/{group_id}/items",
        headers={
            "Zotero-API-Key": api_key,
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=15,
    )
    resp.raise_for_status()
    body = resp.json()
    if body.get("failed"):
        raise RuntimeError(f"Zotero rejected item: {body['failed']}")
    successful = body.get("successful") or {}
    if "0" not in successful:
        raise RuntimeError(f"Zotero response missing successful[0]: {body}")
    return successful["0"]["key"]
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
uv run --with pytest --with responses --with "psycopg[binary]" \
    pytest tests/zotero_push_test.py -v -k "create_zotero_item"
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add scripts/zotero_push.py tests/zotero_push_test.py
git commit -m "feat(zotero): create_zotero_item with author split + extra correlator"
```

---

## Task 12: Zotero child note create

**Files:**
- Modify: `scripts/zotero_push.py`
- Modify: `tests/zotero_push_test.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/zotero_push_test.py`:

```python
from scripts.zotero_push import create_zotero_note


@responses.activate
def test_create_zotero_note_attaches_to_parent():
    responses.add(
        responses.POST,
        "https://api.zotero.org/groups/6540956/items",
        json={"successful": {"0": {"key": "NOTE0001"}}, "failed": {}},
        status=200,
    )
    note_html = "<p>WiDS</p>"
    note_key = create_zotero_note(
        parent_item_key="ABCD1234",
        note_html=note_html,
        api_key="k",
        group_id="6540956",
    )
    assert note_key == "NOTE0001"

    sent = json.loads(responses.calls[0].request.body)[0]
    assert sent["itemType"] == "note"
    assert sent["parentItem"] == "ABCD1234"
    assert sent["note"] == note_html
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
uv run --with pytest --with responses --with "psycopg[binary]" \
    pytest tests/zotero_push_test.py -v -k "create_zotero_note"
```

Expected: ImportError.

- [ ] **Step 3: Implement `create_zotero_note`**

Append to `scripts/zotero_push.py`:

```python
def create_zotero_note(
    *,
    parent_item_key: str,
    note_html: str,
    api_key: str,
    group_id: str,
) -> str:
    """POST a child note attached to `parent_item_key`."""
    payload = [{
        "itemType": "note",
        "parentItem": parent_item_key,
        "note": note_html,
        "tags": [],
    }]
    resp = requests.post(
        f"{_ZOTERO_API_BASE}/groups/{group_id}/items",
        headers={
            "Zotero-API-Key": api_key,
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=15,
    )
    resp.raise_for_status()
    body = resp.json()
    if body.get("failed"):
        raise RuntimeError(f"Zotero rejected note: {body['failed']}")
    return body["successful"]["0"]["key"]
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
uv run --with pytest --with responses --with "psycopg[binary]" \
    pytest tests/zotero_push_test.py -v -k "create_zotero_note"
```

Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add scripts/zotero_push.py tests/zotero_push_test.py
git commit -m "feat(zotero): create_zotero_note posts child note via parentItem"
```

---

## Task 13: Idempotency — DB column + Zotero correlator

**Files:**
- Modify: `scripts/zotero_push.py`
- Modify: `tests/zotero_push_test.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/zotero_push_test.py`:

```python
from scripts.zotero_push import find_existing_zotero_item


@responses.activate
def test_find_existing_zotero_item_match_found():
    responses.add(
        responses.GET,
        "https://api.zotero.org/groups/6540956/items",
        json=[
            {"key": "OLD12345", "data": {"extra": "wids_paper_id:42\narXiv:x"}},
            {"key": "OTHER567", "data": {"extra": "wids_paper_id:9999"}},
        ],
        status=200,
    )
    key = find_existing_zotero_item(paper_id=42, api_key="k", group_id="6540956")
    assert key == "OLD12345"


@responses.activate
def test_find_existing_zotero_item_no_match():
    responses.add(
        responses.GET,
        "https://api.zotero.org/groups/6540956/items",
        json=[{"key": "OTHER567", "data": {"extra": "wids_paper_id:9999"}}],
        status=200,
    )
    assert find_existing_zotero_item(paper_id=42, api_key="k", group_id="6540956") is None


@responses.activate
def test_find_existing_zotero_item_uses_q_filter():
    """The query MUST send q=wids_paper_id:<id>&qmode=everything to scope the search."""
    responses.add(
        responses.GET,
        "https://api.zotero.org/groups/6540956/items",
        json=[],
        status=200,
    )
    find_existing_zotero_item(paper_id=42, api_key="k", group_id="6540956")
    qs = responses.calls[0].request.url
    assert "q=wids_paper_id%3A42" in qs or "q=wids_paper_id:42" in qs
    assert "qmode=everything" in qs
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
uv run --with pytest --with responses --with "psycopg[binary]" \
    pytest tests/zotero_push_test.py -v -k "find_existing"
```

Expected: ImportError.

- [ ] **Step 3: Implement `find_existing_zotero_item`**

Append to `scripts/zotero_push.py`:

```python
def find_existing_zotero_item(
    *,
    paper_id: int,
    api_key: str,
    group_id: str,
) -> Optional[str]:
    """Return the Zotero item key of any existing item whose `extra`
    contains `wids_paper_id:<paper_id>`, else None.

    Defense-in-depth: covers the rare case where a previous run POSTed
    successfully to Zotero but crashed before writing
    papers.zotero_item_key.
    """
    correlator = f"wids_paper_id:{paper_id}"
    resp = requests.get(
        f"{_ZOTERO_API_BASE}/groups/{group_id}/items",
        headers={"Zotero-API-Key": api_key},
        params={"q": correlator, "qmode": "everything"},
        timeout=15,
    )
    resp.raise_for_status()
    for item in resp.json():
        extra = (item.get("data", {}) or {}).get("extra") or ""
        # Substring match — extra is multiline free-text in Zotero
        if correlator in extra:
            return item["key"]
    return None
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
uv run --with pytest --with responses --with "psycopg[binary]" \
    pytest tests/zotero_push_test.py -v -k "find_existing"
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add scripts/zotero_push.py tests/zotero_push_test.py
git commit -m "feat(zotero): find_existing_zotero_item by wids_paper_id correlator"
```

---

## Task 14: Top-level `push_to_zotero` orchestrator

**Files:**
- Modify: `scripts/zotero_push.py`
- Modify: `tests/zotero_push_test.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/zotero_push_test.py`:

```python
from scripts.zotero_push import push_to_zotero


def _meeting_row(scheduled_at, leader_name, topic_names, companion_path):
    """Helper: shape returned by the meeting-context query (Task 14 impl)."""
    return (scheduled_at, leader_name, topic_names, companion_path)


@responses.activate
def test_push_to_zotero_happy_path_arxiv():
    responses.add(
        responses.GET, "https://export.arxiv.org/api/query",
        body=ARXIV_ATOM_FIXTURE, status=200,
    )
    # 1) idempotency lookup -> not found
    responses.add(
        responses.GET, "https://api.zotero.org/groups/6540956/items",
        json=[], status=200,
    )
    # 2) item create
    responses.add(
        responses.POST, "https://api.zotero.org/groups/6540956/items",
        json={"successful": {"0": {"key": "ITEM0001"}}, "failed": {}},
        status=200,
    )
    # 3) note create
    responses.add(
        responses.POST, "https://api.zotero.org/groups/6540956/items",
        json={"successful": {"0": {"key": "NOTE0001"}}, "failed": {}},
        status=200,
    )

    conn = MagicMock()
    cursor = conn.cursor.return_value.__enter__.return_value
    # Read paper.url + zotero_item_key + meeting context
    cursor.fetchone.side_effect = [
        ("https://arxiv.org/abs/2405.02411", None),  # papers row: (url, zotero_item_key)
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

    # papers.zotero_item_key was UPDATEd
    update_calls = [
        c for c in cursor.execute.call_args_list
        if "UPDATE papers" in c.args[0] and "zotero_item_key" in c.args[0]
    ]
    assert len(update_calls) == 1
    assert update_calls[0].args[1] == ("ITEM0001", 12)
    conn.commit.assert_called()


@responses.activate
def test_push_to_zotero_skips_when_db_already_set():
    """papers.zotero_item_key already populated -> skip everything, no HTTP."""
    conn = MagicMock()
    cursor = conn.cursor.return_value.__enter__.return_value
    cursor.fetchone.return_value = ("https://x", "EXISTING1")

    item_key = push_to_zotero(
        conn, paper_id=1, meeting_id=1,
        api_key="k", group_id="6540956",
        prod_host="https://x.example",
    )
    assert item_key == "EXISTING1"
    assert len(responses.calls) == 0


@responses.activate
def test_push_to_zotero_recovers_from_partial_crash():
    """DB column null but Zotero query finds an existing item -> heal the DB, skip POST."""
    responses.add(
        responses.GET, "https://api.zotero.org/groups/6540956/items",
        json=[{"key": "RECOVERED", "data": {"extra": "wids_paper_id:5"}}],
        status=200,
    )

    conn = MagicMock()
    cursor = conn.cursor.return_value.__enter__.return_value
    cursor.fetchone.side_effect = [
        ("https://arxiv.org/abs/x", None),  # papers row
    ]

    item_key = push_to_zotero(
        conn, paper_id=5, meeting_id=1,
        api_key="k", group_id="6540956",
        prod_host="https://x.example",
    )
    assert item_key == "RECOVERED"
    # No POST happened
    posts = [c for c in responses.calls if c.request.method == "POST"]
    assert posts == []
    # But UPDATE did
    update_calls = [
        c for c in cursor.execute.call_args_list
        if "UPDATE papers" in c.args[0] and "zotero_item_key" in c.args[0]
    ]
    assert len(update_calls) == 1
    assert update_calls[0].args[1] == ("RECOVERED", 5)
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
uv run --with pytest --with responses --with "psycopg[binary]" \
    pytest tests/zotero_push_test.py -v -k "push_to_zotero"
```

Expected: ImportError.

- [ ] **Step 3: Implement `push_to_zotero`**

Append to `scripts/zotero_push.py`:

```python
def _read_paper_for_push(conn, paper_id: int) -> tuple[str, Optional[str]]:
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


def _read_meeting_context(conn, meeting_id: int) -> tuple:
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


def _save_zotero_item_key(conn, *, paper_id: int, item_key: str) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE papers SET zotero_item_key = %s WHERE id = %s",
            (item_key, paper_id),
        )
    conn.commit()


def push_to_zotero(
    conn,
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
uv run --with pytest --with responses --with "psycopg[binary]" \
    pytest tests/zotero_push_test.py -v -k "push_to_zotero"
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add scripts/zotero_push.py tests/zotero_push_test.py
git commit -m "feat(zotero): push_to_zotero orchestrator with crash-recovery via correlator"
```

---

## Task 15: command_log failure recording

**Files:**
- Modify: `scripts/zotero_push.py`
- Modify: `tests/zotero_push_test.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/zotero_push_test.py`:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
uv run --with pytest --with responses --with "psycopg[binary]" \
    pytest tests/zotero_push_test.py::test_record_failure_inserts_command_log_row -v
```

Expected: ImportError.

- [ ] **Step 3: Implement `record_failure`**

Append to `scripts/zotero_push.py`:

```python
def record_failure(conn, *, name: str, error: str) -> None:
    """Write a failure row to command_log so /wids-zotero-retry knows what to fix."""
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO command_log (source, name, status, error) "
            "VALUES ('slash_command', %s, 'failure', %s)",
            (name, error),
        )
    conn.commit()
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
uv run --with pytest --with responses --with "psycopg[binary]" \
    pytest tests/zotero_push_test.py::test_record_failure_inserts_command_log_row -v
```

Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add scripts/zotero_push.py tests/zotero_push_test.py
git commit -m "feat(zotero): record_failure writes command_log row for retry visibility"
```

---

## Task 16: CLI `main` entry — argparse, env loading, dispatch

**Files:**
- Modify: `scripts/zotero_push.py`
- Modify: `tests/zotero_push_test.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/zotero_push_test.py`:

```python
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
    with patch("scripts.zotero_push.psycopg.connect") as connect, \
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
    with patch("scripts.zotero_push.psycopg.connect") as connect, \
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


def test_main_help_exits_zero(capsys):
    with pytest.raises(SystemExit) as exc:
        main(argv=["--help"])
    assert exc.value.code == 0
    out = capsys.readouterr().out
    assert "--paper-id" in out
    assert "--meeting-id" in out
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
uv run --with pytest --with responses --with "psycopg[binary]" \
    pytest tests/zotero_push_test.py -v -k "main or parse_env"
```

Expected: ImportError on `_parse_env_file` and `main`.

- [ ] **Step 3: Replace the skeleton `main` with the full implementation**

Edit `scripts/zotero_push.py`. At the top of the file (after `from __future__`), add:

```python
import argparse
import os
import sys
from pathlib import Path

import psycopg
```

Then *replace* the existing `def main()` skeleton at the bottom of the file with:

```python
REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_ENV_FILE = REPO_ROOT / "web" / ".env.local"


_ENV_LINE_RE = re.compile(r'^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$')


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
    p.add_argument("--paper-id", type=int, required=True,
                   help="papers.id of the paper to push")
    p.add_argument("--meeting-id", type=int, required=True,
                   help="meetings.id whose context becomes the child note")
    return p


def main(argv: Optional[list[str]] = None) -> int:
    args = _build_parser().parse_args(argv)
    env = _load_env()

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
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
uv run --with pytest --with responses --with "psycopg[binary]" \
    pytest tests/zotero_push_test.py -v -k "main or parse_env"
```

Expected: 4 passed.

- [ ] **Step 5: Smoke-test the CLI `--help`**

Run:
```bash
uv run scripts/zotero_push.py --help
```

Expected: argparse help text showing `--paper-id` and `--meeting-id`, exit 0.

- [ ] **Step 6: Run the full test suite**

Run:
```bash
uv run --with pytest --with responses --with "psycopg[binary]" \
    pytest tests/zotero_push_test.py -v
```

Expected: ALL tests pass (count check: ~45 total).

- [ ] **Step 7: Commit**

```bash
git add scripts/zotero_push.py tests/zotero_push_test.py
git commit -m "feat(zotero): CLI main with env loading + soft-fail + command_log"
```

---

## Task 17: Update `web/.env.example`

**Files:**
- Modify: `web/.env.example`

- [ ] **Step 1: Read the current file**

Run:
```bash
cat web/.env.example
```

- [ ] **Step 2: Append the new env vars**

Append to `web/.env.example`:

```
# --- Zotero integration (used by scripts/zotero_push.py via /wids-make-companion) ---
# Generate at https://www.zotero.org/settings/keys with library-write
# access to group 6540956.
ZOTERO_API_KEY=

# Numeric ID of the WiDS NYC Reading Group library.
ZOTERO_GROUP_ID=6540956

# Base URL (no trailing slash) used to build absolute companion links in
# the Zotero child note. Typically the Vercel prod domain.
WIDS_PROD_HOST=https://wids-nyc-reading-group-assistant.vercel.app
```

- [ ] **Step 3: Commit**

```bash
git add web/.env.example
git commit -m "docs(env): document Zotero integration env vars"
```

---

## Task 18: Hook into `/wids-make-companion`

**Files:**
- Modify: `.claude/commands/wids-make-companion.md`

- [ ] **Step 1: Read the current file**

Run:
```bash
cat .claude/commands/wids-make-companion.md
```

Locate the section that runs:
```sql
UPDATE papers SET companion_url = '/papers/' || :id WHERE id = :id;
```

The Zotero push stage will be inserted *immediately after* that UPDATE and *before* the `command_log` insert.

- [ ] **Step 2: Insert the new stage**

Find the block that says (in `wids-make-companion.md`):

```
Then update DB:
```sql
UPDATE papers SET companion_url = '/papers/' || :id WHERE id = :id;
```

If git push fails, leave files staged, tell operator to resolve manually, **do not** update DB.
```

Add a new section *immediately after* it (before the `## Audit log` section):

```markdown
## Zotero push

After the `companion_url` UPDATE succeeds, push the paper to the WiDS NYC
public Zotero group library. This is best-effort — failures do NOT block
the companion artifact from being considered "shipped."

Look up the meeting id for this paper:

```sql
SELECT id FROM meetings WHERE paper_id = :id ORDER BY scheduled_at DESC LIMIT 1;
```

Then run:

```bash
uv run scripts/zotero_push.py \
    --paper-id=:id \
    --meeting-id=:meeting_id
```

Exit codes:
- `0`: pushed (or already in Zotero — idempotent skip).
- `1`: push failed; the script already wrote a `command_log` failure row
  and printed a `/wids-zotero-retry <meeting-id>` hint to stderr. Do
  NOT abort the companion flow — fall through to the audit log step
  with the overall companion status set to `success`.
- `2`: missing env var (configuration error). Same handling as exit 1.
```

- [ ] **Step 3: Verify the patch reads cleanly**

Run:
```bash
git diff .claude/commands/wids-make-companion.md
```

Expected: only an addition (no deletions), inserted between the `companion_url` UPDATE and the `## Audit log` heading.

- [ ] **Step 4: Commit**

```bash
git add .claude/commands/wids-make-companion.md
git commit -m "feat(commands): wire Zotero push into /wids-make-companion as soft-fail step"
```

---

## Task 19: Create `/wids-zotero-retry` slash command

**Files:**
- Create: `.claude/commands/wids-zotero-retry.md`

- [ ] **Step 1: Write the slash command**

Create `.claude/commands/wids-zotero-retry.md`:

```markdown
# /wids-zotero-retry <meeting-id>

Re-run the Zotero push for a meeting whose previous push failed
(visible in `command_log` as a `failure` row with name
`/wids-make-companion:zotero-push`).

This is the documented recovery path printed by `scripts/zotero_push.py`
on failure.

## Inputs

- `<meeting-id>`: the `meetings.id` of the meeting whose paper needs
  to be re-pushed.

## Behavior

Idempotent. If the paper is already in Zotero (either
`papers.zotero_item_key` is set, or the `wids_paper_id:<id>` correlator
finds it on the Zotero side), the script does nothing and exits 0.

## Steps

1. Look up the paper id:

   ```sql
   SELECT paper_id FROM meetings WHERE id = :meeting_id;
   ```

   If `paper_id IS NULL`, abort with: "meeting <id> has no paper assigned."

2. Run the push:

   ```bash
   uv run scripts/zotero_push.py \
       --paper-id=:paper_id \
       --meeting-id=:meeting_id
   ```

3. On exit 0, write `command_log`:

   ```sql
   INSERT INTO command_log (source, name, status, summary)
   VALUES ('slash_command', '/wids-zotero-retry', 'success',
           'Retry succeeded for meeting <meeting_id>, paper <paper_id>.');
   ```

4. On non-zero exit, the script has already written its own
   `command_log` failure row. Surface stderr to the operator and stop —
   do not write a second log row.

## Output

```
Zotero retry: paper <paper-id> -> item <item-key>
```

Or, on failure, the same warning the original push emits (with the
`/wids-zotero-retry` hint).
```

- [ ] **Step 2: Commit**

```bash
git add .claude/commands/wids-zotero-retry.md
git commit -m "feat(commands): add /wids-zotero-retry recovery slash command"
```

---

## Task 20: End-to-end smoke test against real Zotero

**Files:**
- (manual operator action — no code changes)

- [ ] **Step 1: Confirm the Zotero group is configured**

Operator action: open https://www.zotero.org/groups/6540956/settings and verify:
- Library reading: **Anyone** (public library)
- Library editing: **Any group member** (closed-membership editing)

- [ ] **Step 2: Confirm `web/.env.local` has all four keys**

Run:
```bash
grep -E '^(SUPABASE_DB_URL|ZOTERO_API_KEY|ZOTERO_GROUP_ID|WIDS_PROD_HOST)=' web/.env.local | wc -l
```

Expected: `4`.

- [ ] **Step 3: Pick a recent paper to use as the smoke test**

Find the most recent reading_group meeting that has both a `paper_id` and `companion_url`:

```bash
psql "$SUPABASE_DB_URL" -c "
  SELECT m.id AS meeting_id, m.paper_id, p.title, p.zotero_item_key, p.companion_url
  FROM meetings m JOIN papers p ON p.id = m.paper_id
  WHERE m.type = 'reading_group' AND p.companion_url IS NOT NULL
  ORDER BY m.scheduled_at DESC LIMIT 5;
"
```

Pick a row where `zotero_item_key IS NULL` — call its `meeting_id` `$M` and `paper_id` `$P`.

- [ ] **Step 4: Run the push**

Run:
```bash
uv run scripts/zotero_push.py --paper-id=$P --meeting-id=$M
```

Expected stdout: `Zotero push: paper $P -> item XXXXXXXX` (8-char alphanumeric).

- [ ] **Step 5: Verify in Zotero**

Open https://www.zotero.org/groups/6540956/items in a browser. Confirm:
- A new item appears with the paper's title.
- A child note attached to the item with: `WiDS NYC Reading Group`, the
  meeting date in NY time, the leader's name, the topic name(s), and a
  clickable link to `https://wids-nyc-reading-group-assistant.vercel.app/papers/<id>`.
- The item's `Extra` field contains `wids_paper_id:<P>` (and, if arXiv,
  also `arXiv:<id>`).

- [ ] **Step 6: Verify idempotency by re-running**

Run:
```bash
uv run scripts/zotero_push.py --paper-id=$P --meeting-id=$M
```

Expected stdout: `Zotero push: paper $P -> item XXXXXXXX` (same key as before, no new Zotero item created).

Confirm no duplicates in https://www.zotero.org/groups/6540956/items.

- [ ] **Step 7: Verify the DB column was updated**

Run:
```bash
psql "$SUPABASE_DB_URL" -c "SELECT id, zotero_item_key FROM papers WHERE id = $P;"
```

Expected: the same 8-char key from step 4.

- [ ] **Step 8: Final commit (close-out only — no code change)**

If all the manual verifications passed, no commit is needed — the work is done. If any verification revealed a bug, return to the relevant task and fix.

---

## Self-review

### Spec coverage

| Spec section | Covered by |
|---|---|
| Goal: public bibliography | Tasks 11, 12, 14, 20 |
| Decomposition (stage 1 only) | Plan title + spec link in header |
| In-scope: Zotero group library | Task 20 step 1 (operator-side) |
| In-scope: auto push at companion time | Task 18 |
| In-scope: child note with WiDS context | Tasks 10, 12, 14 |
| In-scope: per-source extraction | Tasks 5, 6, 7, 8, 9 |
| In-scope: /wids-zotero-retry | Task 19 |
| Data model: `papers.zotero_item_key` | Task 1 |
| URL normalization | Task 3 |
| Source classification | Task 4 |
| arXiv path | Task 5 |
| DOI-in-URL path | Task 6 |
| citation_doi page-fetch path | Task 6 |
| CrossRef fetch | Task 7 |
| DB fallback | Task 8 |
| `extract_metadata` orchestration | Task 9 |
| `wids_paper_id:<id>` correlator | Task 11 (in `extra`), Task 13 (lookup) |
| Idempotency: DB column check | Task 14 |
| Idempotency: crash-safety lookup | Tasks 13, 14 |
| Auth: `ZOTERO_API_KEY` | Task 16, Task 17 |
| Note format with NY-tz date | Task 10 |
| Soft-fail integration | Task 16 |
| Failure command_log row | Task 15 |
| `/wids-zotero-retry` | Task 19 |
| Three new env vars | Task 16 (loader), Task 17 (docs) |
| Tests: unit, integration | Tasks 3–16 |
| Backfill (deferred) | Out of scope per spec |

No gaps.

### Type / signature consistency

Quick walkthrough of cross-task names:
- `normalize_url(url) -> str` — used in Task 9.
- `classify_url(url) -> str` returning `"arxiv" | "doi_in_url" | "needs_meta_lookup"` — Task 9 dispatches on these exact strings.
- `extract_arxiv_metadata(url) -> dict | None` — Task 9 calls.
- `extract_doi_from_url(url) -> str | None`, `extract_doi_from_meta_tag(url) -> str | None` — Task 9 calls.
- `extract_crossref_metadata(doi, *, paper_url) -> dict | None` — Task 9 calls with kwargs.
- `extract_db_fallback_metadata(conn, *, paper_id) -> dict` — Task 9 calls.
- `extract_metadata(conn, *, paper_id, paper_url) -> dict` — Task 14 calls.
- `build_note_html(*, meeting_at, leader_name, topic_names, companion_path, prod_host) -> str` — Task 14 calls.
- `find_existing_zotero_item(*, paper_id, api_key, group_id) -> str | None` — Task 14 calls.
- `create_zotero_item(*, meta, paper_id, api_key, group_id) -> str` — Task 14 calls.
- `create_zotero_note(*, parent_item_key, note_html, api_key, group_id) -> str` — Task 14 calls.
- `push_to_zotero(conn, *, paper_id, meeting_id, api_key, group_id, prod_host) -> str` — Task 16 calls.
- `record_failure(conn, *, name, error) -> None` — Task 16 calls.

All signatures consistent.

### Placeholder scan

No `TBD`, `TODO`, `implement later`, `add appropriate error handling`, or `similar to Task N` references in the plan. Every step has runnable commands or complete code.
