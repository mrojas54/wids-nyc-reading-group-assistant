"""URL → identifier helpers shared by the suggest and Zotero paths.

``extract_doi_from_url`` used to exist twice with different policies: the
suggest copy searched the whole URL and had no arXiv rule; the Zotero copy
parsed the URL, refused ``arxiv.org``, and searched only the path. The same
paper could therefore carry one DOI at suggestion time and a different one
(or none) at push time. This module pins one policy for both:

- arXiv URLs never yield a DOI (arXiv ids look enough like DOI suffixes to
  produce false matches, and the arXiv extractors own those URLs).
- Only the path is searched — never the query string or fragment, which
  carry tracking parameters, and never the host.
- The DOI suffix stops at the next ``/``: a trailing path segment such as
  ``/full`` or ``/abstract`` is publisher routing, not part of the DOI.
"""
from __future__ import annotations

import re
from urllib.parse import urlparse

#: ``10.<4-9 digits>/<suffix>`` inside a URL path. Word-boundary anchored so a
#: DOI glued to a preceding token (``x10.1234/...``) does not match.
DOI_IN_PATH_RE = re.compile(r"\b(10\.\d{4,9}/[^\s/?#]+)", re.IGNORECASE)


def is_arxiv_host(netloc: str) -> bool:
    host = netloc.lower().split("@")[-1].split(":")[0]
    return host == "arxiv.org" or host.endswith(".arxiv.org")


def extract_doi_from_url(url: str) -> str | None:
    """Return the DOI literally embedded in ``url``'s path, or ``None``.

    Catches Tandfonline/ACM/doi.org-style URLs that carry the full DOI in the
    path. Returns ``None`` for arXiv URLs and for URLs where the DOI prefix is
    implicit — notably ``nature.com/articles/<article-id>``.
    """
    if not url:
        return None
    parsed = urlparse(url)
    if is_arxiv_host(parsed.netloc):
        return None
    m = DOI_IN_PATH_RE.search(parsed.path)
    return m.group(1) if m else None
