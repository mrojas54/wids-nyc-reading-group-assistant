import pytest

from scripts.prerequisites import prereq_tokens


def test_prereq_tokens_shape_and_lede():
    t = prereq_tokens("Groundwork first.", ["Linear algebra", "Attention", "LSTMs"])
    assert set(t) == {"prereqs.lede", "prereqs.html", "prereqs.text"}
    assert t["prereqs.lede"] == "Groundwork first."


def test_prereq_tokens_text_is_numbered_plain():
    t = prereq_tokens("L", ["First", "Second & third"])
    assert t["prereqs.text"] == "01. First\n\n02. Second & third"


def test_prereq_tokens_html_escapes_items_and_numbers_them():
    t = prereq_tokens("L", ["A & B", "plain"])
    assert "A &amp; B" in t["prereqs.html"]      # escaped
    assert "A & B" not in t["prereqs.html"]
    assert t["prereqs.html"].count("<tr>") == 2  # one row per item
    assert "01" in t["prereqs.html"] and "02" in t["prereqs.html"]


def test_prereq_tokens_last_row_has_no_bottom_border():
    t = prereq_tokens("L", ["only", "last"])
    # Non-last rows carry the dashed separator (on both cells, email-safe);
    # the last row omits it.
    row_chunks = t["prereqs.html"].split("<tr>")[1:]  # drop the leading ""
    assert "border-bottom:1px dashed" in row_chunks[0]
    assert "border-bottom:1px dashed" not in row_chunks[-1]


@pytest.mark.parametrize("bad", [("", ["x"]), ("L", []), ("L", ["", "y"]), ("L", [1])])
def test_prereq_tokens_rejects_bad_input(bad):
    lede, items = bad
    with pytest.raises(ValueError):
        prereq_tokens(lede, items)
