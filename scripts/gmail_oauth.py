"""Gmail sign-in for the drafts tool: OAuth installed-app flow (loopback + PKCE).

Split out of ``gmail_raw_drafts`` so the credential handling (the consent
flow, the refresh, and the owner-only token file) can be read and reviewed on
its own. Like that module, nothing here sends mail; it only obtains the token
``gmail_raw_drafts`` uses to write drafts. Setup: ``docs/runbooks/gmail-raw-drafts.md``.
"""
from __future__ import annotations

import base64
import hashlib
import http.server
import json
import os
import secrets
import threading
import time
import urllib.parse
import webbrowser
from dataclasses import asdict, dataclass
from pathlib import Path

import httpx

#: The narrowest Google scope that can write a draft. It also permits sending;
#: nothing here calls a send endpoint.
SCOPE = "https://www.googleapis.com/auth/gmail.compose"
ENV_CLIENT_SECRET = "WIDS_GMAIL_CLIENT_SECRET"


class DraftError(RuntimeError):
    """Raised when a draft cannot be built or written, or sign-in fails."""


def _read_json(path: Path, what: str, *, missing_hint: str | None = None) -> object:
    """``json.loads(path)`` with both failure modes restated as :class:`DraftError`.

    A missing file and a malformed one are the two things an operator driving
    this tool by hand actually hits (a truncated download, a hand-edited
    token); neither should surface as a traceback.
    """
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError as exc:
        raise DraftError(missing_hint or f"{what} not found: {path}") from exc
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        raise DraftError(f"{what} at {path} is not valid JSON (line {exc.lineno}: {exc.msg})") from exc


def _as_object(doc: object) -> dict[str, object] | None:
    """A JSON object as ``dict[str, object]``, or ``None`` if ``doc`` is not one."""
    if not isinstance(doc, dict):
        return None
    return {str(k): v for k, v in doc.items()}


# ── OAuth (installed app, loopback + PKCE) ───────────────────────────────────


@dataclass(frozen=True)
class OAuthClient:
    client_id: str
    client_secret: str
    auth_uri: str = "https://accounts.google.com/o/oauth2/v2/auth"
    token_uri: str = "https://oauth2.googleapis.com/token"

    @classmethod
    def from_secret_file(cls, path: Path) -> OAuthClient:
        """Read the JSON Google Cloud hands out for an OAuth client of type *Desktop app*."""
        doc = _read_json(
            path,
            "client secret",
            missing_hint=(
                f"client secret not found at {path} — download it from Google Cloud "
                f"(APIs & Services → Credentials → OAuth client, Desktop app) or set "
                f"${ENV_CLIENT_SECRET}"
            ),
        )
        outer = _as_object(doc) or {}
        inner = _as_object(outer.get("installed") or outer.get("web"))
        if not inner:
            raise DraftError(f"{path}: expected an 'installed' (Desktop app) client JSON")
        try:
            return cls(
                client_id=str(inner["client_id"]),
                client_secret=str(inner["client_secret"]),
                auth_uri=str(inner.get("auth_uri", cls.auth_uri)),
                token_uri=str(inner.get("token_uri", cls.token_uri)),
            )
        except KeyError as exc:
            raise DraftError(f"{path}: client JSON is missing {exc}") from exc


@dataclass
class Token:
    access_token: str
    refresh_token: str
    expires_at: float
    scope: str = SCOPE

    def expiring(self, within: float = 60.0) -> bool:
        return time.time() + within >= self.expires_at

    @classmethod
    def from_response(cls, doc: dict[str, object], refresh_token: str | None = None) -> Token:
        expires_in = float(str(doc.get("expires_in", 0)))
        rt = doc.get("refresh_token") or refresh_token
        if not rt:
            raise DraftError("token response carried no refresh_token — revoke the app "
                             "at myaccount.google.com/permissions and run `auth` again")
        return cls(
            access_token=str(doc["access_token"]),
            refresh_token=str(rt),
            expires_at=time.time() + expires_in,
            scope=str(doc.get("scope", SCOPE)),
        )


def load_token(path: Path) -> Token:
    doc = _as_object(_read_json(path, "token", missing_hint=f"no token at {path} — run `auth` first"))
    # Field by field rather than ``Token(**doc)``: a token file from an older
    # schema (or a hand edit) should say "run `auth` again", not TypeError.
    if doc is None:
        raise DraftError(f"token at {path} is not an object — run `auth` again")
    try:
        expires_at = doc["expires_at"]
        if not isinstance(expires_at, (int, float)):
            raise TypeError(f"expires_at is {type(expires_at).__name__}, not a number")
        return Token(
            access_token=str(doc["access_token"]),
            refresh_token=str(doc["refresh_token"]),
            expires_at=float(expires_at),
            scope=str(doc.get("scope", SCOPE)),
        )
    except (KeyError, TypeError, ValueError) as exc:
        raise DraftError(f"token at {path} is missing or malformed ({exc!r}) — run `auth` again") from exc


def save_token(path: Path, token: Token) -> None:
    """Write the token owner-only from the first byte.

    The refresh token is a long-lived credential that can compose and send
    mail as the operator. ``write_text`` then ``chmod`` would create the file
    at the umask default (0644 under the usual 022) for the instant between
    the two calls; opening with ``O_CREAT`` and an explicit mode never does,
    and ``chmod`` afterwards still tightens a pre-existing wider file.
    """
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        fh.write(json.dumps(asdict(token), indent=2))
    os.chmod(path, 0o600)


def pkce_pair() -> tuple[str, str]:
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(48)).decode().rstrip("=")
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).decode().rstrip("=")
    return verifier, challenge


def build_auth_url(client: OAuthClient, redirect_uri: str, challenge: str, state: str) -> str:
    params = {
        "client_id": client.client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": SCOPE,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "state": state,
        "access_type": "offline",
        "prompt": "consent",
    }
    return f"{client.auth_uri}?{urllib.parse.urlencode(params)}"


def exchange_code(
    client: OAuthClient, code: str, redirect_uri: str, verifier: str, *, http: httpx.Client | None = None
) -> Token:
    data = {
        "client_id": client.client_id,
        "client_secret": client.client_secret,
        "code": code,
        "code_verifier": verifier,
        "grant_type": "authorization_code",
        "redirect_uri": redirect_uri,
    }
    resp = (http or httpx).post(client.token_uri, data=data, timeout=30)
    if resp.status_code != 200:
        raise DraftError(f"token exchange failed: {resp.status_code} {resp.text[:300]}")
    return Token.from_response(resp.json())


def refresh(client: OAuthClient, token: Token, *, http: httpx.Client | None = None) -> Token:
    data = {
        "client_id": client.client_id,
        "client_secret": client.client_secret,
        "refresh_token": token.refresh_token,
        "grant_type": "refresh_token",
    }
    resp = (http or httpx).post(client.token_uri, data=data, timeout=30)
    if resp.status_code != 200:
        raise DraftError(f"token refresh failed: {resp.status_code} {resp.text[:300]}")
    return Token.from_response(resp.json(), refresh_token=token.refresh_token)


class _Loopback(http.server.BaseHTTPRequestHandler):
    """Catches Google's one redirect back to 127.0.0.1 and stores the query."""

    query: dict[str, list[str]] = {}

    def do_GET(self) -> None:
        type(self).query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.end_headers()
        self.wfile.write(b"Authorised. You can close this tab and go back to the terminal.\n")

    def log_message(self, format: str, *args: object) -> None:
        return


def authorize(client: OAuthClient, *, open_browser: bool = True, timeout: float = 300.0) -> Token:
    """Run the installed-app flow once. Returns a token with a refresh_token."""
    server = http.server.HTTPServer(("127.0.0.1", 0), _Loopback)
    port = server.server_address[1]
    redirect_uri = f"http://127.0.0.1:{port}/"
    verifier, challenge = pkce_pair()
    state = secrets.token_urlsafe(16)
    url = build_auth_url(client, redirect_uri, challenge, state)

    # The handler stores the redirect on the class; clear it so a second
    # authorize() in one process can never read a previous call's redirect.
    _Loopback.query = {}
    thread = threading.Thread(target=server.handle_request, daemon=True)
    thread.start()
    print("Open this URL in the browser that is signed in as the operator:\n\n" + url + "\n")
    if open_browser:
        webbrowser.open(url)
    thread.join(timeout)
    server.server_close()
    query = _Loopback.query
    if not query:
        raise DraftError("no redirect received — the browser never came back")
    if query.get("state", [""])[0] != state:
        raise DraftError("state mismatch on redirect — refusing the code")
    if "error" in query:
        raise DraftError(f"authorisation refused: {query['error'][0]}")
    return exchange_code(client, query["code"][0], redirect_uri, verifier)


def access_token(client: OAuthClient, token_path: Path) -> str:
    token = load_token(token_path)
    if token.expiring():
        token = refresh(client, token)
        save_token(token_path, token)
    return token.access_token
