"""Helper for /wids-find-paper suggest sub-mode.

Reads JSON from stdin, calls Semantic Scholar APIs, computes MMR-diverse
top-N candidates with display rationale, emits JSON to stdout.

See: docs/superpowers/specs/2026-05-06-wids-find-paper-suggest-design.md
"""
from __future__ import annotations

import asyncio
import json
import re
import sys

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


async def fetch_recommendations(
    client: httpx.AsyncClient,
    positive_ids: list[str],
    limit: int,
) -> list[dict]:
    """POST to the S2 Recommendations API and return the recommendedPapers list.

    Returns [] if positive_ids is empty (short-circuits, no HTTP call).
    Raises httpx.HTTPStatusError if all retries exhaust on 5xx/429.
    """
    if not positive_ids:
        return []
    url = (
        f"{S2_RECS_BASE}/papers"
        f"?fields=title,abstract,authors,year,externalIds,embedding.specter_v2"
        f"&limit={limit}"
    )
    body = {"positivePaperIds": list(positive_ids), "negativePaperIds": []}
    resp = await _request_with_retry(client, "POST", url, json=body)
    resp.raise_for_status()
    data = resp.json()
    return list(data.get("recommendedPapers", []))


async def backfill_missing_embeddings(
    client: httpx.AsyncClient,
    past_papers: list[PastPaper],
    cached: dict[int, list[float]],
) -> tuple[dict[int, list[float]], list[str]]:
    """Fetch SPECTER2 embeddings for past papers not present in `cached`.

    Returns (full_embeddings, warnings) where:
      - full_embeddings is `cached` plus any newly-fetched embeddings,
        keyed by paper_id.
      - warnings is a list of human-readable strings describing past
        papers that returned no embedding (excluded from full).
    """
    missing = [p for p in past_papers if p.paper_id not in cached]
    warnings: list[str] = []
    if not missing:
        return (dict(cached), warnings)

    async def _fetch(paper: PastPaper) -> tuple[PastPaper, list[float] | None]:
        emb = await fetch_specter_embedding(client, paper.s2_paper_id)
        return (paper, emb)

    results = await asyncio.gather(*(_fetch(p) for p in missing))
    full = dict(cached)
    for paper, emb in results:
        if emb is None:
            warnings.append(
                f"Past paper id={paper.paper_id} ({paper.s2_paper_id}) "
                f"returned no embedding; excluded from rationale."
            )
            continue
        full[paper.paper_id] = emb
    return (full, warnings)


async def main() -> int:
    """Entry point. Reads Input JSON from stdin, emits Output JSON to stdout.

    Exit codes:
        0 — success (may include warnings, may include zero candidates)
        1 — hard failure (input validation, network unreachable after retries)
    """
    raw = sys.stdin.read()
    try:
        inp = Input.model_validate_json(raw)
    except Exception as exc:
        print(f"Input validation error: {exc}", file=sys.stderr)
        return 1

    cached_int: dict[int, list[float]] = {
        int(k): v for k, v in inp.cached_embeddings.items()
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        # Backfill any missing past-paper embeddings.
        full_past_embs, warnings = await backfill_missing_embeddings(
            client, inp.past_papers, cached_int,
        )

        embeddings_to_cache: list[EmbeddingToCache] = [
            EmbeddingToCache(paper_id=pid, model="specter_v2", vector=vec)
            for pid, vec in full_past_embs.items()
            if pid not in cached_int
        ]

        positive_ids = [p.s2_paper_id for p in inp.past_papers]
        try:
            recs = await fetch_recommendations(client, positive_ids, inp.limit)
        except httpx.HTTPStatusError as exc:
            print(
                f"Semantic Scholar Recommendations API failed: {exc}",
                file=sys.stderr,
            )
            return 1

        if not recs:
            warnings.append(
                "Semantic Scholar Recommendations returned 0 papers."
            )
            output = Output(
                candidates=[],
                embeddings_to_cache=embeddings_to_cache,
                warnings=warnings,
            )
            print(output.model_dump_json())
            return 0

        # Filter to recs with usable SPECTER2 embeddings.
        recs_with_emb = []
        for r in recs:
            emb = (r.get("embedding") or {}).get("vector")
            if emb:
                recs_with_emb.append(r)

        if len(recs_with_emb) < len(recs):
            warnings.append(
                f"{len(recs) - len(recs_with_emb)} of {len(recs)} "
                f"recommendations had no SPECTER2 embedding and were dropped."
            )

        if not recs_with_emb:
            warnings.append("No recommendations had usable embeddings.")
            output = Output(
                candidates=[],
                embeddings_to_cache=embeddings_to_cache,
                warnings=warnings,
            )
            print(output.model_dump_json())
            return 0

        # Build numpy structures for MMR + max-cosine.
        past_vecs_np: dict[int, np.ndarray] = {
            pid: np.array(v, dtype=float) for pid, v in full_past_embs.items()
        }
        cand_embs = np.array(
            [r["embedding"]["vector"] for r in recs_with_emb], dtype=float,
        )
        n = len(recs_with_emb)
        # Trust S2's ordering: relevance = 1 - rank / N.
        relevance = np.array([1.0 - i / n for i in range(n)])

        selected = mmr_select(cand_embs, relevance, top_n=inp.top, lam=0.6)

        # Build typed output candidates.
        candidates: list[Candidate] = []
        title_by_id = {p.paper_id: p.title for p in inp.past_papers}
        for idx in selected:
            r = recs_with_emb[idx]
            cand_vec = cand_embs[idx]
            best_id, best_score = max_cosine_match(cand_vec, past_vecs_np)
            external_ids = r.get("externalIds") or {}
            authors_raw = r.get("authors") or []
            candidates.append(Candidate(
                arxiv_id=external_ids.get("ArXiv"),
                s2_paper_id=r.get("paperId", ""),
                title=r.get("title", ""),
                abstract=r.get("abstract") or "",
                authors=[a.get("name", "") for a in authors_raw],
                year=r.get("year"),
                matched_past_paper_id=best_id,
                matched_past_paper_title=title_by_id.get(best_id) if best_id else None,
                cosine=best_score if best_id is not None else None,
            ))

        output = Output(
            candidates=candidates,
            embeddings_to_cache=embeddings_to_cache,
            warnings=warnings,
        )
        print(output.model_dump_json())
        return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
