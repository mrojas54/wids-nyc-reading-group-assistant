"""CI lock: admin pages send unauthenticated users to `/`, not `/auth`.

`/auth` is not a route. Middleware already sends logged-out `/admin`
traffic to `/`. These pages must match that destination when a stale
session still reaches the server component.
"""

from __future__ import annotations

from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
ADMIN_PAGES = [
    REPO / "web" / "app" / "admin" / "suggest" / "page.tsx",
    REPO / "web" / "app" / "admin" / "logs" / "page.tsx",
]


def test_admin_pages_redirect_home_not_auth() -> None:
    for path in ADMIN_PAGES:
        text = path.read_text()
        assert 'redirect("/auth")' not in text, f"{path} still redirects to /auth"
        assert 'redirect("/")' in text, f"{path} must redirect UnauthorizedError to /"
