"""Tests for scripts/gmail_raw_drafts.py — the raw-MIME draft path.

No network: OAuth and Gmail calls are mocked with respx. Run via:
    uv run pytest -c tests/pytest.ini tests/gmail_raw_drafts_test.py -v
"""
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

from scripts import gmail_raw_drafts as g

PNG = (
    b"\x89PNG\r\n\x1a\n" + b"\x00" * 32  # any bytes; the MIME layer does not decode them
)
HTML = (
    '<table><tr><td width="48"><img src="' + g.MARK_URL + '"\nwidth="48" alt="WiDS NYC"></td>'
    '<td class="wordmark">WiDS NYC</td></tr></table><style>.x{}</style>'
)
TEXT = "WiDS NYC AI Reading Group\n\nHi Maya,\n"


# ── MIME ─────────────────────────────────────────────────────────────────────


def test_cid_mode_builds_alternative_with_related_and_inline_png():
    msg = g.build_mime(to="a@example.com", subject="s", html=HTML, text=TEXT, mark="cid", mark_png=PNG)
    assert msg.get_content_type() == "multipart/alternative"
    plain, rich = msg.get_payload()
    assert plain.get_content_type() == "text/plain"
    assert rich.get_content_type() == "multipart/related"
    html_part, img = rich.get_payload()
    assert html_part.get_content_type() == "text/html"
    assert f'src="cid:{g.MARK_CID}"' in html_part.get_content()
    assert g.MARK_URL not in html_part.get_content()
    assert img.get_content_type() == "image/png"
    assert img["Content-ID"] == f"<{g.MARK_CID}>"
    assert img["Content-Disposition"].startswith("inline")
    assert img.get_payload(decode=True) == PNG


def test_https_mode_leaves_the_remote_img_and_adds_no_part():
    msg = g.build_mime(to="a@example.com", subject="s", html=HTML, text=TEXT, mark="https")
    plain, rich = msg.get_payload()
    assert rich.get_content_type() == "text/html"
    assert g.MARK_URL in rich.get_content()
    assert "cid:" not in rich.get_content()


def test_none_mode_drops_only_the_mark_img():
    html = HTML + '<img src="https://elsewhere.example/x.png">'
    msg = g.build_mime(to="a@example.com", subject="s", html=html, text=TEXT, mark="none")
    body = msg.get_payload()[1].get_content()
    assert g.MARK_URL not in body
    assert "elsewhere.example" in body
    assert 'width="48"' in body  # the cell stays; only the tag went


def test_cid_mode_refuses_html_that_never_references_the_mark():
    with pytest.raises(g.DraftError, match="never references"):
        g.build_mime(to="a@x", subject="s", html="<p>no mark</p>", text="t", mark="cid", mark_png=PNG)


def test_cid_mode_refuses_without_png_bytes():
    with pytest.raises(g.DraftError, match="PNG bytes"):
        g.build_mime(to="a@x", subject="s", html=HTML, text="t", mark="cid")


def test_everything_we_care_about_survives_encode_decode():
    """The whole point: raw MIME round-trips with img, style and class intact."""
    msg = g.build_mime(to="a@example.com", subject="Sübject —", html=HTML, text=TEXT, mark="cid", mark_png=PNG)
    back = g.decode_raw(g.encode_raw(msg))
    assert back["Subject"] == "Sübject —"
    assert back["To"] == "a@example.com"
    html = g.html_body_of(back)
    got = g.survivors(html)
    assert got["img"] == 1 and got["style"] == 1 and got["class"] == 1 and got["cid"] == 1
    assert got["rewritten_href"] == 0
    assert any(p.get_content_type() == "image/png" for p in back.walk())


def test_survivors_reports_the_sanitised_profile_as_zeros():
    stripped = '<table><tr><td width="48">\n</td><td>WiDS NYC</td></tr></table>' \
               '<a href="https://www.google.com/url?q=https://x&source=gmail">x</a>'
    got = g.survivors(stripped)
    assert got["img"] == 0 and got["svg"] == 0 and got["style"] == 0 and got["class"] == 0
    assert got["rewritten_href"] == 1


def test_prepare_html_counts_hits_per_mode():
    assert g.prepare_html(HTML, "https")[1] == 1
    assert g.prepare_html(HTML, "cid")[1] == 1
    assert g.prepare_html(HTML, "none")[1] == 1
    assert g.prepare_html("<p>x</p>", "cid")[1] == 0


# ── OAuth ────────────────────────────────────────────────────────────────────


def test_client_from_desktop_app_json(tmp_path: Path):
    doc = {"installed": {"client_id": "id.apps", "client_secret": "sek", "token_uri": "https://t/x"}}
    p = tmp_path / "client_secret.json"
    p.write_text(json.dumps(doc))
    c = g.OAuthClient.from_secret_file(p)
    assert (c.client_id, c.client_secret, c.token_uri) == ("id.apps", "sek", "https://t/x")
    assert c.auth_uri.startswith("https://accounts.google.com/")


def test_client_missing_file_says_where_to_get_one(tmp_path: Path):
    with pytest.raises(g.DraftError, match="Desktop app"):
        g.OAuthClient.from_secret_file(tmp_path / "nope.json")


def test_pkce_pair_is_s256_of_the_verifier():
    import hashlib
    v, c = g.pkce_pair()
    expect = base64.urlsafe_b64encode(hashlib.sha256(v.encode()).digest()).decode().rstrip("=")
    assert c == expect and "=" not in v and len(v) >= 43


def test_auth_url_requests_offline_compose_scope_with_pkce():
    c = g.OAuthClient("id", "sek")
    url = g.build_auth_url(c, "http://127.0.0.1:5/", "chal", "st")
    q = dict(httpx.URL(url).params)
    assert q["scope"] == g.SCOPE and q["code_challenge"] == "chal" and q["state"] == "st"
    assert q["access_type"] == "offline" and q["code_challenge_method"] == "S256"
    assert q["redirect_uri"] == "http://127.0.0.1:5/"


@respx.mock
def test_exchange_code_posts_pkce_verifier_and_builds_token():
    c = g.OAuthClient("id", "sek", token_uri="https://oauth2.googleapis.com/token")
    route = respx.post("https://oauth2.googleapis.com/token").mock(
        return_value=httpx.Response(200, json={"access_token": "at", "refresh_token": "rt", "expires_in": 3600})
    )
    tok = g.exchange_code(c, "the-code", "http://127.0.0.1:9/", "verif")
    sent = dict(httpx.QueryParams(route.calls.last.request.content.decode()))
    assert sent["code"] == "the-code" and sent["code_verifier"] == "verif"
    assert sent["grant_type"] == "authorization_code"
    assert tok.access_token == "at" and tok.refresh_token == "rt"
    assert tok.expires_at > time.time() + 3000 and not tok.expiring()


@respx.mock
def test_refresh_keeps_the_original_refresh_token():
    c = g.OAuthClient("id", "sek", token_uri="https://oauth2.googleapis.com/token")
    respx.post("https://oauth2.googleapis.com/token").mock(
        return_value=httpx.Response(200, json={"access_token": "at2", "expires_in": 3600})
    )
    old = g.Token(access_token="at", refresh_token="rt", expires_at=time.time() - 1)
    assert old.expiring()
    new = g.refresh(c, old)
    assert new.access_token == "at2" and new.refresh_token == "rt"


@respx.mock
def test_exchange_failure_is_a_draft_error_not_a_traceback():
    c = g.OAuthClient("id", "sek", token_uri="https://oauth2.googleapis.com/token")
    respx.post("https://oauth2.googleapis.com/token").mock(return_value=httpx.Response(400, text="bad"))
    with pytest.raises(g.DraftError, match="400"):
        g.exchange_code(c, "x", "http://127.0.0.1:1/", "v")


def test_token_is_saved_owner_only_and_round_trips(tmp_path: Path):
    p = tmp_path / "sub" / "gmail-token.json"
    tok = g.Token(access_token="a", refresh_token="r", expires_at=1.0)
    g.save_token(p, tok)
    assert stat.S_IMODE(os.stat(p).st_mode) == 0o600
    assert g.load_token(p) == tok


def test_load_token_missing_points_at_auth(tmp_path: Path):
    with pytest.raises(g.DraftError, match="run `auth`"):
        g.load_token(tmp_path / "none.json")


# ── Gmail REST ───────────────────────────────────────────────────────────────


@respx.mock
def test_create_draft_posts_raw_under_message_and_returns_the_draft():
    route = respx.post(f"{g.GMAIL_API}/drafts").mock(
        return_value=httpx.Response(200, json={"id": "r-1", "message": {"id": "m1"}})
    )
    doc = g.create_draft("tok", "cmF3")
    assert doc["id"] == "r-1"
    req = route.calls.last.request
    assert req.headers["authorization"] == "Bearer tok"
    assert json.loads(req.content) == {"message": {"raw": "cmF3"}}


@respx.mock
def test_get_draft_raw_decodes_the_stored_mime():
    msg = g.build_mime(to="a@example.com", subject="s", html=HTML, text=TEXT, mark="cid", mark_png=PNG)
    respx.get(f"{g.GMAIL_API}/drafts/r-1").mock(
        return_value=httpx.Response(200, json={"id": "r-1", "message": {"raw": g.encode_raw(msg)}})
    )
    back = g.get_draft_raw("tok", "r-1")
    assert g.survivors(g.html_body_of(back))["img"] == 1


def test_no_send_endpoint_anywhere_in_the_module():
    """Policy guard: this file must never grow a send path."""
    src = Path(g.__file__).read_text(encoding="utf-8")
    assert "/send" not in src and "messages.send" not in src.replace("``messages.send``", "")
    assert "drafts/send" not in src


# ── Manifest + CLI ───────────────────────────────────────────────────────────


def test_manifest_resolves_paths_relative_to_itself(tmp_path: Path):
    (tmp_path / "a.html").write_text(HTML, encoding="utf-8")
    (tmp_path / "a.txt").write_text(TEXT, encoding="utf-8")
    m = tmp_path / "manifest.json"
    m.write_text(json.dumps([{"to": "a@example.com", "subject": "s", "html": "a.html", "text": "a.txt"}]))
    [spec] = g.load_manifest(m)
    assert spec.to == "a@example.com" and spec.html == HTML and spec.text == TEXT


def test_manifest_missing_body_file_is_a_draft_error(tmp_path: Path):
    m = tmp_path / "manifest.json"
    m.write_text(json.dumps([{"to": "a@x", "subject": "s", "html": "gone.html", "text": "gone.txt"}]))
    with pytest.raises(g.DraftError, match="entry 0"):
        g.load_manifest(m)


def test_dry_run_writes_eml_and_never_needs_credentials(tmp_path: Path, capsys):
    (tmp_path / "a.html").write_text(HTML, encoding="utf-8")
    (tmp_path / "a.txt").write_text(TEXT, encoding="utf-8")
    png = tmp_path / "mark.png"
    png.write_bytes(PNG)
    rc = g.main([
        "create", "--to", "a@example.com", "--subject", "s",
        "--html", str(tmp_path / "a.html"), "--text", str(tmp_path / "a.txt"),
        "--mark-png", str(png), "--dry-run", str(tmp_path / "out"),
    ])
    assert rc == 0
    eml = (tmp_path / "out" / "a_example.com.eml").read_bytes()
    back = g.decode_raw(base64.urlsafe_b64encode(eml).decode())
    assert g.survivors(g.html_body_of(back))["cid"] == 1
    assert "nothing touched Gmail" in capsys.readouterr().out


def test_reminder_manifest_renders_pending_state_through_the_shared_pipeline(tmp_path: Path):
    from scripts.render_email_previews import REMINDER_PAPER_PENDING_TOKENS
    from scripts.quotes import load_bundle, quote_tokens, select_quote

    tokens = {k: v for k, v in REMINDER_PAPER_PENDING_TOKENS.items() if k != "recipient.firstName"}
    tokens.update(quote_tokens(select_quote(load_bundle(), 20617)))
    path = g.write_reminder_manifest(
        recipients=[{"first": "Niki", "email": "niki@example.com"}],
        tokens=tokens, state="paper_pending", out_dir=tmp_path, subject="Sub",
    )
    [entry] = json.loads(path.read_text(encoding="utf-8"))
    html = (tmp_path / entry["html"]).read_text(encoding="utf-8")
    txt = (tmp_path / entry["text"]).read_text(encoding="utf-8")
    assert "Hi Niki," in html and "Hi Niki," in txt
    assert "Paper Pal coming soon" in html and "{{" not in html and "<!--\n" not in html
    assert g.MARK_URL in html  # the mark img is there for cid mode to rewrite
    # and the whole thing builds into a cid draft
    msg = g.build_mime(to=entry["to"], subject=entry["subject"], html=html, text=txt, mark="cid", mark_png=PNG)
    assert g.survivors(g.html_body_of(g.decode_raw(g.encode_raw(msg))))["img"] >= 1


def test_main_reports_draft_errors_on_stderr(tmp_path: Path, capsys):
    rc = g.main(["batch", "--manifest", str(tmp_path / "missing.json"), "--dry-run", str(tmp_path)])
    assert rc == 1
    assert "error:" in capsys.readouterr().err


# ── Error handling: operator-facing failures are DraftErrors, never tracebacks ─


def _write_client_secret(path: Path) -> Path:
    path.write_text(json.dumps({"installed": {"client_id": "id", "client_secret": "sek"}}))
    return path


def _write_token(path: Path, **overrides) -> Path:
    doc = {"access_token": "at", "refresh_token": "rt", "expires_at": time.time() + 3600, "scope": g.SCOPE}
    doc.update(overrides)
    path.write_text(json.dumps(doc))
    return path


@pytest.mark.parametrize("loader, what", [
    (g.OAuthClient.from_secret_file, "client secret"),
    (g.load_token, "token"),
    (g.load_manifest, "manifest"),
])
def test_malformed_json_is_a_draft_error_naming_the_file(tmp_path: Path, loader, what):
    p = tmp_path / "broken.json"
    p.write_text('{"truncated": ')
    with pytest.raises(g.DraftError, match=rf"{what} at .*broken\.json is not valid JSON"):
        loader(p)


def test_main_reports_a_malformed_manifest_on_stderr_not_as_a_traceback(tmp_path: Path, capsys):
    m = tmp_path / "manifest.json"
    m.write_text("[{")
    rc = g.main(["batch", "--manifest", str(m), "--dry-run", str(tmp_path / "out")])
    assert rc == 1
    err = capsys.readouterr().err
    assert "error:" in err and "not valid JSON" in err


def test_stale_token_schema_says_run_auth_again(tmp_path: Path):
    p = tmp_path / "token.json"
    p.write_text(json.dumps({"access_token": "at", "expiry": "2020-01-01"}))  # old/foreign schema
    with pytest.raises(g.DraftError, match="run `auth` again"):
        g.load_token(p)
    p.write_text(json.dumps(["not", "an", "object"]))
    with pytest.raises(g.DraftError, match="run `auth` again"):
        g.load_token(p)
    _write_token(p, expires_at="soon")
    with pytest.raises(g.DraftError, match="run `auth` again"):
        g.load_token(p)


def test_client_json_without_the_installed_block_is_a_draft_error(tmp_path: Path):
    p = tmp_path / "client.json"
    p.write_text(json.dumps({"something": "else"}))
    with pytest.raises(g.DraftError, match="Desktop app"):
        g.OAuthClient.from_secret_file(p)
    p.write_text(json.dumps({"installed": {"client_id": "only"}}))
    with pytest.raises(g.DraftError, match="missing 'client_secret'"):
        g.OAuthClient.from_secret_file(p)


@pytest.mark.parametrize("recipients, tokens, needle", [
    ("[{", '{"a": "b"}', "recipients at"),
    ('[{"first": "N", "email": "n@x"}]', "{", "tokens at"),
    ("[]", '{"a": "b"}', "non-empty JSON list"),
    ('[{"first": "N"}]', '{"a": "b"}', "entry 0 needs string"),
    ('[{"first": "N", "email": "n@x"}]', '{"a": 1}', "must be a string"),
])
def test_reminder_manifest_inputs_are_validated(tmp_path: Path, capsys, recipients, tokens, needle):
    (tmp_path / "r.json").write_text(recipients)
    (tmp_path / "t.json").write_text(tokens)
    rc = g.main([
        "reminder-manifest", "--recipients", str(tmp_path / "r.json"), "--tokens", str(tmp_path / "t.json"),
        "--state", "paper_pending", "--out", str(tmp_path / "out"),
    ])
    assert rc == 1
    assert needle in capsys.readouterr().err


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

    monkeypatch.setattr(g.os, "open", spy)
    old_umask = os.umask(0)  # the worst case: nothing but our explicit mode protects the file
    try:
        p = tmp_path / "cfg" / "gmail-token.json"
        g.save_token(p, g.Token(access_token="a", refresh_token="r", expires_at=1.0))
    finally:
        os.umask(old_umask)
    assert modes == [0o600]
    assert stat.S_IMODE(os.stat(p).st_mode) == 0o600
    assert stat.S_IMODE(os.stat(p.parent).st_mode) == 0o700


def test_save_token_tightens_a_pre_existing_wider_file(tmp_path: Path):
    p = tmp_path / "gmail-token.json"
    p.write_text("{}")
    os.chmod(p, 0o644)
    g.save_token(p, g.Token(access_token="a", refresh_token="r", expires_at=1.0))
    assert stat.S_IMODE(os.stat(p).st_mode) == 0o600
    assert g.load_token(p).access_token == "a"


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

    monkeypatch.setattr(g.http.server, "HTTPServer", FakeServer)
    g._Loopback.query = {"code": ["stale-from-a-previous-call"], "state": ["x"]}
    with pytest.raises(g.DraftError, match="no redirect received"):
        g.authorize(g.OAuthClient("id", "sek"), open_browser=False, timeout=0.01)
    assert g._Loopback.query == {}


# ── Gmail REST: one retry policy, and a resumable batch ──────────────────────


@pytest.fixture
def no_backoff(monkeypatch):
    from tenacity import wait_none
    for fn in (g.create_draft, g.get_draft_raw):
        monkeypatch.setattr(fn.retry, "wait", wait_none())


@respx.mock
def test_create_draft_retries_a_transient_5xx_then_succeeds(no_backoff):
    route = respx.post(f"{g.GMAIL_API}/drafts").mock(
        side_effect=[httpx.Response(503, text="try later"), httpx.Response(200, json={"id": "r-2"})]
    )
    assert g.create_draft("tok", "cmF3")["id"] == "r-2"
    assert route.call_count == 2


@respx.mock
def test_create_draft_does_not_retry_a_deterministic_refusal(no_backoff):
    route = respx.post(f"{g.GMAIL_API}/drafts").mock(return_value=httpx.Response(400, text="bad raw"))
    with pytest.raises(g.DraftError, match="400"):
        g.create_draft("tok", "cmF3")
    assert route.call_count == 1


@respx.mock
def test_create_draft_gives_up_after_three_attempts(no_backoff):
    route = respx.post(f"{g.GMAIL_API}/drafts").mock(return_value=httpx.Response(500, text="down"))
    with pytest.raises(g.DraftError, match="500"):
        g.create_draft("tok", "cmF3")
    assert route.call_count == 3


@respx.mock
def test_get_draft_raw_retries_transport_errors(no_backoff):
    msg = g.build_mime(to="a@example.com", subject="s", html=HTML, text=TEXT, mark="https")
    route = respx.get(f"{g.GMAIL_API}/drafts/r-1").mock(
        side_effect=[httpx.ConnectError("reset"), httpx.Response(200, json={"message": {"raw": g.encode_raw(msg)}})]
    )
    assert g.get_draft_raw("tok", "r-1")["Subject"] == "s"
    assert route.call_count == 2


@respx.mock
def test_batch_failure_reports_created_failed_and_not_attempted(tmp_path: Path, capsys, no_backoff):
    for who in ("a", "b", "c"):
        (tmp_path / f"{who}.html").write_text(HTML, encoding="utf-8")
        (tmp_path / f"{who}.txt").write_text(TEXT, encoding="utf-8")
    m = tmp_path / "manifest.json"
    m.write_text(json.dumps([
        {"to": f"{who}@example.com", "subject": "s", "html": f"{who}.html", "text": f"{who}.txt"}
        for who in ("a", "b", "c")
    ]))
    respx.post(f"{g.GMAIL_API}/drafts").mock(
        side_effect=[httpx.Response(200, json={"id": "r-a"}), httpx.Response(403, text="quota")]
    )
    rc = g.main([
        "batch", "--manifest", str(m), "--mark", "https",
        "--client-secret", str(_write_client_secret(tmp_path / "client.json")),
        "--token", str(_write_token(tmp_path / "token.json")),
    ])
    assert rc == 1
    err = capsys.readouterr().err
    assert "created before the failure (1): a@example.com" in err
    assert "failed: b@example.com" in err
    assert "not attempted (1): c@example.com" in err
    assert "re-run" in err


# ── Manifest ↔ dry-run correspondence, and state-derived tokens ──────────────


def test_manifest_bodies_and_dry_run_eml_share_one_filename_stem(tmp_path: Path):
    """The dry-run exists to demonstrate the manifest; the two must name files identically."""
    from scripts.quotes import load_bundle, quote_tokens, select_quote
    from scripts.render_email_previews import REMINDER_TOKENS

    email = "Odd Name+tag@Example.com"
    tokens = {**REMINDER_TOKENS, **quote_tokens(select_quote(load_bundle(), 20617))}
    manifest = g.write_reminder_manifest(
        recipients=[{"first": "O", "email": email}], tokens=tokens, state="paper",
        out_dir=tmp_path / "m", subject="Sub",
    )
    [entry] = json.loads(manifest.read_text(encoding="utf-8"))
    assert entry["html"] == f"{g._slug(email)}.html"
    rc = g.main(["batch", "--manifest", str(manifest), "--mark", "https", "--dry-run", str(tmp_path / "eml")])
    assert rc == 0
    assert (tmp_path / "eml" / f"{g._slug(email)}.eml").exists()
    assert (tmp_path / "eml" / (Path(entry["html"]).stem + ".eml")).exists()


def test_reminder_manifest_pending_state_strips_paper_tokens_before_rendering(tmp_path: Path):
    """The draft path must be paper-free by construction like the preview is:
    hand it the *full* token set and the pending body still carries no paper."""
    from scripts.quotes import load_bundle, quote_tokens, select_quote
    from scripts.render_email_previews import REMINDER_TOKENS

    tokens = {**REMINDER_TOKENS, **quote_tokens(select_quote(load_bundle(), 20617))}
    path = g.write_reminder_manifest(
        recipients=[{"first": "Niki", "email": "niki@example.com"}],
        tokens=tokens, state="paper_pending", out_dir=tmp_path, subject="Sub",
    )
    [entry] = json.loads(path.read_text(encoding="utf-8"))
    for key in ("html", "text"):
        body = (tmp_path / entry[key]).read_text(encoding="utf-8")
        assert "Paper Pal coming soon" in body
        assert "Hybrid LSTM" not in body and "doi.org" not in body and "papers/2" not in body


def test_reminder_manifest_paper_state_still_needs_the_paper_tokens(tmp_path: Path):
    from scripts.quotes import load_bundle, quote_tokens, select_quote
    from scripts.render_email_previews import REMINDER_PAPER_PENDING_TOKENS

    tokens = {**REMINDER_PAPER_PENDING_TOKENS, **quote_tokens(select_quote(load_bundle(), 20617))}
    with pytest.raises(g.DraftError, match="unresolved tokens.*paper.title"):
        g.write_reminder_manifest(
            recipients=[{"first": "Niki", "email": "niki@example.com"}],
            tokens=tokens, state="paper", out_dir=tmp_path, subject="Sub",
        )


def test_reminder_manifest_and_preview_render_byte_identical_bodies(tmp_path: Path):
    """The whole point of sharing render_body: the draft *is* the preview."""
    from scripts.quotes import load_bundle, quote_tokens, select_quote
    from scripts.render_email_previews import (
        REMINDER_PAPER_PENDING_BLOCKS,
        REMINDER_PAPER_PENDING_TOKENS,
        REMINDER_TOKENS,
        TEMPLATES,
        render_body,
    )

    q = quote_tokens(select_quote(load_bundle(), 20617))
    for state, base, blocks in (
        ("paper", REMINDER_TOKENS, {"paper": True, "paper_pending": False}),
        ("paper_pending", REMINDER_PAPER_PENDING_TOKENS, REMINDER_PAPER_PENDING_BLOCKS),
    ):
        tokens = {**base, **q}
        path = g.write_reminder_manifest(
            recipients=[{"first": "Maya", "email": "maya@example.com"}],
            tokens=tokens, state=state, out_dir=tmp_path / state, subject="Sub",
        )
        [entry] = json.loads(path.read_text(encoding="utf-8"))
        for ext, key in (("html", "html"), ("txt", "text")):
            src = (TEMPLATES / f"availability-reminder.{ext}").read_text(encoding="utf-8")
            expected, unresolved = render_body(src, ext, blocks, {**tokens, "recipient.firstName": "Maya"})
            assert unresolved == []
            assert (tmp_path / state / entry[key]).read_text(encoding="utf-8") == expected
