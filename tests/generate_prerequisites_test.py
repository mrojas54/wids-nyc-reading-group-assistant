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

    def fetchall(self):
        return list(self._result or [])


class _FakeConn:
    """Yields one queued per-query result per cursor() call, in order — so the
    meeting-candidates query (consumed via fetchall) and the added_at fallback
    (consumed via fetchone) see different result sets. Queue a *list* of rows for
    the candidates query and a single row/None for the fallback."""

    def __init__(self, results):
        self._results = list(results)
        self._i = 0

    def cursor(self):
        result = self._results[self._i] if self._i < len(self._results) else None
        self._i += 1
        return _FakeCursor(result)


# Candidate rows carry the 7 paper columns plus (status, scheduled_at, meeting_id).
def _candidate(paper_id, title, status, scheduled_at, meeting_id):
    return (paper_id, title, "http://x", "abstract", ["Li Zhao"], 2025, None,
            status, scheduled_at, meeting_id)


def test_select_newest_paper_returns_meeting_paper():
    row = _candidate(2, "T", "prep", None, 6)
    paper = select_newest_paper(_FakeConn([[row]]))
    assert paper["id"] == 2 and paper["title"] == "T" and paper["authors"] == ["Li Zhao"]


def test_select_newest_paper_uses_added_at_fallback():
    # Meeting-candidates query misses (no rows); the added_at fallback returns a
    # row. This is the only path that exercises the fallback SELECT + row->dict.
    fallback = (7, "Fallback Paper", "http://f", "abstract", ["Ana Ng"], 2024, None)
    paper = select_newest_paper(_FakeConn([[], fallback]))
    assert paper["id"] == 7 and paper["title"] == "Fallback Paper"
    assert paper["authors"] == ["Ana Ng"]


def test_select_newest_paper_raises_when_no_papers():
    # match= guards against passing on an incidental KeyError (a LookupError
    # subclass) from empty-row handling instead of the intended raise.
    with pytest.raises(LookupError, match="no papers"):
        select_newest_paper(_FakeConn([[], None]))


def test_pick_newest_prefers_inflight_prep_over_more_recent_done():
    # The bug: an unscheduled prep meeting (scheduled_at=None) must still win
    # over a completed meeting with a real, more-recent date. The announcement is
    # about the cycle being set up, not the last one that happened.
    from datetime import datetime, timezone

    from scripts.generate_prerequisites import _pick_newest_meeting
    done = _candidate(2, "Gold Futures", "done",
                      datetime(2026, 6, 19, tzinfo=timezone.utc), 6)
    prep = _candidate(40, "Meta-Harness", "prep", None, 37)
    paper = _pick_newest_meeting([done, prep])
    assert paper is not None and paper["id"] == 40 and paper["title"] == "Meta-Harness"


def test_pick_newest_ignores_cancelled_meetings():
    from datetime import datetime, timezone

    from scripts.generate_prerequisites import _pick_newest_meeting
    cancelled = _candidate(9, "Cancelled", "cancelled",
                           datetime(2026, 7, 1, tzinfo=timezone.utc), 50)
    done = _candidate(2, "Done", "done",
                      datetime(2026, 6, 19, tzinfo=timezone.utc), 6)
    paper = _pick_newest_meeting([cancelled, done])
    assert paper is not None and paper["id"] == 2  # cancelled skipped


def test_pick_newest_done_fallback_orders_by_date_not_id():
    # No in-flight meeting: fall back to the most recent completed one BY DATE,
    # not by meeting id (id 31 is newer-numbered but older-dated than id 6).
    from datetime import datetime, timezone

    from scripts.generate_prerequisites import _pick_newest_meeting
    older_high_id = _candidate(22, "Older", "done",
                               datetime(2025, 11, 12, tzinfo=timezone.utc), 31)
    recent_low_id = _candidate(2, "Recent", "done",
                               datetime(2026, 6, 19, tzinfo=timezone.utc), 6)
    paper = _pick_newest_meeting([older_high_id, recent_low_id])
    assert paper is not None and paper["id"] == 2


def test_pick_newest_returns_none_when_no_live_candidates():
    from scripts.generate_prerequisites import _pick_newest_meeting
    assert _pick_newest_meeting([]) is None
    cancelled = _candidate(9, "C", "cancelled", None, 5)
    assert _pick_newest_meeting([cancelled]) is None


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
