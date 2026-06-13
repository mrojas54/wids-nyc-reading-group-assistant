"""Tests for scripts/quotes.py (FNV-1a + deterministic selection). Run via:
    uv run pytest -c tests/pytest.ini tests/quotes_select_test.py -v
"""
from __future__ import annotations


def test_fnv1a_known_vectors():
    from scripts.quotes import fnv1a
    # Canonical FNV-1a 32-bit test vectors. The TS side asserts the same three,
    # so both implementations are pinned to the identical algorithm.
    assert fnv1a("") == 0x811C9DC5
    assert fnv1a("a") == 0xE40C292C
    assert fnv1a("foobar") == 0xBF9CF968


def _bundle(*ids):
    return {
        "version": 1,
        "authors": [
            {
                "author": {"id": f"a-{qid}", "name": f"Name {qid}", "role": "Role"},
                "quotes": [
                    {"id": qid, "text": f"T {qid}", "verified": True, "sourceUrl": "https://x"}
                ],
            }
            for qid in ids
        ],
    }


def test_select_is_deterministic():
    from scripts.quotes import select_quote
    b = _bundle("q1", "q2", "q3", "q4", "q5")
    assert select_quote(b, 42).quote["id"] == select_quote(b, 42).quote["id"]


def test_select_no_back_to_back_repeat():
    from scripts.quotes import select_quote
    b = _bundle("q1", "q2", "q3", "q4", "q5")
    for k in range(1, 50):
        assert select_quote(b, k).quote["id"] != select_quote(b, k - 1).quote["id"]


def test_select_only_returns_verified():
    from scripts.quotes import select_quote
    b = {
        "version": 1,
        "authors": [
            {"author": {"id": "a1", "name": "A1", "role": "R"},
             "quotes": [{"id": "u", "text": "unverified", "verified": False}]},
            {"author": {"id": "a2", "name": "A2", "role": "R"},
             "quotes": [{"id": "v", "text": "verified", "verified": True, "sourceUrl": "https://x"}]},
        ],
    }
    for k in range(20):
        assert select_quote(b, k).quote["id"] == "v"


def test_select_empty_pool_returns_fallback():
    from scripts.quotes import select_quote, FALLBACK
    assert select_quote({"version": 1, "authors": []}, 5) == FALLBACK


def test_quote_tokens_maps_author_and_quote():
    from scripts.quotes import quote_tokens, Selection
    sel = Selection(
        author={"id": "x", "name": "Ada Lovelace", "role": "Mathematician"},
        quote={"id": "q", "text": "Hello", "verified": True},
    )
    assert quote_tokens(sel) == {
        "quote.text": "Hello",
        "quote.by": "Ada Lovelace",
        "quote.role": "Mathematician",
    }
