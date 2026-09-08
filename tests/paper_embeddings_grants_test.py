"""033 must revoke paper_embeddings from browser roles and not re-grant SELECT."""

from __future__ import annotations

from pathlib import Path

SQL = (Path(__file__).resolve().parents[1] / "migrations" / "033_paper_embeddings_grants.sql").read_text(
    encoding="utf-8"
)


def test_033_revokes_and_does_not_regrant_select() -> None:
    statements = "\n".join(
        line for line in SQL.splitlines() if line.strip() and not line.lstrip().startswith("--")
    )
    assert "REVOKE ALL ON paper_embeddings FROM anon, authenticated;" in statements
    assert "GRANT SELECT ON paper_embeddings" not in statements
    assert "DISABLE ROW LEVEL SECURITY" not in statements
