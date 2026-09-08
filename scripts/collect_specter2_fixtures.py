#!/usr/bin/env python3
"""One-shot: collect parity fixtures from S2 for ~20 papers picked from
papers.s2_paper_id (resolved subset).

Run: uv run --with httpx python scripts/collect_specter2_fixtures.py

Writes scripts/specter2_parity_fixtures.json with each entry shaped:
  { "paperId", "title", "abstract", "vector" (768-dim) }

Calls S2 unauthenticated, sleeps 1s between requests to stay under the
public-tier rate limit. Papers without an embedding (S2 hasn't computed
one yet — common for very recent preprints) are skipped with a log line;
the export script's parity check needs at least ~10 successful fixtures.
"""
import json
import sys
import time
import urllib.parse
from pathlib import Path

# Invoked as `python scripts/<this>.py`; the shared fixture schema lives in the package.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_chain, wait_fixed

from scripts.specter2_parity import FixtureError, validate_fixture

S2_BASE = "https://api.semanticscholar.org/graph/v1"
OUT = Path(__file__).resolve().parent / "specter2_parity_fixtures.json"

# Hand-picked from the 27 backfilled rows in papers.s2_paper_id.
# Older ARXIV ones first (most likely to be in S2's corpus with embeddings),
# then newer ARXIV, then DOIs, then S2 corpus hashes. The script tolerates
# misses — anything S2 doesn't have an embedding for is logged and skipped.
CANDIDATES: list[str] = [
    "ARXIV:1003.0146",   # 2010 — Contextual Bandits
    "ARXIV:1704.04110",  # 2017 — DeepAR
    "ARXIV:1706.06978",  # 2017 — Deep Interest Network
    "ARXIV:1912.09363",  # 2019 — Temporal Fusion Transformers
    "ARXIV:2006.11632",  # 2020 — Embedding-based Retrieval at Facebook
    "ARXIV:2207.05302",  # 2022 — Causal Conceptions of Fairness
    "ARXIV:2211.14730",  # 2022 — PatchTST
    "ARXIV:2303.16634",  # 2023 — G-EVAL
    "ARXIV:2307.12019",  # 2023 — XWalk
    "ARXIV:2310.10688",  # 2023 — TimesFM
    "ARXIV:2405.02411",  # 2024 — Socially Aware Language Technologies
    "ARXIV:2406.00384",  # 2024 — CapeX
    "ARXIV:2502.02943",  # 2025 — Behavioral Homophily
    "ARXIV:2510.07192",  # 2025 — Poisoning Attacks on LLMs
    "DOI:10.3390/math13101551",
    "DOI:10.1038/s41586-024-08025-4",
    "DOI:10.1080/26939169.2023.2276446",
    "b79a55495f7a7c233a4e8af1bea1ec9091e63677",
    "d367d32bb1cf0c0ceb5c4ad1d4dc547c196dc4fa",
    "a24d9954d515f93e46ea1c620391580c73eafab7",
    "bd736e11fae4d0194845f389a285fbccc409dc3f",
]


BASE_DELAY_S = 5         # baseline sleep between successful requests
RETRY_BACKOFFS_S = [10, 20, 40]   # 429 retries: total ~70s of patience per paper


class _RateLimited(Exception):
    """S2 answered 429; tenacity retries on this and nothing else."""

    def __init__(self, resp: httpx.Response) -> None:
        super().__init__(f"HTTP {resp.status_code}")
        self.resp = resp


def _log_retry(state) -> None:  # tenacity RetryCallState
    backoff = RETRY_BACKOFFS_S[min(state.attempt_number - 1, len(RETRY_BACKOFFS_S) - 1)]
    print(f"  -> 429, retrying in {backoff}s (attempt {state.attempt_number + 1})", flush=True)


#: tenacity, like find_paper_suggest and gmail_raw_drafts — one retry idiom in
#: scripts/. The public S2 tier is slow to forgive, so the waits are the fixed
#: 10/20/40 s ladder rather than a random exponential.
_s2_retry = retry(
    retry=retry_if_exception_type(_RateLimited),
    wait=wait_chain(*(wait_fixed(s) for s in RETRY_BACKOFFS_S)),
    stop=stop_after_attempt(len(RETRY_BACKOFFS_S) + 1),
    before_sleep=_log_retry,
    reraise=True,
)


@_s2_retry
def _get_until_not_rate_limited(client: httpx.Client, url: str) -> httpx.Response:
    resp = client.get(url)
    if resp.status_code == 429:
        raise _RateLimited(resp)
    return resp


def fetch_one(client: httpx.Client, s2_id: str) -> tuple[httpx.Response | None, str | None]:
    """Fetch one paper, retrying on 429 with backoff. Returns (response, error_reason)."""
    encoded = urllib.parse.quote(s2_id, safe="")
    url = f"{S2_BASE}/paper/{encoded}?fields=paperId,title,abstract,embedding.specter_v2"
    try:
        return _get_until_not_rate_limited(client, url), None
    except _RateLimited as e:
        return e.resp, f"HTTP 429 after {len(RETRY_BACKOFFS_S)} retries"
    except httpx.HTTPError as e:
        return None, f"network error: {e}"


def fixture_from_response(data: object) -> tuple[dict | None, str | None]:
    """Turn one S2 paper document into a fixture entry, or ``(None, reason)``.

    Pure, so the skip policy (no embedding, empty abstract, malformed) is
    unit-tested; ``main()`` only adds the pacing sleeps and the log line.
    """
    if not isinstance(data, dict):
        return None, "malformed response"
    emb = data.get("embedding") or {}
    vec = emb.get("vector") if isinstance(emb, dict) else None
    if not vec:
        return None, "no embedding"
    raw_abstract = data.get("abstract")
    abstract = raw_abstract.strip() if isinstance(raw_abstract, str) else ""
    # Skip empty-abstract papers: SPECTER2 fed only title+SEP produces
    # a degenerate CLS vector that drifts up to cos ~0.04 between local
    # FP32 and S2's served vector (any tiny attention-mask or kernel-
    # order difference compounds on all-padding tokens). Such fixtures
    # don't exercise the model meaningfully and pollute parity metrics.
    if not abstract:
        return None, "empty abstract"
    entry = {
        "paperId": data.get("paperId"),
        "title": raw_title.strip() if isinstance(raw_title := data.get("title"), str) else "",
        "abstract": abstract,
        "vector": vec,
    }
    try:
        validate_fixture(entry)
    except FixtureError as exc:
        return None, f"invalid fixture: {exc}"
    return entry, None


def main() -> int:
    fixtures = []
    skipped: list[tuple[str, str]] = []
    with httpx.Client(timeout=30, headers={"User-Agent": "wids-nyc-reading-group/parity-collector"}) as client:
        for i, s2_id in enumerate(CANDIDATES, start=1):
            print(f"[{i}/{len(CANDIDATES)}] {s2_id}", end=" ... ", flush=True)
            resp, err = fetch_one(client, s2_id)
            if resp is None:
                print(err)
                skipped.append((s2_id, err or "unknown"))
                time.sleep(BASE_DELAY_S)
                continue
            if resp.status_code != 200:
                print(f"HTTP {resp.status_code}")
                skipped.append((s2_id, f"HTTP {resp.status_code}"))
                time.sleep(BASE_DELAY_S)
                continue
            entry, reason = fixture_from_response(resp.json())
            if entry is None:
                print(reason)
                skipped.append((s2_id, reason or "unknown"))
                time.sleep(BASE_DELAY_S)
                continue
            fixtures.append(entry)
            print(f"OK ({len(entry['vector'])}-dim, {len(fixtures)} kept)")
            time.sleep(BASE_DELAY_S)
    OUT.write_text(json.dumps(fixtures, indent=2))
    print(f"\nWrote {OUT}: {len(fixtures)} fixtures, {len(skipped)} skipped.")
    if skipped:
        print("Skipped:")
        for s2_id, reason in skipped:
            print(f"  - {s2_id}: {reason}")
    if len(fixtures) < 10:
        print(f"\nWARNING: only {len(fixtures)} fixtures collected. The parity test ", file=sys.stderr)
        print("typically needs >= 10 to be statistically meaningful. Consider ", file=sys.stderr)
        print("expanding CANDIDATES with additional well-established arXiv IDs.", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
