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
- A paper URL is ``http`` or ``https`` and nothing else. ``papers.url`` is
  rendered straight into an ``href`` by the portal (``PaperHero`` on the
  operator schedule rail, among others), so a ``javascript:`` or ``data:``
  value stored there is stored XSS. ``is_http_url`` is the check; migration
  037's ``papers_url_scheme`` CHECK is the backstop in the database.
"""
from __future__ import annotations

import re
from urllib.parse import urlparse

#: ``10.<4-9 digits>/<suffix>`` inside a URL path. Word-boundary anchored so a
#: DOI glued to a preceding token (``x10.1234/...``) does not match.
DOI_IN_PATH_RE = re.compile(r"\b(10\.\d{4,9}/[^\s/?#]+)", re.IGNORECASE)

#: The only schemes a paper URL may use.
HTTP_SCHEMES = frozenset({"http", "https"})

#: Schemes the URL → identifier helpers below will parse. ``doi`` is an
#: identifier prefix rather than a link, so it is read but never stored as a
#: paper URL.
PARSEABLE_SCHEMES = HTTP_SCHEMES | {"doi"}


def is_http_url(url: str) -> bool:
    """Whether ``url`` is an absolute ``http``/``https`` URL.

    A bare identifier (``10.1234/x``, ``2501.12345``) has no scheme and is not
    a URL, so it is False here too — callers that accept bare ids check for
    them before asking.
    """
    if not url:
        return False
    try:
        parsed = urlparse(url.strip())
    except ValueError:
        return False
    return parsed.scheme.lower() in HTTP_SCHEMES and bool(parsed.netloc)


def has_refused_scheme(url: str) -> bool:
    """Whether ``url`` carries a scheme outside :data:`PARSEABLE_SCHEMES`.

    This is the guard for ``javascript:``, ``data:`` and ``file:``. A bare
    identifier (``10.1234/x``, ``2501.12345``) carries no scheme and is not
    refused here, so the helpers that accept one keep working.
    """
    if not url:
        return False
    try:
        scheme = urlparse(url.strip()).scheme.lower()
    except ValueError:
        return True
    return bool(scheme) and scheme not in PARSEABLE_SCHEMES


def is_arxiv_host(netloc: str) -> bool:
    host = netloc.lower().split("@")[-1].split(":")[0]
    return host == "arxiv.org" or host.endswith(".arxiv.org")


def extract_doi_from_url(url: str) -> str | None:
    """Return the DOI literally embedded in ``url``'s path, or ``None``.

    Catches Tandfonline/ACM/doi.org-style URLs that carry the full DOI in the
    path. Returns ``None`` for arXiv URLs and for URLs where the DOI prefix is
    implicit — notably ``nature.com/articles/<article-id>``.
    """
    if not url or has_refused_scheme(url):
        return None
    parsed = urlparse(url)
    if is_arxiv_host(parsed.netloc):
        return None
    m = DOI_IN_PATH_RE.search(parsed.path)
    return m.group(1) if m else None
