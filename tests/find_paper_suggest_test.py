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
