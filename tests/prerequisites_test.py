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


# --- linked items: an item may be {"text", "url"} to render a clickable link ---

def test_prereq_tokens_renders_link_items_as_anchors():
    t = prereq_tokens("L", [{"text": "RAG basics", "url": "https://arxiv.org/abs/2005.11401"}])
    assert '<a href="https://arxiv.org/abs/2005.11401"' in t["prereqs.html"]
    assert ">RAG basics</a>" in t["prereqs.html"]
    assert t["prereqs.html"].count("<tr>") == 1


def test_prereq_tokens_link_url_is_attribute_escaped():
    t = prereq_tokens("L", [{"text": "x", "url": "https://e.test/a?b=1&c=2"}])
    assert 'href="https://e.test/a?b=1&amp;c=2"' in t["prereqs.html"]  # & escaped in attr


def test_prereq_tokens_text_appends_url_for_link_items():
    t = prereq_tokens("L", [{"text": "RAG basics", "url": "https://arxiv.org/abs/2005.11401"}])
    assert t["prereqs.text"] == "01. RAG basics — https://arxiv.org/abs/2005.11401"


def test_prereq_tokens_mixes_plain_and_link_items():
    t = prereq_tokens("L", ["plain", {"text": "linked", "url": "https://x.test"}])
    assert t["prereqs.html"].count("<tr>") == 2
    assert "<a href=" in t["prereqs.html"]
    assert t["prereqs.text"] == "01. plain\n\n02. linked — https://x.test"


def test_prereq_tokens_dict_without_url_renders_plain():
    t = prereq_tokens("L", [{"text": "no link here"}])
    assert "no link here" in t["prereqs.html"]
    assert "<a href=" not in t["prereqs.html"]
    assert t["prereqs.text"] == "01. no link here"


@pytest.mark.parametrize("bad", [
    {"text": "", "url": "https://x.test"},   # blank text
    {"text": "x", "url": ""},                # blank url
    {"text": "x", "url": 5},                 # non-string url
    {"url": "https://x.test"},               # missing text
])
def test_prereq_tokens_rejects_bad_link_items(bad):
    with pytest.raises(ValueError):
        prereq_tokens("L", [bad])
