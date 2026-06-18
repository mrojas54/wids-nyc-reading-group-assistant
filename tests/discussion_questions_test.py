"""Tests for scripts/discussion_questions.py.

Run via:
    uv run pytest tests/discussion_questions_test.py -v
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from scripts.discussion_questions import (
    SAMPLE_PATH,
    load_questions,
    question_tokens,
)


def _write(path: Path, obj: object) -> Path:
    path.write_text(json.dumps(obj), encoding="utf-8")
    return path


def test_sample_source_ships_and_loads():
    assert SAMPLE_PATH.exists()
    qs = load_questions()
    assert len(qs) == 8
    assert all(isinstance(q, str) and q.strip() for q in qs)


def test_load_missing_file_raises(tmp_path):
    with pytest.raises(RuntimeError, match="not found"):
        load_questions(tmp_path / "nope.json")


def test_load_bad_json_raises(tmp_path):
    p = tmp_path / "bad.json"
    p.write_text("{not json", encoding="utf-8")
    with pytest.raises(RuntimeError, match="not valid JSON"):
        load_questions(p)


def test_load_empty_array_raises(tmp_path):
    p = _write(tmp_path / "empty.json", {"questions": []})
    with pytest.raises(RuntimeError, match="non-empty"):
        load_questions(p)


def test_load_missing_key_raises(tmp_path):
    p = _write(tmp_path / "nokey.json", {"items": ["a"]})
    with pytest.raises(RuntimeError, match="non-empty"):
        load_questions(p)


def test_load_blank_entry_raises(tmp_path):
    p = _write(tmp_path / "blank.json", {"questions": ["ok", "   "]})
    with pytest.raises(RuntimeError, match="non-empty string"):
        load_questions(p)


def test_tokens_keys_exact():
    tokens = question_tokens(["a", "b"])
    assert set(tokens) == {"questions.lede", "questions.html", "questions.text"}


def test_lede_is_count_aware():
    assert question_tokens(["a"] * 8)["questions.lede"].startswith("Eight to chew on")
    assert question_tokens(["a"] * 3)["questions.lede"].startswith("Three to chew on")
    # past the word map, falls back to the digit
    assert question_tokens(["a"] * 13)["questions.lede"].startswith("13 to chew on")


def test_html_numbers_zero_padded_and_one_row_each():
    html = question_tokens(["first", "second"])["questions.html"]
    assert ">01<" in html
    assert ">02<" in html
    assert html.count("<tr>") == 2


def test_html_dashed_border_on_all_but_last_row():
    # 3 rows -> 2 non-last rows x 2 cells each = 4 dashed borders.
    html = question_tokens(["a", "b", "c"])["questions.html"]
    assert html.count("border-bottom:1px dashed") == 4


def test_html_escapes_ampersand():
    html = question_tokens(["S&P 500 vs NASDAQ"])["questions.html"]
    assert "S&amp;P 500" in html


def test_text_is_plain_numbered_and_unescaped():
    text = question_tokens(["S&P 500", "second"])["questions.text"]
    assert "01. S&P 500" in text
    assert "02. second" in text
    assert "&amp;" not in text
