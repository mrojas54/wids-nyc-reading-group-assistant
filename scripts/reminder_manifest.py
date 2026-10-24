"""Render the availability-reminder per recipient into a draft manifest.

Split out of ``gmail_raw_drafts`` so the rendering half of ``reminder-manifest``
(validate the recipients and tokens, render each body through the shared
``render_body`` pipeline, write the bodies and ``manifest.json``) can be read and
tested apart from the MIME and Gmail half. Nothing here talks to Gmail; the
manifest it writes is what ``gmail_raw_drafts batch`` reads.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Literal

from scripts.gmail_oauth import DraftError, _as_object, _read_json


def _slug(email: str) -> str:
    """One filename stem per recipient, shared by the manifest bodies and the
    ``--dry-run`` ``.eml`` files so the two always correspond."""
    return re.sub(r"[^A-Za-z0-9._-]+", "_", email)


def load_recipients(path: Path) -> list[dict[str, str]]:
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


def load_tokens(path: Path) -> dict[str, str]:
    doc = _as_object(_read_json(path, "tokens"))
    if doc is None:
        raise DraftError(f"{path}: expected a JSON object of string token values")
    out: dict[str, str] = {}
    for k, v in doc.items():
        if not isinstance(v, str):
            raise DraftError(f"{path}: token {k!r} must be a string, got {type(v).__name__}")
        out[k] = v
    return out


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
