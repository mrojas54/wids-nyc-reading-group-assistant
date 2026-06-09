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


# ---------------------- candidate assembly ----------------------
# These two helpers were extracted from main() so the ranking/assembly stage
# is testable without mocking the async HTTP pipeline.

def test_filter_recs_with_embeddings_keeps_only_vectored():
    from scripts.find_paper_suggest import filter_recs_with_embeddings
    recs = [
        {"paperId": "a", "embedding": {"vector": [0.1, 0.2]}},  # keep
        {"paperId": "b", "embedding": {"vector": []}},          # drop: empty vector
        {"paperId": "c", "embedding": None},                    # drop: enrich failed
        {"paperId": "d"},                                       # drop: never enriched
    ]
    kept = filter_recs_with_embeddings(recs)
    assert [r["paperId"] for r in kept] == ["a"]


def test_build_candidates_ranks_and_matches_closest_past_paper():
    from scripts.find_paper_suggest import PastPaper, build_candidates
    # Two orthogonal candidates; each should match the past paper it aligns with.
    recs_with_emb = [
        {
            "paperId": "rec-x",
            "title": "Candidate X",
            "abstract": "Abstract X",
            "year": 2026,
            "authors": [{"name": "Xavier"}],
            "externalIds": {"ArXiv": "2604.00001"},
            "embedding": {"vector": [1.0, 0.0]},
        },
        {
            "paperId": "rec-y",
            "title": "Candidate Y",
            "abstract": "Abstract Y",
            "year": 2025,
            "authors": [{"name": "Yvonne"}],
            "externalIds": {},
            "embedding": {"vector": [0.0, 1.0]},
        },
    ]
    past_embeddings = {11: [1.0, 0.0], 22: [0.0, 1.0]}
    past_papers = [
        PastPaper(paper_id=11, s2_paper_id="ARXIV:1", title="Past Eleven"),
        PastPaper(paper_id=22, s2_paper_id="ARXIV:2", title="Past Twenty-two"),
    ]

    candidates = build_candidates(recs_with_emb, past_embeddings, past_papers, top=2)

    by_title = {c.title: c for c in candidates}
    assert set(by_title) == {"Candidate X", "Candidate Y"}

    cand_x = by_title["Candidate X"]
    assert cand_x.matched_past_paper_id == 11
    assert cand_x.matched_past_paper_title == "Past Eleven"
    assert cand_x.cosine is not None and cand_x.cosine > 0.99
    assert cand_x.arxiv_id == "2604.00001"
    assert cand_x.authors == ["Xavier"]

    cand_y = by_title["Candidate Y"]
    assert cand_y.matched_past_paper_id == 22
    assert cand_y.arxiv_id is None  # no ArXiv external id


def test_build_candidates_respects_top_n():
    from scripts.find_paper_suggest import PastPaper, build_candidates
    recs_with_emb = [
        {"paperId": f"r{i}", "title": f"C{i}", "embedding": {"vector": [1.0, float(i)]}}
        for i in range(5)
    ]
    past_papers = [PastPaper(paper_id=1, s2_paper_id="ARXIV:1", title="P")]
    candidates = build_candidates(
        recs_with_emb, {1: [1.0, 0.0]}, past_papers, top=3,
    )
    assert len(candidates) == 3


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


# ---------------------- SS recommendations ----------------------

@pytest.mark.asyncio
@respx.mock
async def test_fetch_recommendations_200():
    from scripts.find_paper_suggest import fetch_recommendations
    expected_url = (
        "https://api.semanticscholar.org/recommendations/v1/papers"
        "?fields=title,abstract,authors,year,externalIds"
        "&limit=50"
    )
    route = respx.post(expected_url).mock(return_value=httpx.Response(
        200,
        json={
            "recommendedPapers": [
                {
                    "paperId": "abc",
                    "title": "Rec 1",
                    "abstract": "abs1",
                    "year": 2026,
                    "externalIds": {"ArXiv": "2604.12345"},
                    "authors": [{"name": "Alice"}],
                },
            ],
        },
    ))
    async with httpx.AsyncClient() as client:
        recs = await fetch_recommendations(
            client, ["ARXIV:1706.03762", "ARXIV:2211.14730"], limit=50,
        )
    assert len(recs) == 1
    assert recs[0]["title"] == "Rec 1"
    assert route.call_count == 1
    # Verify request body contained the positive ids.
    sent = route.calls[0].request
    assert b'"positivePaperIds":["ARXIV:1706.03762","ARXIV:2211.14730"]' in sent.content


@pytest.mark.asyncio
@respx.mock
async def test_fetch_recommendations_empty_response():
    from scripts.find_paper_suggest import fetch_recommendations
    respx.post(
        "https://api.semanticscholar.org/recommendations/v1/papers"
        "?fields=title,abstract,authors,year,externalIds"
        "&limit=50"
    ).mock(return_value=httpx.Response(200, json={"recommendedPapers": []}))
    async with httpx.AsyncClient() as client:
        recs = await fetch_recommendations(client, ["ARXIV:1706.03762"], limit=50)
    assert recs == []


@pytest.mark.asyncio
async def test_fetch_recommendations_no_positives_short_circuits():
    """No HTTP call is made when positive list is empty."""
    from scripts.find_paper_suggest import fetch_recommendations
    async with httpx.AsyncClient() as client:
        recs = await fetch_recommendations(client, [], limit=50)
    assert recs == []


@pytest.mark.asyncio
@respx.mock
async def test_fetch_recommendations_5xx_retries_exhaust():
    from scripts.find_paper_suggest import fetch_recommendations
    route = respx.post(
        "https://api.semanticscholar.org/recommendations/v1/papers"
        "?fields=title,abstract,authors,year,externalIds"
        "&limit=50"
    ).mock(return_value=httpx.Response(503, json={"error": "unavailable"}))
    async with httpx.AsyncClient() as client:
        with pytest.raises(httpx.HTTPStatusError):
            await fetch_recommendations(client, ["ARXIV:1706.03762"], limit=50)
    assert route.call_count == 3  # 3 attempts total


# ---------------------- Embedding backfill ----------------------

@pytest.mark.asyncio
@respx.mock
async def test_backfill_no_missing():
    """If everything is cached, no HTTP calls are made."""
    from scripts.find_paper_suggest import (
        PastPaper, backfill_missing_embeddings,
    )
    past = [
        PastPaper(paper_id=1, s2_paper_id="ARXIV:1706.03762", title="t1"),
        PastPaper(paper_id=2, s2_paper_id="ARXIV:2211.14730", title="t2"),
    ]
    cached = {1: [0.1, 0.2], 2: [0.3, 0.4]}
    async with httpx.AsyncClient() as client:
        full, warnings = await backfill_missing_embeddings(client, past, cached)
    assert full == cached
    assert warnings == []


@pytest.mark.asyncio
@respx.mock
async def test_backfill_fetches_only_missing():
    from scripts.find_paper_suggest import (
        PastPaper, backfill_missing_embeddings,
    )
    respx.get(
        "https://api.semanticscholar.org/graph/v1/paper/ARXIV:2211.14730"
        "?fields=embedding.specter_v2"
    ).mock(return_value=httpx.Response(
        200, json={"embedding": {"vector": [0.7, 0.8]}}
    ))
    past = [
        PastPaper(paper_id=1, s2_paper_id="ARXIV:1706.03762", title="t1"),
        PastPaper(paper_id=2, s2_paper_id="ARXIV:2211.14730", title="t2"),
    ]
    cached = {1: [0.1, 0.2]}
    async with httpx.AsyncClient() as client:
        full, warnings = await backfill_missing_embeddings(client, past, cached)
    assert full[1] == [0.1, 0.2]
    assert full[2] == [0.7, 0.8]
    assert warnings == []


@pytest.mark.asyncio
@respx.mock
async def test_backfill_warns_on_missing():
    """When S2 has no embedding, we warn and exclude that past paper from `full`."""
    from scripts.find_paper_suggest import (
        PastPaper, backfill_missing_embeddings,
    )
    respx.get(
        "https://api.semanticscholar.org/graph/v1/paper/DOI:10.1080/foo"
        "?fields=embedding.specter_v2"
    ).mock(return_value=httpx.Response(404))
    past = [PastPaper(paper_id=99, s2_paper_id="DOI:10.1080/foo", title="missing")]
    async with httpx.AsyncClient() as client:
        full, warnings = await backfill_missing_embeddings(client, past, {})
    assert 99 not in full
    assert len(warnings) == 1
    assert "99" in warnings[0]
    assert "DOI:10.1080/foo" in warnings[0]


# ---------------------- Recommendation enrichment ----------------------

@pytest.mark.asyncio
@respx.mock
async def test_enrich_recommendations_happy_path():
    from scripts.find_paper_suggest import enrich_recommendations_with_embeddings
    respx.get(
        "https://api.semanticscholar.org/graph/v1/paper/abc?fields=embedding.specter_v2"
    ).mock(return_value=httpx.Response(
        200, json={"embedding": {"vector": [0.1, 0.2]}}
    ))
    recs = [{"paperId": "abc", "title": "Rec A"}]
    async with httpx.AsyncClient() as client:
        enriched, warnings = await enrich_recommendations_with_embeddings(client, recs)
    assert enriched[0]["embedding"]["vector"] == [0.1, 0.2]
    assert enriched[0]["embedding"]["model"] == "specter_v2"
    assert warnings == []


@pytest.mark.asyncio
@respx.mock
async def test_enrich_recommendations_some_missing():
    from scripts.find_paper_suggest import enrich_recommendations_with_embeddings
    respx.get(
        "https://api.semanticscholar.org/graph/v1/paper/found?fields=embedding.specter_v2"
    ).mock(return_value=httpx.Response(
        200, json={"embedding": {"vector": [0.5]}}
    ))
    respx.get(
        "https://api.semanticscholar.org/graph/v1/paper/missing?fields=embedding.specter_v2"
    ).mock(return_value=httpx.Response(404))
    recs = [
        {"paperId": "found", "title": "Found"},
        {"paperId": "missing", "title": "Missing"},
    ]
    async with httpx.AsyncClient() as client:
        enriched, warnings = await enrich_recommendations_with_embeddings(client, recs)
    assert enriched[0]["embedding"]["vector"] == [0.5]
    assert "embedding" not in enriched[1]
    assert len(warnings) == 1
    assert "1 of 2" in warnings[0]


@pytest.mark.asyncio
async def test_enrich_recommendations_empty_short_circuits():
    from scripts.find_paper_suggest import enrich_recommendations_with_embeddings
    async with httpx.AsyncClient() as client:
        enriched, warnings = await enrich_recommendations_with_embeddings(client, [])
    assert enriched == []
    assert warnings == []


# ---------------------- End-to-end golden test ----------------------

@pytest.mark.asyncio
@respx.mock
async def test_main_e2e_happy_path(monkeypatch, capsys):
    """Feed Input JSON via stdin, mock SS endpoints, assert Output JSON."""
    from scripts.find_paper_suggest import main

    # Past paper 12 already cached; past paper 17 needs backfill.
    respx.get(
        "https://api.semanticscholar.org/graph/v1/paper/ARXIV:2211.14730"
        "?fields=embedding.specter_v2"
    ).mock(return_value=httpx.Response(
        200, json={"embedding": {"vector": [1.0, 0.0]}}
    ))

    # Recommendations: two candidates without embeddings (recs API doesn't return them).
    respx.post(
        "https://api.semanticscholar.org/recommendations/v1/papers"
        "?fields=title,abstract,authors,year,externalIds"
        "&limit=50"
    ).mock(return_value=httpx.Response(200, json={
        "recommendedPapers": [
            {
                "paperId": "rec-a",
                "title": "Candidate A",
                "abstract": "Abstract A",
                "year": 2026,
                "authors": [{"name": "Alice"}],
                "externalIds": {"ArXiv": "2604.12345"},
            },
            {
                "paperId": "rec-b",
                "title": "Candidate B",
                "abstract": "Abstract B",
                "year": 2026,
                "authors": [{"name": "Bob"}],
                "externalIds": {"ArXiv": "2604.67890"},
            },
        ],
    }))
    # Per-rec embedding fetches via Graph API
    respx.get(
        "https://api.semanticscholar.org/graph/v1/paper/rec-a?fields=embedding.specter_v2"
    ).mock(return_value=httpx.Response(
        200, json={"embedding": {"vector": [0.99, 0.01]}}
    ))
    respx.get(
        "https://api.semanticscholar.org/graph/v1/paper/rec-b?fields=embedding.specter_v2"
    ).mock(return_value=httpx.Response(
        200, json={"embedding": {"vector": [0.0, 1.0]}}
    ))

    input_payload = {
        "past_papers": [
            {"paper_id": 12, "s2_paper_id": "ARXIV:1706.03762", "title": "Attention"},
            {"paper_id": 17, "s2_paper_id": "ARXIV:2211.14730", "title": "PatchTST"},
        ],
        "cached_embeddings": {"12": [1.0, 0.0]},  # close to candidate A
        "top": 2,
        "limit": 50,
    }
    monkeypatch.setattr("sys.stdin", _StdinStub(json.dumps(input_payload)))

    rc = await main()
    assert rc == 0

    captured = capsys.readouterr()
    output = json.loads(captured.out)

    # Both candidates returned (top=2)
    assert len(output["candidates"]) == 2
    titles = {c["title"] for c in output["candidates"]}
    assert titles == {"Candidate A", "Candidate B"}

    # Candidate A is most similar to past paper 12 (Attention) — cosine ~1.0
    cand_a = next(c for c in output["candidates"] if c["title"] == "Candidate A")
    assert cand_a["matched_past_paper_id"] == 12
    assert cand_a["matched_past_paper_title"] == "Attention"
    assert cand_a["cosine"] > 0.9
    assert cand_a["arxiv_id"] == "2604.12345"

    # Newly-fetched embedding (paper 17) appears in embeddings_to_cache
    cached_pids = {e["paper_id"] for e in output["embeddings_to_cache"]}
    assert 17 in cached_pids
    assert 12 not in cached_pids  # already cached, not re-emitted

    # No warnings on the happy path
    assert output["warnings"] == []


class _StdinStub:
    """Minimal stdin replacement for monkeypatching."""

    def __init__(self, content: str) -> None:
        self._content = content

    def read(self) -> str:
        return self._content


@pytest.mark.asyncio
async def test_main_invalid_input_returns_1(monkeypatch, capsys):
    from scripts.find_paper_suggest import main
    monkeypatch.setattr("sys.stdin", _StdinStub("not valid json"))
    rc = await main()
    assert rc == 1
    captured = capsys.readouterr()
    assert "Input validation error" in captured.err
