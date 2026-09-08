"""Lock the members column-grant contract in source.

Migration 031 restores SELECT (id, name, role, auth_user_id) for
authenticated. A later GRANT SELECT ON members (no column list) would
silently re-open email/phone/whatsapp, the same way 007 undid 002.

These tests do not need a live database: they assert the migration file
and the portal's authenticated-client .select() lists stay inside that
column set. Service-role call sites may read any column.
"""

from __future__ import annotations

import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
MIGRATION = REPO / "migrations" / "031_members_column_grants.sql"
WEB = REPO / "web"

ALLOWED_AUTHENTICATED_COLUMNS = frozenset({"id", "name", "role", "auth_user_id"})
DENIED_COLUMNS = frozenset(
    {"email", "phone", "whatsapp", "active", "vouched_by", "joined_at"}
)

# The only portal files allowed to name a denied members column: they
# talk to the service-role client. Session-client files must stay inside
# ALLOWED_AUTHENTICATED_COLUMNS even if the same module also builds a
# service client for a different table (e.g. blackout_periods).
SERVICE_ROLE_MEMBERS_READERS = frozenset(
    {
        "web/app/actions.ts",
        "web/app/auth/callback/route.ts",
    }
)

SELECT_RE = re.compile(
    r"""\.from\(\s*["']members["']\s*\)\s*\.select\(\s*["']([^"']+)["']""",
    re.MULTILINE,
)
EMBED_RE = re.compile(r"members:leader_id\(([^)]+)\)")
GRANT_RE = re.compile(
    r"GRANT SELECT \(([^)]+)\) ON members TO authenticated",
    re.IGNORECASE,
)


def _columns(select_list: str) -> set[str]:
    return {part.strip() for part in select_list.split(",") if part.strip()}


def test_031_grants_exactly_the_allowed_columns() -> None:
    sql = MIGRATION.read_text(encoding="utf-8")
    match = GRANT_RE.search(sql)
    assert match, "031 must GRANT SELECT (columns) ON members TO authenticated"
    granted = _columns(match.group(1))
    assert granted == ALLOWED_AUTHENTICATED_COLUMNS
    statements = "\n".join(
        line for line in sql.splitlines() if line.strip() and not line.lstrip().startswith("--")
    )
    assert "GRANT SELECT ON members TO authenticated;" not in statements
    assert "REVOKE ALL ON members FROM anon, authenticated;" in statements


def test_031_does_not_grant_denied_columns() -> None:
    sql = MIGRATION.read_text(encoding="utf-8")
    match = GRANT_RE.search(sql)
    assert match
    granted = _columns(match.group(1))
    assert granted.isdisjoint(DENIED_COLUMNS)


def test_authenticated_members_selects_stay_inside_the_column_lock() -> None:
    """Portal session-client reads of members must fit the 031 column list."""
    offenders: list[str] = []
    for path in WEB.rglob("*"):
        if path.suffix not in {".ts", ".tsx"}:
            continue
        if "node_modules" in path.parts or "__tests__" in path.parts:
            continue
        rel = path.relative_to(REPO).as_posix()
        text = path.read_text(encoding="utf-8")
        for match in (*SELECT_RE.finditer(text), *EMBED_RE.finditer(text)):
            cols = _columns(match.group(1))
            extra = cols - ALLOWED_AUTHENTICATED_COLUMNS
            if extra and rel not in SERVICE_ROLE_MEMBERS_READERS:
                offenders.append(f"{rel}: {sorted(extra)}")
    assert offenders == []
