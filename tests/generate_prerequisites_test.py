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
    def __init__(self, rows):
        self._rows = rows
        self._i = 0
    def __enter__(self): return self
    def __exit__(self, *a): return False
    def execute(self, sql, params=None): self._sql = sql
    def fetchone(self):
        # Return the first queued result set's single row (or None).
        return self._rows[self._i] if self._i < len(self._rows) else None


class _FakeConn:
    def __init__(self, rows): self._rows = rows
    def cursor(self): return _FakeCursor(self._rows)


def test_select_newest_paper_returns_meeting_paper():
    row = (2, "T", "http://x", "abstract", ["Li Zhao"], 2025, None)
    paper = select_newest_paper(_FakeConn([row]))
    assert paper["id"] == 2 and paper["title"] == "T" and paper["authors"] == ["Li Zhao"]


def test_select_newest_paper_raises_when_no_papers():
    with pytest.raises(LookupError):
        select_newest_paper(_FakeConn([None]))
