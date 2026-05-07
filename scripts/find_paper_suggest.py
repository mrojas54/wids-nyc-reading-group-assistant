"""Helper for /wids-find-paper suggest sub-mode.

Reads JSON from stdin, calls Semantic Scholar APIs, computes MMR-diverse
top-N candidates with display rationale, emits JSON to stdout.

See: docs/superpowers/specs/2026-05-06-wids-find-paper-suggest-design.md
"""
from __future__ import annotations

from pydantic import BaseModel


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


async def main() -> int:
    """Stub. Real implementation lands in Task 9."""
    return 0


if __name__ == "__main__":
    import asyncio
    raise SystemExit(asyncio.run(main()))
