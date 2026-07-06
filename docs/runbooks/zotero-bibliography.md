# Zotero bibliography runbook

This repo can publish papers read by the WiDS NYC AI Reading Group to the
public Zotero group library (`ZOTERO_GROUP_ID=6540956`). The bibliography is
the long-term library of record: each Zotero item stores paper metadata, and a
child note stores WiDS-specific context such as meeting date, leader, topic,
and companion URL.

## Codepaths covered

| Codepath | Role |
|---|---|
| `scripts/zotero_push.py` | CLI and importable functions for single-paper pushes and CSV backfills. |
| `migrations/009_papers_zotero_item_key.sql` | Adds `papers.zotero_item_key`, the local idempotency marker. |
| `.claude/commands/wids-make-companion.md` | Legacy fallback command that invokes the push after `papers.companion_url` is updated. |
| `.claude/commands/wids-zotero-retry.md` | Operator recovery command for failed single-paper pushes. |
| `docs/superpowers/specs/wids-zotero-historical-readings.csv` | Historical readings input for one-time backfill. |
| `tests/zotero_push_test.py` | Unit coverage for URL normalization, metadata extraction, idempotency, notes, CLI exits, and backfill behavior. |

## Current integration status

The supported companion-generation path is Paper Pal in the member portal
(`/new` -> `/papers/<id>`). The automatic Zotero hook still lives in the
deprecated `/wids-make-companion` fallback command, so Paper Pal-created
papers are **not pushed by the portal itself**.

When the public bibliography must stay current after a Paper Pal companion is
saved, run the same script manually:

```sh
uv run scripts/zotero_push.py --paper-id=<paper_id> --meeting-id=<meeting_id>
```

Run it only after `papers.companion_url` has been populated; otherwise the
Zotero child note omits the companion link.

## One-time setup

1. Apply migrations through `009_papers_zotero_item_key.sql` or later. The
   current migration set includes this column.
2. Configure the Zotero group at zotero.org as public with closed membership:
   the public can read the library, but only invited operators can write.
3. Create a Zotero API key with write access to group `6540956`.
4. Add these values to the operator shell or `web/.env.local`:

   ```sh
   SUPABASE_DB_URL=postgresql://...
   ZOTERO_API_KEY=...
   ZOTERO_GROUP_ID=6540956
   WIDS_PROD_HOST=https://wids-nyc-reading-group-assistant.vercel.app
   ```

`scripts/zotero_push.py` loads `web/.env.local` first and lets process
environment variables override it.

## Single-paper push

Use this after a paper row, meeting row, and companion URL already exist:

```sh
uv run scripts/zotero_push.py --paper-id=42 --meeting-id=7
```

Exit codes:

| Code | Meaning | Operator action |
|---|---|---|
| `0` | Created the Zotero item, recovered an existing item, or skipped because `papers.zotero_item_key` was already set. | No action. |
| `1` | Push failed after configuration loaded. The script writes a `command_log` failure row when possible. | Inspect stderr and retry with `/wids-zotero-retry <meeting-id>` after fixing the cause. |
| `2` | Missing CLI arguments, missing env vars, or missing CSV path. | Fix local invocation/configuration and rerun. |

On success the script prints:

```text
Zotero push: paper <paper_id> -> item <item_key>
```

## What gets sent to Zotero

The script resolves metadata from `papers.url` in this order:

1. Normalize the URL:
   - `http` becomes `https`.
   - Hostnames are lowercased.
   - `arxiv.org/pdf/<id>[.pdf]` becomes `arxiv.org/abs/<id>`.
   - arXiv query strings are dropped.
   - query strings containing `needAccess` are dropped.
2. For arXiv URLs, call the arXiv Atom API and create a Zotero `preprint`.
3. For non-arXiv URLs with a DOI in the path, call CrossRef and map the
   CrossRef type to a Zotero item type.
4. For other URLs, fetch the page and look for a
   `<meta name="citation_doi" content="...">` tag. Timeouts, non-200
   responses, non-HTML responses, or missing tags fall back to the DB row.
5. If no remote metadata source works, use `papers.title`, `papers.authors`,
   `papers.abstract`, `papers.venue`, and `papers.year` as a Zotero `webpage`.

The Zotero item always includes the tag `WiDS NYC Reading Group` and the
`extra` correlator `wids_paper_id:<paper_id>`. arXiv items also include
`arXiv:<id>` in `extra`.

The child note is HTML. Missing fields are omitted rather than rendered as
`None`:

```html
<p><strong>WiDS NYC Reading Group</strong></p>
<ul>
  <li><strong>Meeting:</strong> Thursday, March 12, 2026</li>
  <li><strong>Leader:</strong> Michelle Rojas</li>
  <li><strong>Topic:</strong> LLM Security / Adversarial ML</li>
  <li><strong>Companion:</strong> <a href="https://.../papers/12">https://.../papers/12</a></li>
</ul>
```

Meeting dates are rendered in `America/New_York`.

## Idempotency and recovery

Two checks prevent duplicate bibliography entries:

1. `papers.zotero_item_key` is returned immediately when already set.
2. If the DB column is null, Zotero is searched for
   `wids_paper_id:<paper_id>` before creating a new item. If found, the script
   backfills `papers.zotero_item_key` and exits successfully.

If a single-paper push fails, the script records a `command_log` row with:

- `source='slash_command'`
- `name='/wids-make-companion:zotero-push'`
- `status='failure'`
- `error='<ExceptionType>: <message>'`

Recover with:

```text
/wids-zotero-retry <meeting-id>
```

That command looks up `meetings.paper_id`, reruns the script, and writes a
`/wids-zotero-retry` success row only when the retry exits `0`.

## Historical backfill

The enriched historical CSV lives at:

```text
docs/superpowers/specs/wids-zotero-historical-readings.csv
```

Preview without writing:

```sh
uv run scripts/zotero_push.py \
  --from-csv=docs/superpowers/specs/wids-zotero-historical-readings.csv \
  --dry-run
```

Run the live backfill:

```sh
uv run scripts/zotero_push.py \
  --from-csv=docs/superpowers/specs/wids-zotero-historical-readings.csv
```

Backfill mode:

- requires `SUPABASE_DB_URL` for dry runs;
- also requires `ZOTERO_API_KEY` and `ZOTERO_GROUP_ID` for live writes;
- commits each successful row independently;
- continues after row-level failures and returns exit `1` if any row failed;
- creates notes without companion links because historical readings predate
  Paper Pal companion pages.

## Troubleshooting

| Symptom | Check |
|---|---|
| `missing env var ...` | Populate the variable in `web/.env.local` or export it in the shell; process env wins over file values. |
| Duplicate-looking item in Zotero | Search the Zotero item's `extra` field for `wids_paper_id:<paper_id>` and compare with `papers.zotero_item_key`. The script can heal a missing DB key when rerun. |
| Item has weak metadata | Confirm `papers.url` is an arXiv URL, contains a DOI, or exposes `citation_doi`; otherwise the DB fallback is expected. Improve `papers` metadata before rerunning if needed. |
| Child note lacks topic | Check `paper_topics` for the paper. The note only joins existing topic rows; it does not infer topics. |
| Child note lacks companion link | Ensure `papers.companion_url` is set before pushing and `WIDS_PROD_HOST` has no trailing slash. |
| Retry keeps failing | Inspect the newest `command_log` failure row and stderr. Zotero 4xx/5xx, arXiv/CrossRef network failures, or invalid credentials surface as exit `1`. |

## Local verification

Run the focused test file:

```sh
uv run pytest tests/zotero_push_test.py -v
```

If dependencies are not synced, use the inline test command from the test
header:

```sh
uv run --with pytest --with responses --with "psycopg[binary]" --with pyzotero \
  pytest tests/zotero_push_test.py -v
```
