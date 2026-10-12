"""Tests for scripts/gmail_oauth.py: Gmail sign-in (loopback + PKCE) and the token file."""
from __future__ import annotations

import base64
import json
import os
import stat
import time
from pathlib import Path

import httpx
import pytest
import respx

from scripts import gmail_oauth as oauth


# ── OAuth ────────────────────────────────────────────────────────────────────


def test_client_from_desktop_app_json(tmp_path: Path):
    doc = {"installed": {"client_id": "id.apps", "client_secret": "sek", "token_uri": "https://t/x"}}
    p = tmp_path / "client_secret.json"
    p.write_text(json.dumps(doc))
    c = oauth.OAuthClient.from_secret_file(p)
    assert (c.client_id, c.client_secret, c.token_uri) == ("id.apps", "sek", "https://t/x")
    assert c.auth_uri.startswith("https://accounts.google.com/")


def test_client_missing_file_says_where_to_get_one(tmp_path: Path):
    with pytest.raises(oauth.DraftError, match="Desktop app"):
        oauth.OAuthClient.from_secret_file(tmp_path / "nope.json")


def test_pkce_pair_is_s256_of_the_verifier():
    import hashlib
    v, c = oauth.pkce_pair()
    expect = base64.urlsafe_b64encode(hashlib.sha256(v.encode()).digest()).decode().rstrip("=")
    assert c == expect and "=" not in v and len(v) >= 43


def test_auth_url_requests_offline_compose_scope_with_pkce():
    c = oauth.OAuthClient("id", "sek")
    url = oauth.build_auth_url(c, "http://127.0.0.1:5/", "chal", "st")
    q = dict(httpx.URL(url).params)
    assert q["scope"] == oauth.SCOPE and q["code_challenge"] == "chal" and q["state"] == "st"
    assert q["access_type"] == "offline" and q["code_challenge_method"] == "S256"
    assert q["redirect_uri"] == "http://127.0.0.1:5/"


@respx.mock
def test_exchange_code_posts_pkce_verifier_and_builds_token():
    c = oauth.OAuthClient("id", "sek", token_uri="https://oauth2.googleapis.com/token")
    route = respx.post("https://oauth2.googleapis.com/token").mock(
        return_value=httpx.Response(200, json={"access_token": "at", "refresh_token": "rt", "expires_in": 3600})
    )
    tok = oauth.exchange_code(c, "the-code", "http://127.0.0.1:9/", "verif")
    sent = dict(httpx.QueryParams(route.calls.last.request.content.decode()))
    assert sent["code"] == "the-code" and sent["code_verifier"] == "verif"
    assert sent["grant_type"] == "authorization_code"
    assert tok.access_token == "at" and tok.refresh_token == "rt"
    assert tok.expires_at > time.time() + 3000 and not tok.expiring()


@respx.mock
def test_refresh_keeps_the_original_refresh_token():
    c = oauth.OAuthClient("id", "sek", token_uri="https://oauth2.googleapis.com/token")
    respx.post("https://oauth2.googleapis.com/token").mock(
        return_value=httpx.Response(200, json={"access_token": "at2", "expires_in": 3600})
    )
    old = oauth.Token(access_token="at", refresh_token="rt", expires_at=time.time() - 1)
    assert old.expiring()
    new = oauth.refresh(c, old)
    assert new.access_token == "at2" and new.refresh_token == "rt"


@respx.mock
def test_exchange_failure_is_a_draft_error_not_a_traceback():
    c = oauth.OAuthClient("id", "sek", token_uri="https://oauth2.googleapis.com/token")
    respx.post("https://oauth2.googleapis.com/token").mock(return_value=httpx.Response(400, text="bad"))
    with pytest.raises(oauth.DraftError, match="400"):
        oauth.exchange_code(c, "x", "http://127.0.0.1:1/", "v")


def test_token_is_saved_owner_only_and_round_trips(tmp_path: Path):
    p = tmp_path / "sub" / "gmail-token.json"
    tok = oauth.Token(access_token="a", refresh_token="r", expires_at=1.0)
    oauth.save_token(p, tok)
    assert stat.S_IMODE(os.stat(p).st_mode) == 0o600
    assert oauth.load_token(p) == tok


def test_load_token_missing_points_at_auth(tmp_path: Path):
    with pytest.raises(oauth.DraftError, match="run `auth`"):
        oauth.load_token(tmp_path / "none.json")


# ── Token file: private from the first byte ──────────────────────────────────


def test_save_token_never_creates_a_world_readable_file(tmp_path: Path, monkeypatch):
    """The old sequence was write_text (created at the umask default, 0644 under
    022) followed by chmod. Assert the file is *created* with 0600, not merely
    tightened afterwards, by spying on the creating call."""
    modes: list[int] = []
    real_open = os.open

    def spy(path, flags, mode=0o777, *a, **kw):
        assert flags & os.O_CREAT
        modes.append(mode)
        return real_open(path, flags, mode, *a, **kw)

    monkeypatch.setattr(oauth.os, "open", spy)
    old_umask = os.umask(0)  # the worst case: nothing but our explicit mode protects the file
    try:
        p = tmp_path / "cfg" / "gmail-token.json"
        oauth.save_token(p, oauth.Token(access_token="a", refresh_token="r", expires_at=1.0))
    finally:
        os.umask(old_umask)
    assert modes == [0o600]
    assert stat.S_IMODE(os.stat(p).st_mode) == 0o600
    assert stat.S_IMODE(os.stat(p.parent).st_mode) == 0o700


def test_save_token_tightens_a_pre_existing_wider_file(tmp_path: Path):
    p = tmp_path / "gmail-token.json"
    p.write_text("{}")
    os.chmod(p, 0o644)
    oauth.save_token(p, oauth.Token(access_token="a", refresh_token="r", expires_at=1.0))
    assert stat.S_IMODE(os.stat(p).st_mode) == 0o600
    assert oauth.load_token(p).access_token == "a"


# ── OAuth loopback: no state leaks between authorize() calls ─────────────────


def test_authorize_clears_a_stale_loopback_redirect(monkeypatch):
    class FakeServer:
        server_address = ("127.0.0.1", 1)

        def __init__(self, *a, **kw):
            pass

        def handle_request(self):  # the browser never comes back
            return None

        def server_close(self):
            pass

    monkeypatch.setattr(oauth.http.server, "HTTPServer", FakeServer)
    oauth._Loopback.query = {"code": ["stale-from-a-previous-call"], "state": ["x"]}
    with pytest.raises(oauth.DraftError, match="no redirect received"):
        oauth.authorize(oauth.OAuthClient("id", "sek"), open_browser=False, timeout=0.01)
    assert oauth._Loopback.query == {}
