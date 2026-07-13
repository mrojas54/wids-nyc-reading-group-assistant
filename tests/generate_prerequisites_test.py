import pytest

from scripts.generate_prerequisites import authors_short, select_newest_paper


@pytest.mark.parametrize("authors,expected", [
    ([], ""),
    (["Li Zhao"], "Zhao"),
    (["Li Zhao", "Mei Guo"], "Zhao & Guo"),
    (["Li Zhao", "Mei Guo", "Wei Wang"], "Zhao, Guo & Wang"),
    (["Li Zhao", "Mei Guo", "Wei Wang", "Ana Ng"], "Zhao et al."),
    (["Plato"], "Plato"),
])
def test_authors_short(authors, expected):
    assert authors_short(authors) == expected


class _FakeCursor:
    def __init__(self, result):
        self._result = result

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def execute(self, sql, params=None):
        self._sql = sql

    def fetchone(self):
        return self._result


class _FakeConn:
    """Yields one queued per-query result (a single row or None) per cursor()
    call, in order — so the meeting-join query and the added_at fallback see
    different result sets."""

    def __init__(self, results):
        self._results = list(results)
        self._i = 0

    def cursor(self):
        result = self._results[self._i] if self._i < len(self._results) else None
        self._i += 1
        return _FakeCursor(result)


def test_select_newest_paper_returns_meeting_paper():
    row = (2, "T", "http://x", "abstract", ["Li Zhao"], 2025, None)
    paper = select_newest_paper(_FakeConn([row]))
    assert paper["id"] == 2 and paper["title"] == "T" and paper["authors"] == ["Li Zhao"]


def test_select_newest_paper_uses_added_at_fallback():
    # Meeting-join query misses (None); the added_at fallback returns a row.
    # This is the only path that exercises the fallback SELECT + its row->dict.
    fallback = (7, "Fallback Paper", "http://f", "abstract", ["Ana Ng"], 2024, None)
    paper = select_newest_paper(_FakeConn([None, fallback]))
    assert paper["id"] == 7 and paper["title"] == "Fallback Paper"
    assert paper["authors"] == ["Ana Ng"]


def test_select_newest_paper_raises_when_no_papers():
    with pytest.raises(LookupError):
        select_newest_paper(_FakeConn([None]))


def test_build_gather_contract_shape():
    from scripts.generate_prerequisites import build_gather_contract
    paper = {"id": 2, "title": "T", "abstract": "A", "authors": ["Li Zhao"],
             "url": "http://x", "year": 2025, "prerequisites": None}
    c = build_gather_contract(paper)
    assert c["paper_id"] == 2 and c["title"] == "T" and c["url"] == "http://x"
    assert set(c["instructions"]["produce"]) == {"short_title", "summary", "lede", "items"}
    assert c["instructions"]["items_count"] == 3


def test_build_tokens_maps_all_template_keys():
    from scripts.generate_prerequisites import build_tokens
    paper = {"id": 2, "title": "Full Title", "url": "http://x",
             "authors": ["Li Zhao", "Mei Guo", "Wei Wang"]}
    prereqs = {"lede": "Groundwork.", "items": ["a", "b", "c"],
               "summary": "it forecasts gold.", "short_title": "Short T"}
    per_send = {"recipient.firstName": "Maya", "lead.name": "Claudia",
                "lead.initial": "C", "lead.blurb": "leads this one.",
                "signoff.names": "Michelle & Claudia",
                "links.availability": "http://a", "links.rsvpManage": "http://r"}
    quote = {"quote.text": "q", "quote.by": "Grace Hopper", "quote.role": "CS"}
    t = build_tokens(paper, prereqs, per_send, quote)
    assert t["paper.title"] == "Full Title"
    assert t["paper.shortTitle"] == "Short T"
    assert t["paper.summary"] == "it forecasts gold."
    assert t["paper.authorsShort"] == "Zhao, Guo & Wang"
    assert t["prereqs.lede"] == "Groundwork." and "<tr>" in t["prereqs.html"]
    assert t["recipient.firstName"] == "Maya" and t["quote.by"] == "Grace Hopper"


def test_render_new_paper_email_raises_on_unresolved():
    from scripts.generate_prerequisites import render_new_paper_email
    with pytest.raises(ValueError):
        render_new_paper_email({"recipient.firstName": "Maya"})  # missing most tokens
