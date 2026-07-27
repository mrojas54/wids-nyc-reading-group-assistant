# Transactional email runbook

Use this when editing, previewing, or operating the member-facing email
templates. It maps the template files to their live consumers so preview-only
work does not get mistaken for production behavior.

## Architecture

- Template sources live in `assets/emails/template/` as `.html` + `.txt` pairs.
- `scripts/render_email_previews.py` performs flat Mustache-style substitution
  only (`{{ token.path }}`). It has no partials or conditionals; scheduled-task
  prompts and Python composers must resolve branching before substitution.
  `scripts/welcome_availability.py` is the worked example of a composer:
  block markers stripped first, then substitution, then a wrap pass on the
  text body.
- **HTML comments never ship.** Every path that turns a template into a body
  — `render_pair()` in the preview renderer, `compose()` in
  `welcome_availability.py`, `render_new_paper_email()` in
  `generate_prerequisites.py` — runs
  `render_email_previews.strip_html_comments()` on the HTML *before*
  substitution. Head comments carry repo paths, migration numbers, and the
  alternate wording of copy the recipient is reading; none of it belongs in an
  inbox via "Show original", and it is several KB on every send. Outlook's
  conditional comments (`<!--[if mso]>`, the downlevel-revealed
  `<!--[if !mso]><!-- -->` pair) are lifted to sentinels and restored, so they
  survive. Add a new send path and you must strip on it too — a `.txt` twin
  needs no strip, since its doc header is a `[[BEGIN:_doc]]` block.
- Because stripping runs first, documenting a token in live `{{ … }}` syntax
  inside a comment is no longer a leak: the comment is gone before `render()`
  sees it. (It used to substitute the recipient's real values into the shipped
  comment — `rsvp-confirmation.html`'s header rendered as "Template tokens are
  Mustache-style (Maya)".) Listing token names bare is still the clearer
  house style, but nothing depends on it now.
- **Never write a literal comment-close inside an HTML comment.** This one
  still bites, and harder than before: `-->` ends the comment early, so the
  stripper removes only up to that point and dumps the remaining notes into
  the email as visible text.
- Preview rendering writes `*_rendered.html` and `*_rendered.txt` next to the
  sources. Those files are ignored by git and should not be committed.
- Member-facing scheduled-task sends use the operator Gmail MCP. Supabase Auth
  magic-link emails are separate: Supabase stores static template copies.
- At-most-once sends require migration
  `020_command_log_enrichment.sql`, which adds `command_log.idempotency_key`
  and the `command_log_idempotency_key_unique` partial unique index.

## Template matrix

| Template | Current consumer | Status / constraints |
|---|---|---|
| `magic-link.{html,txt}` | Supabase Auth dashboard -> Email Templates -> Magic Link | Static copy. Rotate manually; see `docs/email-quotes.md`. Not rendered by `render_email_previews.py`. |
| `availability-reminder.{html,txt}` | `scheduled_tasks/availability-chase.md` Step 5c | Live only after the operator replies `remind`. Sent one recipient at a time to active members without an `availability` row for the meeting. Lede ("It's been too long") is written for a lapsed regular — for a brand-new member use `welcome-availability` instead. Note the location-chip marker in the HTML is longer than the chase spec quotes it (`BEGIN-OPTIONAL-CHIP: location \| OMIT …`); a matcher built on the quoted form silently mails an empty chip. |
| `rsvp-confirmation.{html,txt}` | `scheduled_tasks/pre-meeting-reminder.md` Step 4a and `scheduled_tasks/availability-chase.md` Step 5e | Live for attending RSVPs 2 days before a meeting, and for availability submitters during the operator-triggered chase follow-up. |
| `welcome-availability.{html,txt}` | `.claude/commands/wids-add-member.md` Step 5, via `scripts/welcome_availability.py` | Welcome-and-vouch email for a new member. Flow: [`docs/welcome-availability-flow.md`](../welcome-availability-flow.md). **Not renderable by `render_email_previews.py`** — it carries per-send block toggles that must be resolved before substitution, so it goes through `compose()` instead. Both bodies come from one `Content` object; a block toggled off drops from the HTML and the `.txt` twin together. `compose()` raises rather than returning a body with an unresolved token or a surviving marker. One header, no header toggle — the "court" variant was removed as not part of the Claude design. Preview with `uv run python -m scripts.welcome_availability`. |
| `availability-thanks.{html,txt}` | `scripts/render_email_previews.py` | Previewed and tested, but no current scheduled-task spec references it. Verify the send path before wiring it into a live workflow. |
| `pre-meeting-reminder.{html,txt}` | `scripts/render_email_previews.py` | Preview-only. The live `pre-meeting-reminder` task still sends `rsvp-confirmation` to attending members and a plain-text reminder to tentative/no-response members. |
| `new-paper-announcement.{html,txt}` | `scheduled_tasks/new-paper-announcement.md` | Court/queens announcement, **operator-triggered** per new cycle. Per-member Gmail **drafts** — never auto-send. Paper-card fields and prerequisites come from `papers.prerequisites` (JSONB) via `scripts/generate_prerequisites.py` (`--mode gather` then `render`); per-send tokens (`recipient.firstName`, `lead.*`, `signoff.names`, `links.*`) are operator-supplied; `quote.*` rotated from the shared pool. Full field list under Token contracts below. |

## Token contracts

Authoritative list of merge fields per template. **This is the only copy** — the
template head comments used to duplicate it and were collapsed to pointers here,
because two copies drift silently and the templates cannot be trusted to carry
the current one.

Token names are written bare throughout, for the reason given in Architecture
above: a delimited token inside a comment gets substituted with real recipient
values and counts as required even when its block is off.

### `availability-thanks`

Required — refuse to send if any is unresolved:

    recipient.firstName
    paper.title, paper.authorsShort, paper.citation, paper.url
    operator.displayName
    links.portalBase

Optional, with fallbacks:

    paper.location            omit the chip entirely if null
    paper.duration            fallback "~90 min"
    paper.companionDropDay    fallback "Wed"
    links.companionPreview    fallback to the literal "Preview link coming soon"
                              (see Step 5b note in availability-chase.md)
    quote.text / quote.by / quote.role
                              fallback to the seed Grace Hopper quote

### `rsvp-confirmation`

Required — refuse to send if any is unresolved:

    recipient.firstName
    links.calendar, links.rsvpManage, links.portalBase
    paper.title, paper.authorsShort, paper.companionUrl

Optional / rotated — fall back to `haiku[0]` plus the Grace Hopper quote:

    haiku.line1, haiku.line2, haiku.line3
    quote.text, quote.by, quote.role

### `new-paper-announcement`

Required hydrated tokens; `render()` refuses to emit if any is unresolved:

    recipient.firstName
    lead.name, lead.initial, lead.blurb
    paper.title, paper.shortTitle, paper.summary, paper.authorsShort, paper.url
    prereqs.lede, prereqs.html          (the .txt twin uses prereqs.text)
    signoff.names
    links.availability, links.rsvpManage

Rotated from the shared pool, has a fallback:

    quote.text, quote.by, quote.role

### `availability-reminder`

Merge fields live in `scheduled_tasks/availability-chase.md` (Step 5: operator
`remind` flow), which is its operational spec. Not duplicated here.

### `pre-meeting-reminder`

Previously undocumented anywhere — recorded here 2026-07-27 after an audit found
five tokens with no contract in any file. Preview-only today; verify against the
live send path before wiring it into a workflow.

    recipient.firstName
    meeting.when, meeting.dayName, meeting.location, meeting.leader
    paper.title, paper.subtitle, paper.companionUrl
    questions.lede, questions.html      (the .txt twin uses questions.text)
    links.calendar, links.rsvpManage
    signoff.names
    quote.text, quote.by, quote.role

`questions.*` are emitted by `scripts/discussion_questions.py` so the template
stays logic-free — see the Discussion-question workflow section below. `quote.*`
comes from the shared pool with a fallback. The `.html` and `.txt` twins are
otherwise identical in their field set.

### `welcome-availability`

Enforced by `scripts/welcome_availability.py` — raises `CompositionError`
rather than returning a body with an unresolved token or a surviving block
marker. Lifecycle and block toggles:
[`docs/welcome-availability-flow.md`](../welcome-availability-flow.md).

Always required (appear outside optional blocks):

    vouch.firstName          members.vouched_by → members.name, first name only
                             Required even when Blocks(vouch=False) — see wart
                             in the flow doc (intro / preheader / footer).
    answerBy                 operator date, e.g. "Mon, Aug 3"
    links.availability       <portalBase>/availability?meeting=<id>
    signoff.names            e.g. "Michelle & Claudia"
    operator.email           footer reply-to

Required when their block is on:

    vouch.blurb              vouch block — sender-vs-third-party copy
    links.companion          paper_card — only if paper_companions.payload exists
    paper.title / paper.byline / paper.citation / paper.hook
    quote.text / quote.by    quote block — scripts/quotes.py rotation

Deliberately unused:

    recipient.firstName      greeting is fixed "Hey Queen,"

Optional blocks (defaults all on): `vouch`, `meet_strip`, `availability`,
`note`, `paper_card`, `quote`. HTML path escapes every token value; the `.txt`
twin does not. Plain-text body is re-wrapped to 68 columns after substitution
(URLs left intact).

## Preview and validation

Render the flat-substitution templates:

```sh
uv run python -m scripts.render_email_previews
```

The command prints a JSON payload with rendered HTML/text bodies and fails if
any non-optional token is unresolved. It also regenerates ignored
`assets/emails/template/*_rendered.{html,txt}` files for visual inspection.

`welcome-availability` is **not** in that set. Preview it separately:

```sh
uv run python -m scripts.welcome_availability
```

Focused tests for this pipeline:

```sh
uv run pytest -c tests/pytest.ini -v \
  tests/render_email_previews_test.py \
  tests/welcome_availability_test.py \
  tests/discussion_questions_test.py \
  tests/quotes_select_test.py \
  tests/build_quotes_test.py
```

CI runs the same Python checks, plus `uv run ruff check scripts tests` and
`uv run ty check`.

## Quote workflow

The shared women-in-STEM quote pool lives under `data/quotes/<author-slug>/`:

- `author.json` stores required author metadata (`id`, `name`, `role`).
- The newest `YYYYMMDD_quotes.json` file in the folder is the active quote set.
- `quotes.json` is only a human convenience symlink.
- Only `verified: true` quotes are eligible for email selection.
- Verified quotes must include `sourceUrl` and `source`; otherwise the build
  fails.

After editing quote data, rebuild and commit the generated bundle:

```sh
uv run python scripts/build_quotes.py
```

This validates the quote folders and rewrites
`web/lib/quotes.generated.json`, which is used by both Python email previews
(`scripts/quotes.py`) and the web dashboard (`web/lib/quotes.ts`).

## Discussion-question workflow

`pre-meeting-reminder.{html,txt}` gets its question block from
`data/discussion-questions/sample.json` through
`scripts/discussion_questions.py`.

Current constraints:

- The question source is static and preview-only.
- `load_questions()` requires a non-empty `questions` array of non-empty
  strings.
- `question_tokens()` emits `questions.lede`, `questions.html`, and
  `questions.text` so the template stays logic-free.
- Per-paper question loading is not implemented yet; do not document or depend
  on it as live behavior.

After changing the question source or composer, run the preview command and
`tests/discussion_questions_test.py`.

## Idempotency keys

Apply migrations in numeric order through at least `020` (idempotency) before
operating these workflows; welcome/add-member also needs `023`
(`members.vouched_by`). Keyed sends should check the exact key first, insert
the same key when logging success, and treat SQLSTATE `23505` from the unique
index as "already sent."

Current keys:

| Workflow | Key |
|---|---|
| Availability reminder to one non-submitter | `availability-chase:meeting=<meeting_id>:member=<member_id>` |
| `/wids-add-member` welcome send (after operator confirms) | **Same key** as the chase reminder above — deliberate namespace share so the nightly chase does not re-nudge |
| Availability thank-you to one submitter | `availability-chase:thanks:meeting=<meeting_id>:member=<member_id>` |
| Pre-meeting reminder run for one meeting | `pre-meeting-reminder:meeting=<id>` |
| Post-meeting thanks run for one meeting | `post-meeting-thanks:meeting=<id>` |
| New-paper announcement drafts for one paper | `new-paper-announcement:paper=<paper_id>` |

`availability-chase` operator alerts intentionally do **not** use
`idempotency_key`; they use `metadata.kind = 'operator_alert'` plus
`metadata.meeting_id` for a 5-day cooldown so repeated low-response alerts can
fire while a meeting remains under-responded.

Avoid `summary LIKE` scans for new or updated workflows. They are brittle and
do not provide the database-level at-most-once guarantee that migration 020
provides.

## Common pitfalls

- Do not assume a template is live because it renders in previews. Check the
  scheduled-task spec or slash command that sends it.
- Do not commit `*_rendered.*` preview artifacts.
- Do not drive `welcome-availability` through `render()` / `render_pair()` —
  unresolved block markers would ship. Use `compose()`.
- `/wids-add-member` cannot send. Do not offer `reply send`; open the Gmail
  draft. Do not write the chase idempotency key for an unsent draft.
- Paper Pal links should use the stored relative companion path:
  `<portalBase><papers.companion_url>` (for example,
  `https://.../papers/2`), not the old `/papers/<slug>/companion` shape. For
  the welcome paper card, verify `paper_companions.payload` exists before
  leaving `paper_card` on.
- Magic-link email rotation is manual in Supabase and separate from the
  structured quote pool used by the other templates.
- Client-behaviour claims (mark loss, compose sanitiser) belong in
  `docs/runbooks/email-client-behavior.md`, not in template head comments.
