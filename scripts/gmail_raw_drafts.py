"""Create Gmail drafts as raw MIME through the Gmail REST API.

Why this exists
---------------
The Gmail MCP's ``create_draft`` sanitises the body when it writes the draft:
every ``<img>``, ``<svg>``, ``<style>``, class and Outlook conditional is
removed and every href is rewritten through ``google.com/url`` — before any
human opens the draft. See ``docs/runbooks/email-client-behavior.md``
(``VERIFIED 2026-09-02``). The Gmail REST API's ``drafts.create`` with a ``raw``
message stores the MIME verbatim, so this is the path that can carry the mark.

What it never does
------------------
Send. There is no call to ``messages.send`` or ``drafts.send`` anywhere in this
file and no CLI verb for it; the operator presses Send in Gmail. The token it
holds carries the ``gmail.compose`` scope because Google offers no drafts-only
scope — that grants a capability this script does not use. The standing rule in
``README.md`` and ``docs/runbooks/transactional-emails.md`` holds.

Inputs
------
Rendered bodies, not templates. Render first (``scripts.render_email_previews``
or ``scripts.welcome_availability``) so HTML comments are stripped and tokens
resolved; this module only wraps what it is given. ``reminder-manifest`` is the
one convenience that renders for you, and it goes through the same helpers.

Setup and usage: ``docs/runbooks/gmail-raw-drafts.md``.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import re
import sys
import time
from dataclasses import dataclass
from email import policy
from email.message import EmailMessage
from email.parser import BytesParser
from email.utils import make_msgid
from pathlib import Path
from typing import Literal

import httpx
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_random_exponential,
)

from scripts.gmail_oauth import (
    ENV_CLIENT_SECRET,
    DraftError,
    OAuthClient,
    _as_object,
    _read_json,
    access_token,
    authorize,
    save_token,
)

ROOT = Path(__file__).resolve().parent.parent

GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me"

#: Where the templates point the mark today. ``cid`` mode rewrites this src.
MARK_URL = "https://wids-nyc-reading-group-assistant.vercel.app/branding/mark-reader-192.png"
MARK_CID = "wids-mark"
MARK_PNG = ROOT / "web" / "public" / "branding" / "mark-reader-96.png"

DEFAULT_TOKEN_PATH = Path.home() / ".config" / "wids" / "gmail-token.json"
ENV_TOKEN = "WIDS_GMAIL_TOKEN"

MarkMode = Literal["cid", "https", "none"]
MARK_MODES: tuple[MarkMode, ...] = ("cid", "https", "none")


class _RetryableHttp(DraftError):
    """A Gmail/OAuth response worth another attempt (429 or 5xx).

    Raised inside the retried REST helpers so tenacity can distinguish a
    transient upstream from a deterministic refusal; the CLI never sees it
    as anything but a :class:`DraftError` once the attempts are exhausted.
    """


#: Same policy as ``find_paper_suggest._request_with_retry`` — three attempts,
#: random exponential backoff capped at 10 s, transport errors and 429/5xx.
#: One retry idiom across ``scripts/``, not three.
_RETRYABLE_STATUS = frozenset({429, 500, 502, 503, 504})
_gmail_retry = retry(
    stop=stop_after_attempt(3),
    wait=wait_random_exponential(multiplier=1, max=10),
    retry=retry_if_exception_type((_RetryableHttp, httpx.TransportError)),
    reraise=True,
)


def _slug(email: str) -> str:
    """One filename stem per recipient, shared by the manifest bodies and the
    ``--dry-run`` ``.eml`` files so the two always correspond."""
    return re.sub(r"[^A-Za-z0-9._-]+", "_", email)


# ── MIME ──────────────────────────────────────────────────────────────────────

_MARK_IMG = re.compile(r"<img\b[^>]*?>", re.I | re.S)


def prepare_html(html: str, mark: MarkMode, mark_url: str = MARK_URL) -> tuple[str, int]:
    """Point the mark ``<img>`` at the inline part, or drop it. Returns (html, hits)."""
    if mark == "https":
        return html, html.count(mark_url)
    hits = 0

    def sub(match: re.Match[str]) -> str:
        nonlocal hits
        tag = match.group(0)
        if mark_url not in tag:
            return tag
        hits += 1
        if mark == "none":
            return ""
        return tag.replace(mark_url, f"cid:{MARK_CID}")

    return _MARK_IMG.sub(sub, html), hits


def build_mime(
    *,
    to: str,
    subject: str,
    html: str,
    text: str,
    sender: str | None = None,
    mark: MarkMode = "cid",
    mark_png: bytes | None = None,
    mark_url: str = MARK_URL,
) -> EmailMessage:
    """One draft as ``multipart/alternative`` (+ ``multipart/related`` for cid).

    The structure Gmail and Apple Mail both render inline images from::

        multipart/alternative
        ├── text/plain
        └── multipart/related        (cid mode only; else text/html directly)
            ├── text/html            <img src="cid:wids-mark">
            └── image/png            Content-ID: <wids-mark>, inline
    """
    if mark not in MARK_MODES:
        raise DraftError(f"mark must be one of {MARK_MODES}, got {mark!r}")
    if mark == "cid" and mark_png is None:
        raise DraftError("mark='cid' needs the PNG bytes (mark_png=)")
    body, hits = prepare_html(html, mark, mark_url)
    if mark == "cid" and hits == 0:
        raise DraftError(f"mark='cid' but the HTML never references {mark_url}")

    msg = EmailMessage(policy=policy.SMTP)
    msg["To"] = to
    msg["Subject"] = subject
    if sender:
        msg["From"] = sender
    msg["Message-ID"] = make_msgid(domain="wids-nyc.local")
    msg.set_content(text)
    msg.add_alternative(body, subtype="html")
    if mark == "cid":
        assert mark_png is not None
        html_part = next(p for p in msg.iter_parts() if p.get_content_type() == "text/html")
        assert isinstance(html_part, EmailMessage)
        html_part.add_related(
            mark_png,
            maintype="image",
            subtype="png",
            cid=f"<{MARK_CID}>",
            filename="mark-reader-96.png",
            disposition="inline",
        )
    return msg


def encode_raw(msg: EmailMessage) -> str:
    """The ``message.raw`` field: base64url of the full RFC 5322 message."""
    return base64.urlsafe_b64encode(msg.as_bytes()).decode("ascii")


def decode_raw(raw: str) -> EmailMessage:
    data = base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4))
    parsed = BytesParser(policy=policy.default).parsebytes(data)
    assert isinstance(parsed, EmailMessage)
    return parsed


SURVIVOR_MARKERS: tuple[tuple[str, str], ...] = (
    ("img", "<img"),
    ("svg", "<svg"),
    ("style", "<style"),
    ("class", "class="),
    ("mso", "<!--[if mso]"),
    ("cid", "cid:"),
    ("rewritten_href", "google.com/url?q="),
)


def survivors(html: str) -> dict[str, int]:
    """How much of our markup a stored body still carries. Zero ``img`` is the bug."""
    return {name: html.count(needle) for name, needle in SURVIVOR_MARKERS}


def html_body_of(msg: EmailMessage) -> str:
    part = msg.get_body(preferencelist=("html",))
    return part.get_content() if part is not None else ""


# ── Gmail REST (drafts only) ─────────────────────────────────────────────────


def _headers(access: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {access}"}


def _check(resp: httpx.Response, what: str) -> None:
    if resp.status_code == 200:
        return
    detail = f"{what} failed: {resp.status_code} {resp.text[:300]}"
    if resp.status_code in _RETRYABLE_STATUS:
        raise _RetryableHttp(detail)
    raise DraftError(detail)


@_gmail_retry
def create_draft(access: str, raw: str, *, http: httpx.Client | None = None) -> dict[str, object]:
    """``drafts.create`` with a raw message. The draft lands in the operator's Drafts folder.

    Retried on transport errors and 429/5xx (see ``_gmail_retry``). A retry
    after a request Gmail actually completed could create the draft twice;
    that is the one duplicate this tool can produce, and ``_emit`` reports
    what it created so the operator can check Drafts rather than guess.
    """
    resp = (http or httpx).post(
        f"{GMAIL_API}/drafts", headers=_headers(access), json={"message": {"raw": raw}}, timeout=60
    )
    _check(resp, "drafts.create")
    doc = resp.json()
    assert isinstance(doc, dict)
    return doc


@_gmail_retry
def get_draft_raw(access: str, draft_id: str, *, http: httpx.Client | None = None) -> EmailMessage:
    resp = (http or httpx).get(
        f"{GMAIL_API}/drafts/{draft_id}", headers=_headers(access), params={"format": "raw"}, timeout=60
    )
    _check(resp, "drafts.get")
    return decode_raw(resp.json()["message"]["raw"])


# ── Manifest ─────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class DraftSpec:
    to: str
    subject: str
    html: str
    text: str


def load_manifest(path: Path) -> list[DraftSpec]:
    """``[{"to", "subject", "html", "text"}]`` — html/text are file paths relative to the manifest."""
    doc = _read_json(path, "manifest")
    if not isinstance(doc, list) or not doc:
        raise DraftError(f"{path}: expected a non-empty JSON list")
    specs: list[DraftSpec] = []
    for i, entry in enumerate(doc):
        if not isinstance(entry, dict):
            raise DraftError(f"{path}: entry {i} is not an object")
        fields: dict[str, object] = {str(k): v for k, v in entry.items()}
        try:
            html_path = path.parent / str(fields["html"])
            text_path = path.parent / str(fields["text"])
            specs.append(
                DraftSpec(
                    to=str(fields["to"]),
                    subject=str(fields["subject"]),
                    html=html_path.read_text(encoding="utf-8"),
                    text=text_path.read_text(encoding="utf-8"),
                )
            )
        except (KeyError, FileNotFoundError) as exc:
            raise DraftError(f"{path}: entry {i} is missing or points at nothing: {exc}") from exc
    return specs


def write_reminder_manifest(
    *,
    recipients: list[dict[str, str]],
    tokens: dict[str, str],
    state: Literal["paper", "paper_pending"],
    out_dir: Path,
    subject: str,
) -> Path:
    """Render availability-reminder per recipient through the shared pipeline.

    ``render_body`` is the same function the preview renderer and the welcome
    composer run, so the body that goes into the draft is exactly the body
    ``render_email_previews`` would preview. The token set is derived from
    ``state`` the same way the preview derives it: in ``paper_pending`` every
    ``paper.*`` token is *removed* before rendering, so a block that still
    referenced one would fail as unresolved here rather than quietly
    substitute a paper into the "coming soon" email.
    """
    from scripts.render_email_previews import (
        TEMPLATES,
        RenderError,
        reminder_blocks_for_state,
        reminder_tokens_for_state,
        render_body,
    )

    blocks = reminder_blocks_for_state(state)
    state_tokens = reminder_tokens_for_state(tokens, state)
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest: list[dict[str, str]] = []
    for r in recipients:
        first, email = r["first"], r["email"]
        per = {**state_tokens, "recipient.firstName": first}
        bodies: dict[str, str] = {}
        for ext in ("html", "txt"):
            src = (TEMPLATES / f"availability-reminder.{ext}").read_text(encoding="utf-8")
            try:
                rendered, unresolved = render_body(
                    src, ext, blocks, per, label=f"availability-reminder.{ext}"
                )
            except RenderError as exc:
                raise DraftError(str(exc)) from exc
            if unresolved:
                raise DraftError(f"{email} {ext}: unresolved tokens {sorted(set(unresolved))}")
            bodies[ext] = rendered
        stem = _slug(email)
        (out_dir / f"{stem}.html").write_text(bodies["html"], encoding="utf-8")
        (out_dir / f"{stem}.txt").write_text(bodies["txt"], encoding="utf-8")
        manifest.append({"to": email, "subject": subject, "html": f"{stem}.html", "text": f"{stem}.txt"})
    path = out_dir / "manifest.json"
    path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    return path


# ── CLI ──────────────────────────────────────────────────────────────────────


def _client_from_args(args: argparse.Namespace) -> OAuthClient:
    path = args.client_secret or os.environ.get(ENV_CLIENT_SECRET)
    if not path:
        raise DraftError(f"pass --client-secret or set ${ENV_CLIENT_SECRET}")
    return OAuthClient.from_secret_file(Path(path).expanduser())


def _token_path(args: argparse.Namespace) -> Path:
    return Path(args.token or os.environ.get(ENV_TOKEN) or DEFAULT_TOKEN_PATH).expanduser()


def _mark_png(args: argparse.Namespace) -> bytes | None:
    if args.mark != "cid":
        return None
    return Path(args.mark_png).read_bytes()


def _build(spec: DraftSpec, args: argparse.Namespace) -> EmailMessage:
    return build_mime(
        to=spec.to,
        subject=spec.subject,
        html=spec.html,
        text=spec.text,
        sender=args.sender,
        mark=args.mark,
        mark_png=_mark_png(args),
    )


def cmd_auth(args: argparse.Namespace) -> int:
    client = _client_from_args(args)
    token = authorize(client, open_browser=not args.no_browser)
    path = _token_path(args)
    save_token(path, token)
    print(f"token saved to {path} (mode 600). Scope: {token.scope}")
    return 0


def _emit(specs: list[DraftSpec], args: argparse.Namespace) -> int:
    msgs = [_build(s, args) for s in specs]
    if args.dry_run:
        out = Path(args.dry_run)
        out.mkdir(parents=True, exist_ok=True)
        for spec, msg in zip(specs, msgs):
            (out / f"{_slug(spec.to)}.eml").write_bytes(msg.as_bytes())
        print(f"wrote {len(msgs)} .eml file(s) to {out} — nothing touched Gmail")
        return 0
    client = _client_from_args(args)
    access = access_token(client, _token_path(args))
    created: list[str] = []
    for spec, msg in zip(specs, msgs):
        try:
            doc = create_draft(access, encode_raw(msg))
        except (DraftError, httpx.HTTPError) as exc:
            # Each draft is its own request with no idempotency key, so a
            # failure mid-batch leaves the earlier ones in Drafts. Say exactly
            # which, so a re-run can be trimmed to the rest instead of
            # duplicating the ones that landed.
            remaining = [s.to for s in specs if s.to not in created and s.to != spec.to]
            raise DraftError(
                f"{exc}\n"
                f"  created before the failure ({len(created)}): {', '.join(created) or 'none'}\n"
                f"  failed: {spec.to}\n"
                f"  not attempted ({len(remaining)}): {', '.join(remaining) or 'none'}\n"
                f"  re-run with a manifest containing only the failed + not-attempted recipients"
            ) from exc
        created.append(spec.to)
        print(f"draft {doc.get('id')}  →  {spec.to}  ({spec.subject})")
    print(f"{len(msgs)} draft(s) created. Nothing was sent — open Gmail Drafts and send them yourself.")
    return 0


def cmd_create(args: argparse.Namespace) -> int:
    spec = DraftSpec(
        to=args.to,
        subject=args.subject,
        html=Path(args.html).read_text(encoding="utf-8"),
        text=Path(args.text).read_text(encoding="utf-8"),
    )
    return _emit([spec], args)


def cmd_batch(args: argparse.Namespace) -> int:
    return _emit(load_manifest(Path(args.manifest)), args)


def cmd_inspect(args: argparse.Namespace) -> int:
    client = _client_from_args(args)
    access = access_token(client, _token_path(args))
    msg = get_draft_raw(access, args.draft_id)
    html = html_body_of(msg)
    print(f"draft {args.draft_id}: content-type {msg.get_content_type()}")
    for name, count in survivors(html).items():
        print(f"  {name:<15} {count}")
    for part in msg.walk():
        if part.get_content_maintype() == "image":
            print(f"  image part: {part.get_filename()} cid={part.get('Content-ID')} "
                  f"disposition={part.get('Content-Disposition')}")
    return 0


def _load_recipients(path: Path) -> list[dict[str, str]]:
    doc = _read_json(path, "recipients")
    if not isinstance(doc, list) or not doc:
        raise DraftError(f"{path}: expected a non-empty JSON list of {{\"first\", \"email\"}}")
    out: list[dict[str, str]] = []
    for i, entry in enumerate(doc):
        fields = _as_object(entry) or {}
        first, email = fields.get("first"), fields.get("email")
        if not isinstance(first, str) or not isinstance(email, str):
            raise DraftError(f"{path}: entry {i} needs string 'first' and 'email' fields")
        out.append({"first": first, "email": email})
    return out


def _load_tokens(path: Path) -> dict[str, str]:
    doc = _as_object(_read_json(path, "tokens"))
    if doc is None:
        raise DraftError(f"{path}: expected a JSON object of string token values")
    out: dict[str, str] = {}
    for k, v in doc.items():
        if not isinstance(v, str):
            raise DraftError(f"{path}: token {k!r} must be a string, got {type(v).__name__}")
        out[k] = v
    return out


def cmd_reminder_manifest(args: argparse.Namespace) -> int:
    recipients = _load_recipients(Path(args.recipients))
    tokens = _load_tokens(Path(args.tokens))
    if "quote.text" not in tokens:
        from scripts.quotes import load_bundle, quote_tokens, select_quote

        tokens = {**tokens, **quote_tokens(select_quote(load_bundle(), int(time.time() // 86400)))}
    path = write_reminder_manifest(
        recipients=recipients, tokens=tokens, state=args.state, out_dir=Path(args.out), subject=args.subject
    )
    print(f"manifest: {path}  ({len(recipients)} recipient(s))")
    return 0


def _common(p: argparse.ArgumentParser) -> None:
    p.add_argument("--client-secret", help=f"OAuth client JSON (or ${ENV_CLIENT_SECRET})")
    p.add_argument("--token", help=f"token file (or ${ENV_TOKEN}; default {DEFAULT_TOKEN_PATH})")


def _draft_opts(p: argparse.ArgumentParser) -> None:
    _common(p)
    p.add_argument("--mark", choices=MARK_MODES, default="cid",
                   help="cid: inline PNG part (default); https: leave the remote img; none: drop it")
    p.add_argument("--mark-png", default=str(MARK_PNG), help="PNG for cid mode")
    p.add_argument("--from", dest="sender", default=None, help='e.g. "Michelle Rojas <you@gmail.com>"')
    p.add_argument("--dry-run", metavar="DIR", help="write .eml files here instead of touching Gmail")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="gmail_raw_drafts",
        description="Create Gmail drafts as raw MIME (never sends).",
    )
    sub = parser.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("auth", help="one-time OAuth consent; stores a refresh token")
    _common(p)
    p.add_argument("--no-browser", action="store_true", help="print the URL only")
    p.set_defaults(fn=cmd_auth)

    p = sub.add_parser("create", help="one draft from rendered html + text files")
    p.add_argument("--to", required=True)
    p.add_argument("--subject", required=True)
    p.add_argument("--html", required=True)
    p.add_argument("--text", required=True)
    _draft_opts(p)
    p.set_defaults(fn=cmd_create)

    p = sub.add_parser("batch", help="many drafts from a manifest.json")
    p.add_argument("--manifest", required=True)
    _draft_opts(p)
    p.set_defaults(fn=cmd_batch)

    p = sub.add_parser("inspect", help="read a draft back raw and report what survived")
    p.add_argument("--draft-id", required=True)
    _common(p)
    p.set_defaults(fn=cmd_inspect)

    p = sub.add_parser("reminder-manifest", help="render availability-reminder per recipient")
    p.add_argument("--recipients", required=True, help='JSON: [{"first": "...", "email": "..."}]')
    p.add_argument("--tokens", required=True, help="JSON of the non-recipient tokens")
    p.add_argument("--state", choices=("paper", "paper_pending"), required=True)
    p.add_argument("--out", required=True, help="directory for bodies + manifest.json")
    p.add_argument("--subject", default="We need you now more than ever — to have dinner with us")
    p.set_defaults(fn=cmd_reminder_manifest)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return int(args.fn(args))
    except DraftError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
