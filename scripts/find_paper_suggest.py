"""Helper for /wids-find-paper suggest sub-mode.

Reads JSON from stdin, calls Semantic Scholar APIs, computes MMR-diverse
top-N candidates with display rationale, emits JSON to stdout.

See: docs/superpowers/specs/2026-05-06-wids-find-paper-suggest-design.md
"""
from __future__ import annotations

import re

import httpx
import numpy as np
from pydantic import BaseModel
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_random_exponential,
)

S2_GRAPH_BASE = "https://api.semanticscholar.org/graph/v1"
S2_RECS_BASE = "https://api.semanticscholar.org/recommendations/v1"

# Status codes to retry. 429 (rate limit) and 5xx (server). 4xx other than 429
# are not retryable; 200 and 404 are returned to caller for handling.
_RETRYABLE_STATUS = frozenset({429, 500, 502, 503, 504})


class PastPaper(BaseModel):
    paper_id: int
    s2_paper_id: str  # e.g., "ARXIV:1706.03762" or "DOI:10.1080/..."
    title: str


class Input(BaseModel):
    past_papers: list[PastPaper]
    cached_embeddings: dict[str, list[float]]  # str(paper_id) -> vector
    top: int = 10
    limit: int = 50


class EmbeddingToCache(BaseModel):
    paper_id: int
    model: str
    vector: list[float]


class Candidate(BaseModel):
    arxiv_id: str | None = None
    s2_paper_id: str
    title: str
    abstract: str = ""
    authors: list[str] = []
    year: int | None = None
    matched_past_paper_id: int | None = None
    matched_past_paper_title: str | None = None
    cosine: float | None = None


class Output(BaseModel):
    candidates: list[Candidate]
    embeddings_to_cache: list[EmbeddingToCache]
    warnings: list[str]


_ARXIV_RE = re.compile(
    r"arxiv\.org/(?:abs|pdf)/([0-9]{4}\.[0-9]{4,5})(?:v\d+)?(?:\.pdf)?",
    re.IGNORECASE,
)

# Match a DOI: must start with "10." then 4-9 digits, slash, suffix.
_DOI_RE = re.compile(r"\b(10\.\d{4,9}/[^\s/?#]+)", re.IGNORECASE)


def extract_arxiv_id(url: str) -> str | None:
    """Extract a modern arXiv ID (e.g., '2104.05234') from an arXiv URL.

    Handles /abs/ and /pdf/ paths, version suffixes (v1, v2, ...), and
    .pdf extensions. Returns None for non-arXiv URLs or empty input.
    """
    if not url:
        return None
    m = _ARXIV_RE.search(url)
    return m.group(1) if m else None


def extract_doi_from_url(url: str) -> str | None:
    """Extract a DOI of the form '10.NNNN/<suffix>' from a URL.

    Catches Tandfonline-style URLs that embed the full DOI in the path.
    Returns None for URLs that don't contain a literal DOI string —
    notably Nature URLs of the form nature.com/articles/<article-id>
    (where the '10.1038/' prefix is implicit, not in the URL).
    """
    if not url:
        return None
    m = _DOI_RE.search(url)
    return m.group(1) if m else None


def to_s2_paper_id(url: str) -> str | None:
    """Convert a paper URL to a Semantic Scholar paper identifier.

    Returns 'ARXIV:<id>' if the URL is an arXiv URL, 'DOI:<doi>' if a
    DOI is extractable from the URL, or None if neither.
    """
    arxiv_id = extract_arxiv_id(url)
    if arxiv_id:
        return f"ARXIV:{arxiv_id}"
    doi = extract_doi_from_url(url)
    if doi:
        return f"DOI:{doi}"
    return None


def cosine(a: np.ndarray, b: np.ndarray) -> float:
    """Cosine similarity between two vectors.

    Returns 0.0 if either vector has zero norm (defensive guard against NaN).
    """
    norm_a = float(np.linalg.norm(a))
    norm_b = float(np.linalg.norm(b))
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return float(np.dot(a, b) / (norm_a * norm_b))


def max_cosine_match(
    cand_vec: np.ndarray,
    past_vecs: dict[int, np.ndarray],
) -> tuple[int | None, float]:
    """Find the past paper most similar to `cand_vec` and return its
    (paper_id, cosine_score). Returns (None, 0.0) when past_vecs is empty.
    """
    if not past_vecs:
        return (None, 0.0)
    best_id: int | None = None
    best_score = -float("inf")
    for pid, pvec in past_vecs.items():
        score = cosine(cand_vec, pvec)
        if score > best_score:
            best_id = pid
            best_score = score
    return (best_id, best_score)


def mmr_select(
    embeddings: np.ndarray,
    relevance: np.ndarray,
    top_n: int,
    lam: float = 0.6,
) -> list[int]:
    """Greedy Maximal Marginal Relevance selection.

    Args:
        embeddings: shape (N, D) candidate embeddings.
        relevance: shape (N,) relevance scores; higher is better.
        top_n: number of items to select.
        lam: tradeoff weight in [0, 1]. lam=1 is pure relevance; lam=0 is
            pure diversity-from-already-selected (after the first pick).

    Returns:
        list of indices into `embeddings`, in selection order. Length is
        min(top_n, N).
    """
    n = embeddings.shape[0]
    if n == 0:
        return []
    top_n = min(top_n, n)

    # Pre-normalize for fast cosine via dot product.
    norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
    norms[norms == 0.0] = 1.0
    normalized = embeddings / norms

    selected: list[int] = []
    remaining: set[int] = set(range(n))

    while len(selected) < top_n and remaining:
        best_idx: int | None = None
        best_score = -float("inf")
        for i in remaining:
            if selected:
                sims = normalized[selected] @ normalized[i]
                redundancy = float(sims.max())
            else:
                redundancy = 0.0
            score = lam * float(relevance[i]) - (1.0 - lam) * redundancy
            if score > best_score:
                best_idx = i
                best_score = score
        assert best_idx is not None
        selected.append(best_idx)
        remaining.discard(best_idx)

    return selected


@retry(
    stop=stop_after_attempt(3),
    wait=wait_random_exponential(multiplier=1, max=10),
    retry=retry_if_exception_type((httpx.HTTPStatusError, httpx.TransportError)),
    reraise=True,
)
async def _request_with_retry(
    client: httpx.AsyncClient,
    method: str,
    url: str,
    **kwargs,
) -> httpx.Response:
    """Issue an HTTP request with exponential-backoff retry on retryable
    statuses (429, 5xx) and transport errors. Non-retryable statuses
    (including 200 and 404) are returned to the caller without raising.
    """
    resp = await client.request(method, url, **kwargs)
    if resp.status_code in _RETRYABLE_STATUS:
        # Raise so tenacity retries.
        resp.raise_for_status()
    return resp


async def fetch_specter_embedding(
    client: httpx.AsyncClient,
    s2_paper_id: str,
) -> list[float] | None:
    """Fetch the SPECTER2 embedding for a paper from the S2 Graph API.

    Returns None if the paper is not in the S2 corpus (404), the response
    has no embedding field, or the embedding vector is empty.
    """
    url = f"{S2_GRAPH_BASE}/paper/{s2_paper_id}?fields=embedding.specter_v2"
    try:
        resp = await _request_with_retry(client, "GET", url)
    except httpx.HTTPStatusError:
        return None
    if resp.status_code == 404:
        return None
    if resp.status_code != 200:
        return None
    data = resp.json()
    embedding = data.get("embedding")
    if not embedding:
        return None
    vector = embedding.get("vector")
    if not vector:
        return None
    return list(vector)


async def main() -> int:
    """Stub. Real implementation lands in Task 9."""
    return 0


if __name__ == "__main__":
    import asyncio
    raise SystemExit(asyncio.run(main()))
