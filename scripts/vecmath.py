"""Vector helpers shared by the ranking path and the SPECTER2 verification scripts.

One ``cosine`` so the parity numbers the export/verify scripts report describe
the same function that ranks papers in ``find_paper_suggest``. The zero-norm
guard is deliberate: a degenerate embedding scores ``0.0`` everywhere rather
than ``0.0`` in ranking and ``nan`` in verification.

Kept dependency-light (numpy only, no ``from __future__`` features beyond 3.11)
because the SPECTER2 scripts run standalone under ``--no-project --python 3.11``.
"""
from __future__ import annotations

import numpy as np


def cosine(a: np.ndarray, b: np.ndarray) -> float:
    """Cosine similarity between two vectors.

    Returns 0.0 if either vector has zero norm (defensive guard against NaN).
    """
    norm_a = float(np.linalg.norm(a))
    norm_b = float(np.linalg.norm(b))
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return float(np.dot(a, b) / (norm_a * norm_b))
