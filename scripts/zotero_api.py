"""Zotero write layer: the item and note payloads, and the pyzotero calls that send them.

Split out of ``zotero_push`` so what Zotero receives (item fields, the
``wids_paper_id`` correlator in ``extra``, the WiDS context note) can be read and
tested apart from the database reads and the CLI.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional
from zoneinfo import ZoneInfo

from pyzotero import Zotero


_NY_TZ = ZoneInfo("America/New_York")


def build_note_html(
    *,
    meeting_at: Optional[datetime],
    leader_name: Optional[str],
    topic_names: list[str],
    companion_path: Optional[str],
    prod_host: str,
) -> str:
    """Render the WiDS context note attached as a child of the Zotero item.

    Lines for missing inputs are omitted entirely (no "Leader: None").
    """
    lines = [
        "<p><strong>WiDS NYC Reading Group</strong></p>",
        "<ul>",
    ]
    if meeting_at is not None:
        meeting_local = meeting_at.astimezone(_NY_TZ)
        meeting_str = meeting_local.strftime("%A, %B %-d, %Y")
        lines.append(f"  <li><strong>Meeting:</strong> {meeting_str}</li>")
    if leader_name:
        lines.append(f"  <li><strong>Leader:</strong> {leader_name}</li>")
    if topic_names:
        joined = " / ".join(topic_names)
        lines.append(f"  <li><strong>Topic:</strong> {joined}</li>")
    if companion_path:
        full = prod_host.rstrip("/") + companion_path
        lines.append(
            f'  <li><strong>Companion:</strong> <a href="{full}">{full}</a></li>'
        )
    lines.append("</ul>")
    return "\n".join(lines)


def _split_author(name: str) -> dict[str, str]:
    """Split a 'First Last' string into Zotero's creator shape.

    Single-token names go in lastName (Zotero's convention for mononyms);
    multi-token names split on the last whitespace.
    """
    parts = name.strip().rsplit(" ", 1)
    if len(parts) == 1:
        return {"creatorType": "author", "firstName": "", "lastName": parts[0]}
    first, last = parts
    return {"creatorType": "author", "firstName": first, "lastName": last}


def _fill_item_template(
    template: dict[str, Any], meta: dict[str, Any], paper_id: int
) -> dict[str, Any]:
    """Overlay our metadata onto a pyzotero item template."""
    extra_lines = [f"wids_paper_id:{paper_id}"]
    if meta.get("arxiv_id"):
        extra_lines.append(f"arXiv:{meta['arxiv_id']}")

    item = dict(template)
    item["title"] = meta.get("title", "")
    item["creators"] = [_split_author(a) for a in meta.get("authors", []) if a]
    item["abstractNote"] = meta.get("abstract") or ""
    item["url"] = meta.get("url", "")
    item["extra"] = "\n".join(extra_lines)
    item["tags"] = [{"tag": "WiDS NYC Reading Group"}]

    if meta.get("year") is not None:
        item["date"] = str(meta["year"])

    if meta.get("doi"):
        item["DOI"] = meta["doi"]
    if meta.get("venue"):
        if meta["item_type"] == "journalArticle":
            item["publicationTitle"] = meta["venue"]
        elif meta["item_type"] == "conferencePaper":
            item["proceedingsTitle"] = meta["venue"]
        elif meta["item_type"] == "bookSection":
            item["bookTitle"] = meta["venue"]

    return item


def create_zotero_item(
    *,
    meta: dict[str, Any],
    paper_id: int,
    api_key: str,
    group_id: str,
) -> str:
    """Create a Zotero item via pyzotero; return the assigned 8-char item key.

    Raises RuntimeError if Zotero reports the item as failed.
    """
    zot = Zotero(library_id=group_id, library_type="group", api_key=api_key)
    template = zot.item_template(meta["item_type"])
    payload = [_fill_item_template(template, meta, paper_id)]

    result = zot.create_items(payload)
    if result.get("failed"):
        raise RuntimeError(f"Zotero rejected item: {result['failed']}")
    successful = result.get("successful") or {}
    if "0" not in successful:
        raise RuntimeError(f"Zotero response missing successful[0]: {result}")
    return str(successful["0"]["key"])


def create_zotero_note(
    *,
    parent_item_key: str,
    note_html: str,
    api_key: str,
    group_id: str,
) -> str:
    """Create a child note attached to `parent_item_key` via pyzotero."""
    zot = Zotero(library_id=group_id, library_type="group", api_key=api_key)
    payload = [{
        "itemType": "note",
        "parentItem": parent_item_key,
        "note": note_html,
        "tags": [],
    }]
    result = zot.create_items(payload)
    if result.get("failed"):
        raise RuntimeError(f"Zotero rejected note: {result['failed']}")
    return str(result["successful"]["0"]["key"])


def find_existing_zotero_item(
    *,
    paper_id: int,
    api_key: str,
    group_id: str,
) -> Optional[str]:
    """Return the Zotero item key of any existing item whose `extra`
    contains `wids_paper_id:<paper_id>`, else None.

    Defense-in-depth: covers the rare case where a previous run created
    a Zotero item but crashed before writing papers.zotero_item_key.
    """
    correlator = f"wids_paper_id:{paper_id}"
    zot = Zotero(library_id=group_id, library_type="group", api_key=api_key)
    items = zot.items(q=correlator, qmode="everything")
    for item in items:
        extra = (item.get("data", {}) or {}).get("extra") or ""
        if correlator in extra:
            key = item.get("key")
            if key:
                return str(key)
    return None
