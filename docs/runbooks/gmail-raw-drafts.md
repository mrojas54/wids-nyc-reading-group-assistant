# Raw-MIME Gmail drafts — `scripts/gmail_raw_drafts.py`

The drafting path that can carry the mark. The Gmail MCP's `create_draft`
sanitises the body when it writes the draft — every `<img>`, `<svg>`, `<style>`,
class and Outlook conditional removed, every href rewritten — so nothing it
drafts ever shows the WiDS mark (`email-client-behavior.md`,
`VERIFIED 2026-09-02`). The Gmail REST API's `drafts.create` with a `raw` message
stores MIME verbatim. This script builds that MIME and writes the draft.

**It never sends.** There is no send call in the file and no CLI verb for it;
`tests/gmail_raw_drafts_test.py` fails if one is added. The operator opens
Gmail Drafts and presses Send, exactly as with MCP-drafted mail. The standing
rule in `README.md` and `transactional-emails.md` is unchanged.

**About the scope.** Google has no drafts-only OAuth scope. The narrowest scope
that can write a draft is `gmail.compose`, and that scope also *permits*
sending. The script does not use that permission. If that trade is not
acceptable, do not run `auth`; the paste-before-Send workaround in
`email-client-behavior.md` needs no credential at all.

## One-time setup (operator's machine, ~10 minutes)

1. **Google Cloud project.** <https://console.cloud.google.com> → New project
   (any name, e.g. `wids-drafts`).
2. **Enable the Gmail API.** APIs & Services → Library → Gmail API → Enable.
3. **OAuth consent screen.** APIs & Services → OAuth consent screen → External
   → app name `WiDS drafts`, your email for both contacts → Save. Under
   *Test users*, add `mirojas1524@gmail.com`. (Testing mode is fine; refresh
   tokens for test users last 7 days, so expect to re-run `auth` weekly. To
   avoid that, publish the app — no verification is needed for a single
   personal account.)
4. **OAuth client.** APIs & Services → Credentials → Create credentials → OAuth
   client ID → Application type **Desktop app** → Create → Download JSON. Save it
   somewhere private, e.g. `~/.config/wids/gmail-client.json`. **Never commit it.**
5. **Authorise once:**

   ```bash
   export WIDS_GMAIL_CLIENT_SECRET=~/.config/wids/gmail-client.json
   uv run python -m scripts.gmail_raw_drafts auth
   ```

   A browser opens on the consent screen (make sure it is signed in as the
   operator). Approve. The refresh token lands in
   `~/.config/wids/gmail-token.json`, mode 600.

Both env vars are optional; `--client-secret` and `--token` do the same.

## Usage

### One draft

```bash
uv run python -m scripts.gmail_raw_drafts create \
  --to niki@example.com \
  --subject "We need you now more than ever — to have dinner with us" \
  --html out/niki.html --text out/niki.txt \
  --from "Michelle Rojas <mirojas1524@gmail.com>"
```

`--mark` controls the mark:

| mode | what happens |
|---|---|
| `cid` (default) | the PNG rides inside the message as an inline part; the template's `<img src="https://…/mark-reader-192.png">` is rewritten to `src="cid:wids-mark"` |
| `https` | the HTML is left alone; the mark loads from Vercel at open time |
| `none` | the mark `<img>` is removed; the 48px cell stays |

`--dry-run DIR` writes `.eml` files instead of touching Gmail — open one in a
mail client to eyeball it, or `inspect` it after a real run.

### The reminder batch (what the chase step does by hand today)

```bash
# 1. who + what — recipients.json: [{"first": "Niki", "email": "…"}, …]
#    tokens.json: the non-recipient tokens (stats.*, deadline.soft, links.*,
#    operator.displayName, cta.*). quote.* is filled in for today if absent.
uv run python -m scripts.gmail_raw_drafts reminder-manifest \
  --recipients recipients.json --tokens tokens.json \
  --state paper_pending --out /tmp/reminders

# 2. nine drafts, one call
uv run python -m scripts.gmail_raw_drafts batch --manifest /tmp/reminders/manifest.json
```

`reminder-manifest` renders through the same helpers as
`scripts.render_email_previews` — blocks resolved, shared fragments spliced,
HTML comments stripped, tokens substituted — so the body in the draft is the
body the preview shows. Any other template: render it however its composer
renders it, then `create` / `batch` with the files.

### Read a draft back

```bash
uv run python -m scripts.gmail_raw_drafts inspect --draft-id r-1234567890
```

Prints how many `<img>`, `<svg>`, `<style>`, `class=` and rewritten hrefs the
*stored* body carries, plus every image part with its Content-ID. Zero `img`
on a draft this script wrote would mean Gmail sanitised the API path too.

## The remaining experiment

Everything verified so far is about what the connector stores. What is not yet
known is whether **the compose window keeps a raw-MIME draft intact on Send.**
Run this once:

1. `reminder-manifest` for one recipient — yourself — then `batch`.
2. `inspect` the draft. Expect `img 1`, `cid 1`, `style 1`, an `image/png` part
   with `Content-ID: <wids-mark>`.
3. Open Gmail Drafts, open it, do not edit anything, press Send.
4. Read the delivered message with the Gmail MCP `get_message`
   (`FULL_CONTENT`). Look for `<img` in the HTML and the mark on screen.

| Delivered mail | Conclusion | Record it as |
|---|---|---|
| mark renders | The API path is the fix. Move member drafting onto this script. | `VERIFIED` in `email-client-behavior.md`, with the message ID |
| mark absent | The composer re-sanitises on Send. Raw drafts do not help; only paste-before-Send or the text wordmark remain. | same |

Whichever way it goes, that is the last open question in `HANDOFF.md`.

## Files this touches

- `~/.config/wids/gmail-client.json` — the OAuth client. Private, never committed.
- `~/.config/wids/gmail-token.json` — access + refresh token, mode 600. Revoke
  at <https://myaccount.google.com/permissions> (app "WiDS drafts") to invalidate.
- Nothing in the repo. The script reads templates and the branding PNG only.
