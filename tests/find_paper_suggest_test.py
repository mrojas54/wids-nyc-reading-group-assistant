"""Tests for scripts/find_paper_suggest.py.

Run via:
    uv run --with pytest --with respx --with httpx --with numpy \\
        --with pydantic --with tenacity \\
        pytest tests/find_paper_suggest_test.py -v
"""
from __future__ import annotations

import json

import pytest


def test_module_imports():
    """Smoke test: the script's main entry is importable."""
    from scripts.find_paper_suggest import main
    assert callable(main)


def test_input_model_round_trip():
    from scripts.find_paper_suggest import Input
    payload = {
        "past_papers": [
            {"paper_id": 12, "s2_paper_id": "ARXIV:1706.03762", "title": "Attention"},
        ],
        "cached_embeddings": {"12": [0.1, 0.2, 0.3]},
        "top": 5,
        "limit": 30,
    }
    inp = Input.model_validate(payload)
    assert inp.top == 5
    assert inp.limit == 30
    assert len(inp.past_papers) == 1
    assert inp.past_papers[0].s2_paper_id == "ARXIV:1706.03762"
    assert inp.cached_embeddings["12"] == [0.1, 0.2, 0.3]


def test_input_defaults():
    from scripts.find_paper_suggest import Input
    payload = {"past_papers": [], "cached_embeddings": {}}
    inp = Input.model_validate(payload)
    assert inp.top == 10
    assert inp.limit == 50


def test_output_model_round_trip():
    from scripts.find_paper_suggest import Candidate, EmbeddingToCache, Output
    output = Output(
        candidates=[
            Candidate(
                arxiv_id="2604.12345",
                s2_paper_id="ARXIV:2604.12345",
                title="Test",
                abstract="abs",
                authors=["Alice"],
                year=2026,
                matched_past_paper_id=12,
                matched_past_paper_title="Attention",
                cosine=0.84,
            ),
        ],
        embeddings_to_cache=[
            EmbeddingToCache(paper_id=12, model="specter_v2", vector=[0.1, 0.2]),
        ],
        warnings=["test warning"],
    )
    serialized = output.model_dump_json()
    parsed = json.loads(serialized)
    assert parsed["candidates"][0]["cosine"] == 0.84
    assert parsed["embeddings_to_cache"][0]["model"] == "specter_v2"
    assert parsed["warnings"] == ["test warning"]


# ---------------------- URL parsing ----------------------

@pytest.mark.parametrize("url, expected", [
    # Modern arXiv abs
    ("https://arxiv.org/abs/2104.05234", "2104.05234"),
    # PDF URL
    ("https://arxiv.org/pdf/2104.05234", "2104.05234"),
    ("https://arxiv.org/pdf/2104.05234.pdf", "2104.05234"),
    # Version suffix gets stripped
    ("https://arxiv.org/abs/2104.05234v3", "2104.05234"),
    ("https://arxiv.org/pdf/2104.05234v1.pdf", "2104.05234"),
    # 5-digit suffix
    ("https://arxiv.org/abs/2510.07192", "2510.07192"),
    # Older 4-digit suffix
    ("https://arxiv.org/abs/1003.0146", "1003.0146"),
    # Non-arXiv URLs
    ("https://www.nature.com/articles/s41586-024-08025-4", None),
    ("https://example.com/pdf", None),
    ("", None),
])
def test_extract_arxiv_id(url, expected):
    from scripts.find_paper_suggest import extract_arxiv_id
    assert extract_arxiv_id(url) == expected


@pytest.mark.parametrize("url, expected", [
    # Tandfonline embeds the full DOI
    ("https://www.tandfonline.com/doi/epdf/10.1080/26939169.2023.2276446?needAccess=true",
     "10.1080/26939169.2023.2276446"),
    # Doi.org
    ("https://doi.org/10.1038/s41586-024-08025-4", "10.1038/s41586-024-08025-4"),
    # Nature URL with article ID (no DOI prefix in URL)
    ("https://www.nature.com/articles/s41586-024-08025-4", None),
    # Random PDF
    ("https://www.cs.usfca.edu/~mmalensek/publications/shah2018scalable.pdf", None),
    # arXiv URL — DOI extractor returns None (arxiv extractor handles it)
    ("https://arxiv.org/abs/1706.03762", None),
    ("", None),
])
def test_extract_doi_from_url(url, expected):
    from scripts.find_paper_suggest import extract_doi_from_url
    assert extract_doi_from_url(url) == expected


@pytest.mark.parametrize("url, expected", [
    ("https://arxiv.org/abs/1706.03762", "ARXIV:1706.03762"),
    ("https://www.tandfonline.com/doi/epdf/10.1080/26939169.2023.2276446",
     "DOI:10.1080/26939169.2023.2276446"),
    # Unresolvable
    ("https://www.cs.usfca.edu/~mmalensek/publications/shah2018scalable.pdf", None),
    ("https://www.nature.com/articles/s41586-024-08025-4", None),
])
def test_to_s2_paper_id(url, expected):
    from scripts.find_paper_suggest import to_s2_paper_id
    assert to_s2_paper_id(url) == expected


# ---------------------- Vector math ----------------------

import math

import numpy as np


def test_cosine_identical():
    from scripts.find_paper_suggest import cosine
    a = np.array([1.0, 2.0, 3.0])
    assert math.isclose(cosine(a, a), 1.0, abs_tol=1e-9)


def test_cosine_orthogonal():
    from scripts.find_paper_suggest import cosine
    a = np.array([1.0, 0.0])
    b = np.array([0.0, 1.0])
    assert math.isclose(cosine(a, b), 0.0, abs_tol=1e-9)


def test_cosine_opposite():
    from scripts.find_paper_suggest import cosine
    a = np.array([1.0, 0.0])
    b = np.array([-1.0, 0.0])
    assert math.isclose(cosine(a, b), -1.0, abs_tol=1e-9)


def test_cosine_zero_vector_is_zero():
    """Zero-norm guard: avoid NaN, return 0.0."""
    from scripts.find_paper_suggest import cosine
    a = np.array([0.0, 0.0, 0.0])
    b = np.array([1.0, 2.0, 3.0])
    assert cosine(a, b) == 0.0
    assert cosine(b, a) == 0.0


def test_max_cosine_match_returns_best():
    from scripts.find_paper_suggest import max_cosine_match
    cand = np.array([1.0, 0.0])
    past = {
        10: np.array([1.0, 0.0]),       # cosine 1.0
        20: np.array([0.5, 0.5]),       # cosine ~0.707
        30: np.array([0.0, 1.0]),       # cosine 0.0
    }
    pid, score = max_cosine_match(cand, past)
    assert pid == 10
    assert math.isclose(score, 1.0, abs_tol=1e-9)


def test_max_cosine_match_empty_corpus():
    from scripts.find_paper_suggest import max_cosine_match
    pid, score = max_cosine_match(np.array([1.0, 0.0]), {})
    assert pid is None
    assert score == 0.0


def test_max_cosine_match_single():
    from scripts.find_paper_suggest import max_cosine_match
    cand = np.array([1.0, 0.0])
    pid, score = max_cosine_match(cand, {42: np.array([0.0, 1.0])})
    assert pid == 42
    assert math.isclose(score, 0.0, abs_tol=1e-9)


# ---------------------- MMR ----------------------

def test_mmr_pure_relevance_lambda_one():
    """λ=1 collapses MMR to pure relevance ranking."""
    from scripts.find_paper_suggest import mmr_select
    embs = np.array([[1, 0], [1, 0.01], [0, 1]], dtype=float)  # 0 ≈ 1, both ⊥ to 2
    rel = np.array([0.9, 0.8, 0.7])
    selected = mmr_select(embs, rel, top_n=3, lam=1.0)
    assert selected == [0, 1, 2]  # purely by relevance


def test_mmr_pure_diversity_lambda_zero():
    """λ=0 collapses MMR to pure diversity (after the first pick)."""
    from scripts.find_paper_suggest import mmr_select
    embs = np.array([[1, 0], [1, 0.01], [0, 1]], dtype=float)
    rel = np.array([0.9, 0.8, 0.7])
    selected = mmr_select(embs, rel, top_n=3, lam=0.0)
    # First pick: highest relevance (idx 0).
    # Second pick: most dissimilar to idx 0 — that's idx 2 (orthogonal).
    # Third pick: only idx 1 left.
    assert selected[0] == 0
    assert selected[1] == 2
    assert selected[2] == 1


def test_mmr_top_n_capped_to_pool_size():
    from scripts.find_paper_suggest import mmr_select
    embs = np.array([[1, 0], [0, 1]], dtype=float)
    rel = np.array([0.5, 0.5])
    selected = mmr_select(embs, rel, top_n=10, lam=0.6)
    assert len(selected) == 2


def test_mmr_empty_pool():
    from scripts.find_paper_suggest import mmr_select
    embs = np.zeros((0, 5))
    rel = np.zeros(0)
    assert mmr_select(embs, rel, top_n=3, lam=0.6) == []


def test_mmr_default_lambda_balances():
    """Sanity: with λ=0.6, near-duplicate of the top item gets demoted."""
    from scripts.find_paper_suggest import mmr_select
    # Three candidates: [0] strong, [1] near-dup of [0], [2] orthogonal but lower relevance
    embs = np.array([[1, 0], [0.99, 0.01], [0, 1]], dtype=float)
    rel = np.array([0.9, 0.85, 0.6])
    selected = mmr_select(embs, rel, top_n=2, lam=0.6)
    # First: 0 (highest relevance). Second: 2, not 1 — diversity beats marginal relevance.
    assert selected[0] == 0
    assert selected[1] == 2


# ---------------------- SS embedding fetch ----------------------

import respx
import httpx


@pytest.mark.asyncio
@respx.mock
async def test_fetch_specter_embedding_200():
    from scripts.find_paper_suggest import fetch_specter_embedding
    respx.get(
        "https://api.semanticscholar.org/graph/v1/paper/ARXIV:1706.03762"
        "?fields=embedding.specter_v2"
    ).mock(return_value=httpx.Response(
        200,
        json={
            "paperId": "abc123",
            "embedding": {"model": "specter_v2", "vector": [0.1, 0.2, 0.3]},
        },
    ))
    async with httpx.AsyncClient() as client:
        vec = await fetch_specter_embedding(client, "ARXIV:1706.03762")
    assert vec == [0.1, 0.2, 0.3]


@pytest.mark.asyncio
@respx.mock
async def test_fetch_specter_embedding_404_returns_none():
    """Paper not in S2 corpus — return None, do not retry."""
    from scripts.find_paper_suggest import fetch_specter_embedding
    respx.get(
        "https://api.semanticscholar.org/graph/v1/paper/ARXIV:9999.99999"
        "?fields=embedding.specter_v2"
    ).mock(return_value=httpx.Response(404, json={"error": "Paper not found"}))
    async with httpx.AsyncClient() as client:
        vec = await fetch_specter_embedding(client, "ARXIV:9999.99999")
    assert vec is None


@pytest.mark.asyncio
@respx.mock
async def test_fetch_specter_embedding_no_embedding_field():
    """200 OK but the paper has no embedding indexed yet — return None."""
    from scripts.find_paper_suggest import fetch_specter_embedding
    respx.get(
        "https://api.semanticscholar.org/graph/v1/paper/ARXIV:1234.56789"
        "?fields=embedding.specter_v2"
    ).mock(return_value=httpx.Response(200, json={"paperId": "xyz", "embedding": None}))
    async with httpx.AsyncClient() as client:
        vec = await fetch_specter_embedding(client, "ARXIV:1234.56789")
    assert vec is None


@pytest.mark.asyncio
@respx.mock
async def test_fetch_specter_embedding_429_retries_then_succeeds():
    """One 429, then 200 — tenacity retry path exercises."""
    from scripts.find_paper_suggest import fetch_specter_embedding
    route = respx.get(
        "https://api.semanticscholar.org/graph/v1/paper/ARXIV:1706.03762"
        "?fields=embedding.specter_v2"
    )
    route.side_effect = [
        httpx.Response(429, json={"error": "rate limited"}),
        httpx.Response(200, json={"embedding": {"vector": [0.5, 0.5]}}),
    ]
    async with httpx.AsyncClient() as client:
        vec = await fetch_specter_embedding(client, "ARXIV:1706.03762")
    assert vec == [0.5, 0.5]
    assert route.call_count == 2
