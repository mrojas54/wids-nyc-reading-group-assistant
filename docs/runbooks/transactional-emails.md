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
- **Do not document a token in live `{{ … }}` syntax inside a template
  comment.** `render()` substitutes every delimited token it finds, comments
  included, so a documented token gets replaced with the recipient's real
  values (leaking them into the shipped body) and counts as required even
  when the block using it is toggled off. List token names bare. For the same
  reason, never write a literal comment-close inside an HTML comment: it ends
  the comment early and dumps the remaining notes into the email as visible
  text.
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
| `welcome-availability.{html,txt}` | `.claude/commands/wids-add-member.md` Step 5, via `scripts/welcome_availability.py` | Welcome-and-vouch email for a new member. **Not renderable by `render_email_previews.py`** — it carries per-send block toggles that must be resolved before substitution, so it goes through `compose()` instead. Both bodies come from one `Content` object; a block toggled off drops from the HTML and the `.txt` twin together. `compose()` raises rather than returning a body with an unresolved token or a surviving marker. One header, no header toggle — the "court" variant was removed as not part of the Claude design. Preview with `uv run python -m scripts.welcome_availability`. |
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

Contract is enforced in code by `scripts/welcome_availability.py`, which raises
rather than returning a body with an unresolved token or a surviving block
marker. The per-token rationale — which tokens are deliberately unused, and the
first-name hazards — stays in that template's head comment, since it is design
reasoning rather than a field list.

## Preview and validation

Render all previewed templates:

```sh
uv run python -m scripts.render_email_previews
```

The command prints a JSON payload with rendered HTML/text bodies and fails if
any non-optional token is unresolved. It also regenerates ignored
`assets/emails/template/*_rendered.{html,txt}` files for visual inspection.

Focused tests for this pipeline:

```sh
uv run pytest -c tests/pytest.ini -v \
  tests/render_email_previews_test.py \
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

Apply migrations in numeric order through `020` before operating these
workflows. Keyed scheduled-task sends should check the exact key first, insert
the same key when logging success, and treat SQLSTATE `23505` from the unique
index as "already sent."

Current keys:

| Workflow | Key |
|---|---|
| Availability reminder to one non-submitter | `availability-chase:meeting=<meeting_id>:member=<member_id>` |
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
  scheduled-task spec that sends it.
- Do not commit `*_rendered.*` preview artifacts.
- Paper Pal links should use the stored relative companion path:
  `<portalBase><papers.companion_url>` (for example,
  `https://.../papers/2`), not the old `/papers/<slug>/companion` shape.
- Magic-link email rotation is manual in Supabase and separate from the
  structured quote pool used by the other templates.
