"""The pure half of the SPECTER2 export / verify / embed scripts.

Those three scripts need torch, adapters and transformers, run standalone
under ``--no-project --python 3.11``, and are excluded from ``ty`` and never
imported by a test. Everything in them that does *not* need a model lives
here instead — fixture loading and validation, the input-text recipe, and the
parity verdict — so it is unit-tested in CI and shared verbatim rather than
re-typed per script.

Kept numpy-only and 3.11-compatible for the same reason as ``vecmath``.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence

import numpy as np

#: SPECTER2 embeddings are 768-dim; a fixture with any other width is not a
#: SPECTER2 vector, whatever S2 labelled it.
EMBEDDING_DIM = 768


@dataclass(frozen=True)
class Thresholds:
    """A parity gate: the median must clear ``median`` and no fixture may fall
    below ``minimum``. Median rather than mean because a single quantization-
    tail outlier can drag the mean under a threshold while the bulk is healthy;
    the minimum guards the catastrophic case (wrong adapter, tokenizer
    mismatch) while tolerating one outlier."""

    median: float
    minimum: float


#: INT8 dynamic quantization of a 110M-param transformer lands ~0.99 median
#: with occasional ~0.94 outliers — the original 0.997 guess was aspirational.
#: Mirrored in web/lib/suggest/__tests__/parity.test.ts; change both together.
INT8_PARITY = Thresholds(median=0.99, minimum=0.93)

#: FP32-vs-FP32 across what should be the same inference graph: an order of
#: magnitude tighter, because a gap here is a model-config mismatch, not
#: quantization noise.
FP32_PIVOT = Thresholds(median=0.999, minimum=0.998)


class FixtureError(ValueError):
    """A parity fixture file is missing or does not have the expected shape."""


@dataclass(frozen=True)
class Fixture:
    paper_id: str
    title: str
    abstract: str
    vector: np.ndarray  # float32, shape (EMBEDDING_DIM,)


def sep_text(title: str, sep_token: str, abstract: str) -> str:
    """The exact input SPECTER2 was trained on: ``title[SEP]abstract``.

    All three scripts and the WASM path (web/lib/suggest/specter2-wasm.ts)
    build their input this way; a drift here silently changes every vector.
    """
    return f"{title}{sep_token}{abstract}"


def validate_fixture(entry: object, *, index: int = 0) -> Fixture:
    """Turn one raw JSON entry into a :class:`Fixture`, or raise :class:`FixtureError`."""
    where = f"fixture {index}"
    if not isinstance(entry, dict):
        raise FixtureError(f"{where}: expected an object, got {type(entry).__name__}")
    paper_id = entry.get("paperId")
    title = entry.get("title")
    abstract = entry.get("abstract")
    vector = entry.get("vector")
    if not isinstance(paper_id, str) or not paper_id:
        raise FixtureError(f"{where}: 'paperId' must be a non-empty string")
    if not isinstance(title, str):
        raise FixtureError(f"{where} ({paper_id}): 'title' must be a string")
    if not isinstance(abstract, str) or not abstract.strip():
        # An empty abstract feeds SPECTER2 title+SEP only, whose CLS vector is
        # degenerate enough to drift ~0.04 between otherwise identical runs;
        # such a fixture measures noise, not the model. The collector skips
        # them; refuse them here so a hand-edited file cannot reintroduce one.
        raise FixtureError(f"{where} ({paper_id}): 'abstract' must be a non-empty string")
    if not isinstance(vector, list) or len(vector) != EMBEDDING_DIM:
        got = len(vector) if isinstance(vector, list) else type(vector).__name__
        raise FixtureError(f"{where} ({paper_id}): 'vector' must have {EMBEDDING_DIM} entries, got {got}")
    try:
        arr = np.asarray(vector, dtype=np.float32)
    except (TypeError, ValueError) as exc:
        raise FixtureError(f"{where} ({paper_id}): 'vector' is not numeric: {exc}") from exc
    if not np.all(np.isfinite(arr)):
        raise FixtureError(f"{where} ({paper_id}): 'vector' contains NaN or inf")
    if float(np.linalg.norm(arr)) == 0.0:
        raise FixtureError(f"{where} ({paper_id}): 'vector' is all zeros")
    return Fixture(paper_id=paper_id, title=title, abstract=abstract, vector=arr)


def load_fixtures(path: Path, *, minimum: int = 1) -> list[Fixture]:
    """Read and validate ``specter2_parity_fixtures.json``.

    ``minimum`` is the smallest fixture count that makes a parity verdict
    meaningful; the collector warns below 10 and the export script refuses to
    run on an empty file.
    """
    if not path.exists():
        raise FixtureError(f"{path} missing; run scripts/collect_specter2_fixtures.py first")
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise FixtureError(f"{path}: not valid JSON (line {exc.lineno}: {exc.msg})") from exc
    if not isinstance(doc, list):
        raise FixtureError(f"{path}: expected a JSON list of fixtures")
    fixtures = [validate_fixture(entry, index=i) for i, entry in enumerate(doc)]
    if len(fixtures) < minimum:
        raise FixtureError(f"{path}: {len(fixtures)} fixture(s), need at least {minimum}")
    seen: set[str] = set()
    for f in fixtures:
        if f.paper_id in seen:
            raise FixtureError(f"{path}: duplicate paperId {f.paper_id!r}")
        seen.add(f.paper_id)
    return fixtures


@dataclass(frozen=True)
class ParityStats:
    count: int
    mean: float
    median: float
    minimum: float

    def passes(self, thresholds: Thresholds) -> bool:
        return self.median >= thresholds.median and self.minimum >= thresholds.minimum


def parity_stats(sims: Sequence[float]) -> ParityStats:
    """Summarise per-fixture cosine similarities. Empty input is a hard error:
    a verdict over zero fixtures would pass vacuously."""
    if len(sims) == 0:
        raise FixtureError("no similarities to summarise")
    arr = np.asarray(sims, dtype=np.float64)
    if not np.all(np.isfinite(arr)):
        raise FixtureError("similarities contain NaN or inf — a zero-norm vector got through")
    return ParityStats(
        count=int(arr.size),
        mean=float(np.mean(arr)),
        median=float(np.median(arr)),
        minimum=float(np.min(arr)),
    )


def parity_verdict(sims: Sequence[float], thresholds: Thresholds) -> tuple[bool, ParityStats]:
    """``(passed, stats)`` for one parity run."""
    stats = parity_stats(sims)
    return stats.passes(thresholds), stats
