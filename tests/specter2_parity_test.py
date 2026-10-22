"""Tests for the pure half of the SPECTER2 pipeline.

scripts/specter2_parity.py (fixture schema, input recipe, parity verdict) and
the model-free parts of scripts/collect_specter2_fixtures.py (S2 response →
fixture, 429 retry). The torch-backed export/verify/embed scripts import
these same functions, so what is pinned here is what they run. Run via:
    uv run pytest -c tests/pytest.ini tests/specter2_parity_test.py -v
"""
from __future__ import annotations

import json
from pathlib import Path

import httpx
import numpy as np
import pytest
import respx

from scripts import specter2_parity as sp

ROOT = Path(__file__).resolve().parent.parent


def _entry(**overrides):
    base = {
        "paperId": "abc123",
        "title": "A Paper",
        "abstract": "It does things.",
        "vector": [0.1] * sp.EMBEDDING_DIM,
    }
    base.update(overrides)
    return base


# ── Fixture schema ───────────────────────────────────────────────────────────


def test_validate_fixture_happy_path():
    f = sp.validate_fixture(_entry())
    assert f.paper_id == "abc123" and f.title == "A Paper"
    assert f.vector.dtype == np.float32 and f.vector.shape == (sp.EMBEDDING_DIM,)


@pytest.mark.parametrize("bad, needle", [
    ("not an object", "expected an object"),
    (_entry(paperId=""), "paperId"),
    (_entry(paperId=None), "paperId"),
    (_entry(title=None), "title"),
    (_entry(abstract=""), "abstract"),
    (_entry(abstract="   "), "abstract"),
    (_entry(vector=[0.1] * 767), "767"),
    (_entry(vector="x" * 768), "str"),
    (_entry(vector=["x"] * 768), "not numeric"),
    (_entry(vector=[float("nan")] + [0.1] * 767), "NaN"),
    (_entry(vector=[0.0] * 768), "all zeros"),
])
def test_validate_fixture_rejects_malformed_entries(bad, needle):
    with pytest.raises(sp.FixtureError, match=needle):
        sp.validate_fixture(bad, index=3)


def test_load_fixtures_reports_missing_malformed_and_short_files(tmp_path):
    with pytest.raises(sp.FixtureError, match="missing"):
        sp.load_fixtures(tmp_path / "nope.json")
    p = tmp_path / "f.json"
    p.write_text("[{")
    with pytest.raises(sp.FixtureError, match="not valid JSON"):
        sp.load_fixtures(p)
    p.write_text(json.dumps({"not": "a list"}))
    with pytest.raises(sp.FixtureError, match="expected a JSON list"):
        sp.load_fixtures(p)
    p.write_text(json.dumps([_entry()]))
    with pytest.raises(sp.FixtureError, match="need at least 10"):
        sp.load_fixtures(p, minimum=10)
    p.write_text(json.dumps([_entry(), _entry()]))
    with pytest.raises(sp.FixtureError, match="duplicate paperId"):
        sp.load_fixtures(p)


def test_load_fixtures_indexes_the_offending_entry(tmp_path):
    p = tmp_path / "f.json"
    p.write_text(json.dumps([_entry(paperId="ok"), _entry(paperId="bad", abstract="")]))
    with pytest.raises(sp.FixtureError, match=r"fixture 1 \(bad\)"):
        sp.load_fixtures(p)


def test_committed_fixture_file_is_valid_and_large_enough():
    """The file the export script and the parity workflow read must always
    satisfy the schema the scripts assume — and carry enough fixtures for the
    median to mean something (the collector warns below 10)."""
    fixtures = sp.load_fixtures(ROOT / "scripts" / "specter2_parity_fixtures.json", minimum=10)
    assert all(f.vector.shape == (sp.EMBEDDING_DIM,) for f in fixtures)
    assert all(np.linalg.norm(f.vector) > 0 for f in fixtures)


# ── Input recipe ─────────────────────────────────────────────────────────────


def test_sep_text_is_title_sep_abstract_with_no_extra_whitespace():
    assert sp.sep_text("T", "[SEP]", "A") == "T[SEP]A"


def test_wasm_path_builds_its_input_the_same_way():
    """web/lib/suggest/specter2-wasm.ts must agree with sep_text or every WASM
    vector drifts from the fixtures it is compared against."""
    src = (ROOT / "web" / "lib" / "suggest" / "specter2-wasm.ts").read_text(encoding="utf-8")
    assert "`${it.title}${tokenizer.sep_token}${it.abstract}`" in src


def test_torch_scripts_import_the_shared_pure_half():
    for name, needles in {
        "export_specter2_onnx.py": ("load_fixtures", "parity_verdict", "sep_text", "INT8_PARITY"),
        "verify_specter2_local_vs_s2.py": ("load_fixtures", "parity_verdict", "sep_text", "FP32_PIVOT"),
        "embed_specter2_fp32.py": ("sep_text",),
    }.items():
        src = (ROOT / "scripts" / name).read_text(encoding="utf-8")
        assert "from scripts.specter2_parity import" in src, name
        for n in needles:
            assert n in src, (name, n)
        assert 'f"{title}{tok' not in src and "{tok.sep_token}" not in src, name


# ── Parity verdict ───────────────────────────────────────────────────────────


def test_parity_stats_and_verdict():
    passed, stats = sp.parity_verdict([0.995, 0.99, 0.94, 0.999], sp.INT8_PARITY)
    assert passed and stats.count == 4
    assert stats.minimum == pytest.approx(0.94)
    assert stats.median == pytest.approx((0.99 + 0.995) / 2)


def test_median_gate_tolerates_one_outlier_but_min_gate_catches_a_catastrophe():
    ok, _ = sp.parity_verdict([0.995] * 10 + [0.935], sp.INT8_PARITY)
    assert ok
    bad_min, _ = sp.parity_verdict([0.995] * 10 + [0.85], sp.INT8_PARITY)
    assert not bad_min
    bad_median, _ = sp.parity_verdict([0.95] * 11, sp.INT8_PARITY)
    assert not bad_median


def test_fp32_pivot_is_tighter_than_int8_parity():
    assert sp.FP32_PIVOT.median > sp.INT8_PARITY.median
    assert sp.FP32_PIVOT.minimum > sp.INT8_PARITY.minimum


def test_verdict_refuses_empty_or_nan_similarities():
    with pytest.raises(sp.FixtureError, match="no similarities"):
        sp.parity_verdict([], sp.INT8_PARITY)
    with pytest.raises(sp.FixtureError, match="NaN"):
        sp.parity_verdict([0.99, float("nan")], sp.INT8_PARITY)


def test_web_parity_test_pins_the_same_int8_thresholds():
    src = (ROOT / "web" / "lib" / "suggest" / "__tests__" / "parity.test.ts").read_text(encoding="utf-8")
    assert f"PARITY_MEDIAN_THRESHOLD = {sp.INT8_PARITY.median}" in src
    assert f"PARITY_MIN_THRESHOLD = {sp.INT8_PARITY.minimum}" in src


# ── Fixture collector (model-free parts) ─────────────────────────────────────


from scripts import collect_specter2_fixtures as cf


@pytest.mark.parametrize("data, reason", [
    ("nope", "malformed response"),
    ({"paperId": "x"}, "no embedding"),
    ({"paperId": "x", "embedding": {"vector": []}}, "no embedding"),
    ({"paperId": "x", "embedding": {"vector": [0.1] * 768}, "abstract": "  "}, "empty abstract"),
    ({"paperId": "x", "embedding": {"vector": [0.1] * 10}, "abstract": "a"}, "invalid fixture"),
    ({"paperId": "", "embedding": {"vector": [0.1] * 768}, "abstract": "a"}, "invalid fixture"),
])
def test_fixture_from_response_skip_policy(data, reason):
    entry, why = cf.fixture_from_response(data)
    assert entry is None and why is not None and reason in why


def test_fixture_from_response_keeps_a_good_paper_and_strips_whitespace():
    entry, why = cf.fixture_from_response({
        "paperId": "p1", "title": "  T ", "abstract": " A ", "embedding": {"vector": [0.1] * 768},
    })
    assert why is None and entry == {"paperId": "p1", "title": "T", "abstract": "A", "vector": [0.1] * 768}


@pytest.fixture
def no_backoff(monkeypatch):
    from tenacity import wait_none
    monkeypatch.setattr(cf._get_until_not_rate_limited.retry, "wait", wait_none())


@respx.mock
def test_fetch_one_retries_429_with_the_ladder_then_succeeds(no_backoff, capsys):
    route = respx.get(url__regex=r".*/paper/.*").mock(
        side_effect=[httpx.Response(429), httpx.Response(429), httpx.Response(200, json={"paperId": "p"})]
    )
    with httpx.Client() as client:
        resp, err = cf.fetch_one(client, "ARXIV:1003.0146")
    assert err is None and resp is not None and resp.status_code == 200
    assert route.call_count == 3
    out = capsys.readouterr().out
    assert "retrying in 10s" in out and "retrying in 20s" in out


@respx.mock
def test_fetch_one_gives_up_after_the_ladder_is_spent(no_backoff):
    route = respx.get(url__regex=r".*/paper/.*").mock(return_value=httpx.Response(429))
    with httpx.Client() as client:
        resp, err = cf.fetch_one(client, "ARXIV:1003.0146")
    assert resp is not None and resp.status_code == 429
    assert err == f"HTTP 429 after {len(cf.RETRY_BACKOFFS_S)} retries"
    assert route.call_count == len(cf.RETRY_BACKOFFS_S) + 1


@respx.mock
def test_fetch_one_does_not_retry_other_statuses_or_network_errors(no_backoff):
    route = respx.get(url__regex=r".*/paper/.*").mock(return_value=httpx.Response(404))
    with httpx.Client() as client:
        resp, err = cf.fetch_one(client, "ARXIV:x")
    assert resp is not None and resp.status_code == 404 and err is None and route.call_count == 1
    route.mock(side_effect=httpx.ConnectError("down"))
    with httpx.Client() as client:
        resp, err = cf.fetch_one(client, "ARXIV:x")
    assert resp is None and err is not None and "network error" in err


def test_fetch_one_url_encodes_the_id():
    with respx.mock:
        route = respx.get("https://api.semanticscholar.org/graph/v1/paper/DOI%3A10.3390%2Fmath13101551").mock(
            return_value=httpx.Response(200, json={})
        )
        with httpx.Client() as client:
            cf.fetch_one(client, "DOI:10.3390/math13101551")
    assert route.called
