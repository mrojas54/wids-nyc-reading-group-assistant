"""Tests for scripts/build_arxiv_taxonomy.py.

Run via:
    uv run --with pytest --with httpx --with beautifulsoup4 \
        pytest tests/build_arxiv_taxonomy_test.py -v
"""
from __future__ import annotations


def test_archive_of_splits_on_first_dot():
    from scripts.build_arxiv_taxonomy import archive_of
    assert archive_of("cs.LG") == "cs"
    assert archive_of("q-bio.PE") == "q-bio"
    assert archive_of("econ.TH") == "econ"
    assert archive_of("astro-ph.CO") == "astro-ph"
    # dotless archive code -> whole string
    assert archive_of("hep-th") == "hep-th"


def test_is_relevant_uses_archive_allowlist():
    from scripts.build_arxiv_taxonomy import is_relevant
    assert is_relevant("cs.LG") is True
    assert is_relevant("stat.ML") is True
    assert is_relevant("eess.SP") is True
    assert is_relevant("q-fin.PM") is True
    assert is_relevant("astro-ph.CO") is False
    assert is_relevant("hep-th") is False


import pathlib

FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "arxiv_taxonomy.html"


def _parse_fixture():
    from scripts.build_arxiv_taxonomy import parse_taxonomy
    return parse_taxonomy(FIXTURE.read_text(encoding="utf-8"))


def test_parse_extracts_all_categories():
    cats = _parse_fixture()
    by_code = {c.code: c for c in cats}
    assert set(by_code) == {"cs.AI", "cs.LG", "math.AG", "stat.ML", "astro-ph.CO"}


def test_parse_resolves_code_name_pairs():
    by_code = {c.code: c for c in _parse_fixture()}
    assert by_code["cs.AI"].name == "Artificial Intelligence"
    assert by_code["stat.ML"].name == "Machine Learning"
    assert by_code["math.AG"].name == "Algebraic Geometry"


def test_parse_captures_group_and_description():
    by_code = {c.code: c for c in _parse_fixture()}
    assert by_code["cs.LG"].group == "Computer Science"
    assert by_code["astro-ph.CO"].group == "Physics"
    assert by_code["cs.LG"].description.startswith("Papers on all aspects")


def test_parse_sets_relevance_flag():
    by_code = {c.code: c for c in _parse_fixture()}
    assert by_code["cs.LG"].relevant is True
    assert by_code["stat.ML"].relevant is True
    assert by_code["astro-ph.CO"].relevant is False


def test_parse_returns_codes_sorted():
    cats = _parse_fixture()
    assert [c.code for c in cats] == sorted(c.code for c in cats)


import json as _json


def test_to_json_obj_shape():
    from scripts.build_arxiv_taxonomy import parse_taxonomy, to_json_obj
    cats = parse_taxonomy(FIXTURE.read_text(encoding="utf-8"))
    obj = to_json_obj(cats, generated_at="2026-06-07")
    assert obj["generated_at"] == "2026-06-07"
    assert obj["source"] == "https://arxiv.org/category_taxonomy"
    assert isinstance(obj["categories"], list)
    first = obj["categories"][0]
    assert set(first) == {"code", "name", "description", "group", "relevant"}


def test_render_typescript_is_parseable_and_in_sync():
    from scripts.build_arxiv_taxonomy import parse_taxonomy, render_typescript, to_json_obj
    cats = parse_taxonomy(FIXTURE.read_text(encoding="utf-8"))
    ts = render_typescript(cats)
    assert ts.startswith("// AUTO-GENERATED")
    assert "export const ARXIV_TAXONOMY" in ts
    assert "export const RELEVANT_CATEGORIES" in ts
    # The array literal rows are valid JSON objects; extract and compare to JSON.
    rows = [
        _json.loads(line.strip().rstrip(","))
        for line in ts.splitlines()
        if line.strip().startswith("{")
    ]
    assert rows == to_json_obj(cats, generated_at="x")["categories"]


def test_sanity_guard_rejects_too_few_categories():
    from scripts.build_arxiv_taxonomy import passes_sanity
    # Fixture has 5 categories — below the MIN_CATEGORIES floor.
    from scripts.build_arxiv_taxonomy import parse_taxonomy
    cats = parse_taxonomy(FIXTURE.read_text(encoding="utf-8"))
    assert passes_sanity(cats) is False


def test_sanity_guard_requires_some_relevant():
    from scripts.build_arxiv_taxonomy import passes_sanity, Category
    only_physics = [Category("astro-ph.CO", "X", "", "Physics", False)] * 150
    assert passes_sanity(only_physics) is False


def test_sanity_guard_boundary_at_min_categories():
    from scripts.build_arxiv_taxonomy import passes_sanity, Category, MIN_CATEGORIES
    relevant = Category("cs.AI", "Artificial Intelligence", "d", "Computer Science", True)
    assert passes_sanity([relevant] * MIN_CATEGORIES) is True
    assert passes_sanity([relevant] * (MIN_CATEGORIES - 1)) is False


def test_category_rejects_inconsistent_relevant_flag():
    import pytest
    from scripts.build_arxiv_taxonomy import Category
    # cs.* is in the relevant allowlist, so relevant=False is inconsistent.
    with pytest.raises(ValueError):
        Category("cs.LG", "Machine Learning", "", "Computer Science", False)
    # astro-ph.* is NOT relevant, so relevant=True is inconsistent.
    with pytest.raises(ValueError):
        Category("astro-ph.CO", "Cosmology", "", "Physics", True)


def test_parse_with_diagnostics_counts_skipped_h4():
    from scripts.build_arxiv_taxonomy import parse_with_diagnostics, parse_taxonomy
    html = (
        '<div id="category_taxonomy_list">'
        "<h2>Computer Science</h2>"
        '<div class="columns"><h4>cs.AI <span>(Artificial Intelligence)</span></h4>'
        "<p>desc</p></div>"
        '<div class="columns"><h4>Heading Without Parens</h4><p>x</p></div>'
        "</div>"
    )
    cats, diag = parse_with_diagnostics(html)
    assert [c.code for c in cats] == ["cs.AI"]
    assert diag.total_h4 == 2
    assert diag.parsed == 1
    assert diag.skipped == 1
    # parse_taxonomy delegates to parse_with_diagnostics and returns just the rows.
    assert parse_taxonomy(html) == cats


def test_parse_with_diagnostics_counts_blank_description():
    from scripts.build_arxiv_taxonomy import parse_with_diagnostics
    html = (
        '<div id="category_taxonomy_list">'
        "<h2>Computer Science</h2>"
        '<div class="columns"><h4>cs.AI <span>(Artificial Intelligence)</span></h4></div>'
        "</div>"
    )
    cats, diag = parse_with_diagnostics(html)
    assert cats[0].description == ""
    assert diag.blank_description == 1
    assert diag.blank_group == 0


def test_drift_warning_none_when_counts_equal():
    from scripts.build_arxiv_taxonomy import drift_warning
    assert drift_warning(155, 155) is None


def test_drift_warning_none_when_new_is_higher():
    from scripts.build_arxiv_taxonomy import drift_warning
    assert drift_warning(170, 155) is None


def test_drift_warning_none_when_drop_within_threshold():
    from scripts.build_arxiv_taxonomy import drift_warning
    # baseline 155, threshold 20% -> floor 124. 130 >= 124, so no warning.
    assert drift_warning(130, 155) is None


def test_drift_warning_message_when_drop_exceeds_threshold():
    from scripts.build_arxiv_taxonomy import drift_warning
    # baseline 155, threshold 20% -> floor 124. 120 < 124, so warn.
    msg = drift_warning(120, 155)
    assert msg is not None
    assert "120" in msg and "155" in msg


def test_drift_warning_boundary_is_exclusive():
    from scripts.build_arxiv_taxonomy import drift_warning
    # baseline 100, threshold 20% -> floor exactly 80.
    # new == floor is NOT a drop "more than 20%", so no warning.
    assert drift_warning(80, 100) is None
    # one below the floor warns.
    assert drift_warning(79, 100) is not None


def test_drift_warning_respects_custom_threshold():
    from scripts.build_arxiv_taxonomy import drift_warning
    # 10% threshold -> floor 90. 85 < 90 warns; 95 >= 90 does not.
    assert drift_warning(85, 100, threshold=0.10) is not None
    assert drift_warning(95, 100, threshold=0.10) is None


def test_drift_threshold_constant_is_twenty_percent():
    from scripts.build_arxiv_taxonomy import DRIFT_THRESHOLD
    assert DRIFT_THRESHOLD == 0.20


def test_render_typescript_escapes_special_characters():
    from scripts.build_arxiv_taxonomy import Category, render_typescript
    # cs.AI is relevant → relevant=True keeps the Category invariant satisfied.
    cat = Category("cs.AI", 'Name with "quotes"', "Back\\slash and é",
                   "Computer Science", True)
    ts = render_typescript([cat])
    rows = [
        _json.loads(line.strip().rstrip(","))
        for line in ts.splitlines()
        if line.strip().startswith("{")
    ]
    assert rows[0]["name"] == 'Name with "quotes"'
    assert rows[0]["description"] == "Back\\slash and é"
