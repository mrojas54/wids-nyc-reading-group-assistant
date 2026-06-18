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


def test_select_matches_fnv1a_index():
    from scripts.quotes import fnv1a, select_quote
    b = _bundle("q1", "q2", "q3", "q4", "q5")
    ids = ["q1", "q2", "q3", "q4", "q5"]  # eligible_pairs sorts by quote id
    # Recompute the pick from the (separately-pinned) hash — verifies the
    # selection formula + salt concatenation, not call-twice equality.
    assert select_quote(b, 42).quote["id"] == ids[fnv1a("42") % 5]
    assert select_quote(b, 42, "x").quote["id"] == ids[fnv1a("42x") % 5]


def test_select_scatters_across_pool():
    from scripts.quotes import select_quote
    b = _bundle("q1", "q2", "q3", "q4", "q5")
    chosen = {select_quote(b, k).quote["id"] for k in range(200)}
    assert chosen == {"q1", "q2", "q3", "q4", "q5"}  # FNV-1a covers the whole pool


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


def test_eligible_pairs_includes_every_quote_per_author():
    from scripts.quotes import eligible_pairs
    bundle = {
        "version": 1,
        "authors": [
            {"author": {"id": "a1", "name": "A1", "role": "R"},
             "quotes": [
                 {"id": "q1", "text": "t1", "verified": True, "sourceUrl": "https://x"},
                 {"id": "q2", "text": "t2", "verified": True, "sourceUrl": "https://x"},
             ]},
        ],
    }
    assert sorted(s.quote["id"] for s in eligible_pairs(bundle)) == ["q1", "q2"]


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


def test_load_bundle_missing_file_raises_actionable_error(tmp_path):
    import pytest
    from scripts.quotes import load_bundle
    with pytest.raises(RuntimeError, match="build_quotes"):
        load_bundle(tmp_path / "nope.json")


def test_fallback_is_grace_hopper():
    from scripts.quotes import FALLBACK
    assert FALLBACK.author["id"] == "grace-hopper"
    assert FALLBACK.quote["id"] == "hopper-always-done"
    assert FALLBACK.quote["text"].startswith("The most dangerous phrase")
