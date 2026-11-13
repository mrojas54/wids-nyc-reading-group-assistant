"""Helper for /wids-find-paper suggest: Input JSON on stdin, Output JSON on stdout.

Asks Semantic Scholar for recommendations seeded by past papers, ranks them
with MMR on SPECTER2 embeddings, and names each one's closest past paper.
Design: docs/superpowers/specs/2026-05-06-wids-find-paper-suggest-design.md
"""
from __future__ import annotations

import asyncio
import os
import re
import sys
from pathlib import Path
from typing import Any

import httpx
import numpy as np
from pydantic import BaseModel

# Invoked as `uv run scripts/find_paper_suggest.py`, which puts scripts/ on sys.path
# but not the repo root; the shared helpers live in the package.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.env_file import parse_env_file
from scripts.paper_urls import extract_doi_from_url, has_refused_scheme
from scripts.vecmath import cosine
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_random_exponential,
)

S2_GRAPH_BASE = "https://api.semanticscholar.org/graph/v1"
S2_RECS_BASE = "https://api.semanticscholar.org/recommendations/v1"
# The Graph API's batch endpoint takes at most 500 ids per request.
S2_BATCH_MAX = 500
ENV_FILE = Path(__file__).resolve().parent.parent / "web" / ".env.local"

# 429 and 5xx are retried; every other status goes back to the caller.
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

def extract_arxiv_id(url: str) -> str | None:
    """Modern arXiv id ('2104.05234') from an /abs/ or /pdf/ URL, else None."""
    if not url or has_refused_scheme(url):
        return None
    m = _ARXIV_RE.search(url)
    return m.group(1) if m else None


def to_s2_paper_id(url: str) -> str | None:
    """'ARXIV:<id>' or 'DOI:<doi>' for a paper URL, else None.

    A scheme other than http(s) gives None, since the regexes would otherwise
    match inside `javascript:…#arxiv.org/abs/1706.03762`.
    """
    arxiv_id = extract_arxiv_id(url)
    if arxiv_id:
        return f"ARXIV:{arxiv_id}"
    doi = extract_doi_from_url(url)
    if doi:
        return f"DOI:{doi}"
    return None


def max_cosine_match(
    cand_vec: np.ndarray,
    past_vecs: dict[int, np.ndarray],
) -> tuple[int | None, float]:
    """(paper_id, cosine) of the closest past paper; (None, 0.0) when there are none."""
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
    """Greedy Maximal Marginal Relevance: indices into `embeddings` in pick order.

    `embeddings` is (N, D), `relevance` is (N,). lam=1 ranks by relevance
    alone; lam=0 picks for diversity from what is already selected.
    """
    n = embeddings.shape[0]
    if n == 0:
        return []
    top_n = min(top_n, n)

    # Normalised rows make cosine a dot product.
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
    **kwargs: Any,
) -> httpx.Response:
    """Send a request, retrying 429, 5xx and transport errors with backoff."""
    resp = await client.request(method, url, **kwargs)
    if resp.status_code in _RETRYABLE_STATUS:
        resp.raise_for_status()  # tenacity retries on the raise
    return resp


def s2_api_key() -> str | None:
    """S2_API_KEY from the environment, else from web/.env.local; None if unset.

    Without a key S2 still answers, at a much lower rate limit.
    """
    return os.environ.get("S2_API_KEY") or parse_env_file(ENV_FILE).get("S2_API_KEY") or None


def s2_client(api_key: str | None) -> httpx.AsyncClient:
    headers = {"x-api-key": api_key} if api_key else {}
    return httpx.AsyncClient(timeout=30.0, headers=headers)


def _specter_vector(paper: Any) -> list[float] | None:
    """`embedding.vector` from one Graph API paper object, if it has one."""
    embedding = paper.get("embedding") if isinstance(paper, dict) else None
    vector = embedding.get("vector") if isinstance(embedding, dict) else None
    return list(vector) if vector else None


async def fetch_specter_embeddings(
    client: httpx.AsyncClient,
    s2_paper_ids: list[str],
) -> dict[str, list[float]]:
    """SPECTER2 vectors for the given S2 ids, from the Graph API batch endpoint.

    One request per 500 ids instead of one per paper. Ids S2 doesn't know, or
    that have no embedding, are left out of the result; callers warn about the
    gaps. A request that still fails after retries (429, 5xx or a transport
    error) raises: one failed batch loses every vector, and an empty result
    would read as a successful run with no suggestions.
    """
    ids = list(dict.fromkeys(s2_paper_ids))  # dedupe, keep order
    url = f"{S2_GRAPH_BASE}/paper/batch?fields=embedding.specter_v2"
    out: dict[str, list[float]] = {}
    for start in range(0, len(ids), S2_BATCH_MAX):
        chunk = ids[start:start + S2_BATCH_MAX]
        resp = await _request_with_retry(client, "POST", url, json={"ids": chunk})
        papers: Any = resp.json() if resp.status_code == 200 else None
        if not isinstance(papers, list):
            continue
        # The response lists papers in request order, with null for unknown ids.
        for s2_id, paper in zip(chunk, papers, strict=False):
            vector = _specter_vector(paper)
            if vector:
                out[s2_id] = vector
    return out


async def fetch_recommendations(
    client: httpx.AsyncClient,
    positive_ids: list[str],
    limit: int,
) -> list[dict[str, Any]]:
    """S2 recommendations seeded by `positive_ids`; [] with no HTTP call when empty.

    Raises httpx.HTTPStatusError once retries on 429/5xx are used up.
    """
    if not positive_ids:
        return []
    url = (
        f"{S2_RECS_BASE}/papers"
        f"?fields=title,abstract,authors,year,externalIds"
        f"&limit={limit}"
    )
    body = {"positivePaperIds": list(positive_ids), "negativePaperIds": []}
    resp = await _request_with_retry(client, "POST", url, json=body)
    resp.raise_for_status()
    return list(resp.json().get("recommendedPapers", []))


async def enrich_recommendations_with_embeddings(
    client: httpx.AsyncClient,
    recs: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[str]]:
    """Attach `embedding: {model, vector}` to each rec S2 has a vector for.

    The Recommendations API doesn't return embeddings, so they come from one
    batch Graph API call. Recs without one are returned unchanged; the caller
    filters them out. Returns (recs, warnings).
    """
    warnings: list[str] = []
    if not recs:
        return ([], warnings)

    vectors = await fetch_specter_embeddings(
        client, [r["paperId"] for r in recs if r.get("paperId")],
    )
    enriched = [
        {**r, "embedding": {"model": "specter_v2", "vector": vectors[r["paperId"]]}}
        if r.get("paperId") in vectors else r
        for r in recs
    ]
    missing = sum(1 for r in enriched if "embedding" not in r)
    if missing > 0:
        warnings.append(
            f"{missing} of {len(recs)} recommendations had no SPECTER2 "
            f"embedding available via the Graph API."
        )
    return (enriched, warnings)


async def backfill_missing_embeddings(
    client: httpx.AsyncClient,
    past_papers: list[PastPaper],
    cached: dict[int, list[float]],
) -> tuple[dict[int, list[float]], list[str]]:
    """`cached` plus S2 vectors for past papers missing from it, and warnings.

    A past paper S2 has no vector for gets a warning and is left out.
    """
    missing = [p for p in past_papers if p.paper_id not in cached]
    warnings: list[str] = []
    full = dict(cached)
    if not missing:
        return (full, warnings)

    vectors = await fetch_specter_embeddings(client, [p.s2_paper_id for p in missing])
    for paper in missing:
        vec = vectors.get(paper.s2_paper_id)
        if vec is None:
            warnings.append(
                f"Past paper id={paper.paper_id} ({paper.s2_paper_id}) "
                f"returned no embedding; excluded from rationale."
            )
            continue
        full[paper.paper_id] = vec
    return (full, warnings)


def filter_recs_with_embeddings(
    recs: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Recs that carry a SPECTER2 vector after enrichment."""
    return [r for r in recs if (r.get("embedding") or {}).get("vector")]


def build_candidates(
    recs_with_emb: list[dict[str, Any]],
    past_embeddings: dict[int, list[float]],
    past_papers: list[PastPaper],
    top: int,
) -> list[Candidate]:
    """Pick a diverse top-N by MMR and attach each pick's closest past paper.

    No I/O. Relevance follows S2's order. Every rec must carry
    `embedding.vector` (see `filter_recs_with_embeddings`).
    """
    past_vecs_np: dict[int, np.ndarray] = {
        pid: np.array(v, dtype=float) for pid, v in past_embeddings.items()
    }
    cand_embs = np.array(
        [r["embedding"]["vector"] for r in recs_with_emb], dtype=float,
    )
    n = len(recs_with_emb)
    # Trust S2's ordering: relevance = 1 - rank / N.
    relevance = np.array([1.0 - i / n for i in range(n)])

    selected = mmr_select(cand_embs, relevance, top_n=top, lam=0.6)

    title_by_id = {p.paper_id: p.title for p in past_papers}
    candidates: list[Candidate] = []
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
    return candidates


def _emit(
    candidates: list[Candidate],
    embeddings_to_cache: list[EmbeddingToCache],
    warnings: list[str],
) -> int:
    output = Output(
        candidates=candidates, embeddings_to_cache=embeddings_to_cache, warnings=warnings,
    )
    print(output.model_dump_json())
    return 0


async def _suggest(
    client: httpx.AsyncClient,
    inp: Input,
    cached_int: dict[int, list[float]],
    positive_ids: list[str],
) -> int:
    # The backfill and the recommendations don't depend on each other.
    (full_past_embs, warnings), recs = await asyncio.gather(
        backfill_missing_embeddings(client, inp.past_papers, cached_int),
        fetch_recommendations(client, positive_ids, inp.limit),
    )
    embeddings_to_cache = [
        EmbeddingToCache(paper_id=pid, model="specter_v2", vector=vec)
        for pid, vec in full_past_embs.items()
        if pid not in cached_int
    ]

    if not recs:
        warnings.append("Semantic Scholar Recommendations returned 0 papers.")
        return _emit([], embeddings_to_cache, warnings)

    recs, enrich_warnings = await enrich_recommendations_with_embeddings(client, recs)
    warnings.extend(enrich_warnings)
    recs_with_emb = filter_recs_with_embeddings(recs)
    if not recs_with_emb:
        warnings.append("No recommendations had usable embeddings.")
        return _emit([], embeddings_to_cache, warnings)

    candidates = build_candidates(recs_with_emb, full_past_embs, inp.past_papers, inp.top)
    return _emit(candidates, embeddings_to_cache, warnings)


async def main() -> int:
    """Exit 0 on success (possibly with warnings or no candidates); 1 on bad
    input or when any Semantic Scholar request fails after retries."""
    try:
        inp = Input.model_validate_json(sys.stdin.read())
    except Exception as exc:
        print(f"Input validation error: {exc}", file=sys.stderr)
        return 1

    cached_int = {int(k): v for k, v in inp.cached_embeddings.items()}
    positive_ids = [p.s2_paper_id for p in inp.past_papers]

    try:
        async with s2_client(s2_api_key()) as client:
            return await _suggest(client, inp, cached_int, positive_ids)
    except httpx.HTTPError as exc:
        # Exit 1 rather than an empty success: the command replaces the stored
        # suggestions with whatever an exit-0 run returns.
        print(f"Semantic Scholar request failed after retries: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
