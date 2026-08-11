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
- New-paper announcement drafts additionally require migration
  `022_papers_prerequisites.sql`, which adds the editable
  `papers.prerequisites` JSONB bundle.
- Welcome-and-availability drafts use migration
  `023_members_vouched_by.sql` to persist the optional member who vouched for
  the recipient.

## Shared fragments

Three pieces of markup are shared across templates instead of duplicated:
the wordmark, the primary CTA button's skeleton, and the footer's brand
line. Each lives in its own `assets/emails/template/_*_shared.html` file and
is spliced into host templates via a literal, non-Mustache placeholder —
`__WORDMARK_BLOCK__`, `__CTA_BLOCK__`, `__FOOTER_BRAND_BLOCK__` — never an
HTML comment (would be deleted by `strip_html_comments()`, which runs before
substitution) and never wrapped in `{{ }}` itself (a bare `{{ }}` fragment
placeholder would be corrupted by `welcome_availability.py`'s blanket
`html.escape()` over every token value).

`scripts.render_email_previews.splice_shared_blocks()` does all three
replacements in one pass; `find_surviving_placeholders()` reports which (if
any) didn't get spliced. Both `render_pair()` and `welcome_availability.py`'s
`_compose_one()` call `splice_shared_blocks()` first — before comment
stripping, before any token dict is touched — and both raise
(`RenderError` / `CompositionError`) if a placeholder survives to the end of
rendering, the same "nothing unresolved ships" invariant
`welcome_availability.py` already enforces for `{{ }}` tokens and block
markers.

`magic-link.html` cannot consume the splice mechanism at all — it is
hand-pasted into the Supabase Auth dashboard and uses Go template syntax, not
Python. Each fragment it contains is hand-synced instead, wrapped in its own
sentinel comments (`<!-- WORDMARK:BEGIN -->`, `<!-- CTA:BEGIN -->`,
`<!-- FOOTER_BRAND:BEGIN -->`, each with a matching `:END`) and checked by
tests in `tests/render_email_previews_test.py`. Edit the shared source file
first, then hand-port the change into `magic-link.html`'s copy — never the
other direction.

### Wordmark

`_wordmark_shared.html` (48x48 mark + "WiDS NYC" + magenta rule + "AI
Reading Group") replaced four previously-divergent per-template treatments,
one of which — `welcome-availability`'s last real send — shipped with no
wordmark at all (see `docs/runbooks/email-client-behavior.md` for that
investigation; it is unrelated to and unresolved by this change).

- 100% inline-styled, depends on zero per-template `<head>` classes except
  one: `.wordmark-name`, which carries no styling itself and exists purely
  as an MSO conditional-comment selector hook. Every host template's
  `<!--[if mso]>` block must list `.wordmark-name` in its serif-forcing
  selectors, or the name line renders in Arial under Outlook/Windows.
- magic-link.html's copy is checked against the shared source by a
  whitespace-normalized parity test, plus a smoke check that fails CI if the
  literal string `YOUR-DEPLOY-URL` is ever present again (it shipped there
  once, unnoticed, before this fragment existed).
- "WiDS NYC" and "AI Reading Group" are always live HTML text, never baked
  into the mark image, with `alt="WiDS NYC"` on the `<img>` — a dead/blocked
  image degrades to visible text, never to a blank brand bar.

### Primary CTA

`_cta_shared.html` standardizes the button *skeleton* only — height (46px),
arcsize (22%), font stack, padding, and border width, which had drifted
inconsistently across templates (200–260px width, 46/48px height, 20/22%
arcsize, three different font families). It still carries `{{ cta.* }}`
Mustache tokens after splicing, because — unlike the wordmark — label, href,
color, and width genuinely vary per send:

    cta.bg           #467560 (sage, the default) or #c8226d (magenta,
                     availability-reminder's documented design-system
                     exception — never use magenta elsewhere)
    cta.borderColor  #355c4b (sage) or #a51858 (magenta)
    cta.width        VML needs a fixed pixel width; keep it close to the
                     label's rendered length so Outlook doesn't clip or
                     crowd the text
    cta.href         the button's destination
    cta.label        the button's visible text

These resolve through each template's normal token dict in the `render()`
pass that follows the splice — plain text/URLs, so `welcome_availability.py`'s
token-escaping pass is harmless here, unlike the wordmark's raw markup.
`availability-thanks.html` has no primary CTA and needs no `cta.*` tokens.
magic-link.html's hand-synced copy uses Go template syntax
(`{{ .ConfirmationURL }}`) for `href`/`label` instead of Mustache, so its
parity check compares only the fixed structural properties against
`_cta_shared.html`, not a full-body diff.

### Footer brand line

`_footer_brand_shared.html` is only the literal "WiDS NYC AI Reading Group"
text and its typography — nothing else in the footer. The five templates'
footers differ in real, intentional ways (Member portal link vs RSVP
management vs mailto-unsubscribe vs none), so only the one piece of text
genuinely common to some of them is shared; the functional links around it
stay hand-written per template. Applied to availability-reminder,
availability-thanks, rsvp-confirmation, and magic-link.html (all of which
already had this exact phrase). Deliberately **not** applied to
pre-meeting-reminder or new-paper-announcement (their footers never had this
phrase — adding it would be new content, not consolidation) or to
welcome-availability (its footer intentionally has no preference-center
link; unsubscribe is a human reply, documented inline).

## Template matrix

| Template | Current consumer | Status / constraints |
|---|---|---|
| `magic-link.{html,txt}` | Supabase Auth dashboard -> Email Templates -> Magic Link | Static copy. Rotate manually; see `docs/email-quotes.md`. Not rendered by `render_email_previews.py`. |
| `availability-reminder.{html,txt}` | `scheduled_tasks/availability-chase.md` Step 5c | Live only after the operator replies `remind`. Sent one recipient at a time to active members without an `availability` row for the meeting. Lede ("It's been too long") is written for a lapsed regular — for a brand-new member use `welcome-availability` instead. Note the location-chip marker in the HTML is longer than the chase spec quotes it (`BEGIN-OPTIONAL-CHIP: location \| OMIT …`); a matcher built on the quoted form silently mails an empty chip. |
| `rsvp-confirmation.{html,txt}` | `scheduled_tasks/pre-meeting-reminder.md` Step 4a and `scheduled_tasks/availability-chase.md` Step 5e | Live for attending RSVPs 2 days before a meeting, and for availability submitters during the operator-triggered chase follow-up. |
| `welcome-availability.{html,txt}` | `.claude/commands/wids-add-member.md` Step 5, via `scripts/welcome_availability.py` | Welcome-and-vouch email for a new member. Flow: [`docs/welcome-availability-flow.md`](../welcome-availability-flow.md). **Not renderable by `render_email_previews.py`** — it carries per-send block toggles that must be resolved before substitution, so it goes through `compose()` instead. Both bodies come from one `Content` object; a block toggled off drops from the HTML and the `.txt` twin together. `compose()` raises rather than returning a body with an unresolved token or a surviving marker. One header, no header toggle — the "court" variant was removed as not part of the Claude design. Preview with `uv run python -m scripts.welcome_availability`. |
| `availability-thanks.{html,txt}` | `scripts/render_email_previews.py` | Previewed and tested, but no current scheduled-task spec references it. Verify the send path before wiring it into a live workflow. |
| `pre-meeting-reminder.{html,txt}` | `scripts/render_email_previews.py` | Preview-only. The live `pre-meeting-reminder` task still sends `rsvp-confirmation` to attending members and a plain-text reminder to tentative/no-response members. |
| `new-paper-announcement.{html,txt}` | `scheduled_tasks/new-paper-announcement.md` | Court/queens announcement, **operator-triggered** per new cycle. Per-member Gmail **drafts** — never auto-send. Paper-card fields and prerequisites come from `papers.prerequisites` (JSONB) via `scripts/generate_prerequisites.py` (`--mode gather` then `render`); each prerequisite item may be a string or `{text, url}`, and malformed or blank values fail rendering. Per-send tokens (`recipient.firstName`, `lead.*`, `signoff.names`, `links.*`) are operator-supplied; `quote.*` rotates from the shared pool. Full field list under Token contracts below. |

## Token contracts

Authoritative list of merge fields per template. **This is the only copy** — the
template head comments used to duplicate it and were collapsed to pointers here,
because two copies drift silently and the templates cannot be trusted to carry
the current one.

Token names are written bare throughout, for the reason given in Architecture
above: a delimited token inside a comment gets substituted with real recipient
values and counts as required even when its block is off.

### Portal link tokens

The `links.*` tokens that resolve to portal routes, and the route each one must
land on. Every one of these is a real route in `web/app/` — check before adding
a new token, because a 404 in a footer is invisible at send time and only shows
up when a member clicks it.

    links.portalBase         <portalBase>              sign-in / magic link
    links.availability       <portalBase>/availability?meeting=<id>
    links.rsvpManage         <portalBase>/me/rsvps     all upcoming meetings

`/me/rsvps` shipped 2026-08-11; before that the token pointed at a route that
did not exist and every "Manage your RSVPs" footer link 404'd. It is member-
scoped by RLS (`attendance_select_own` / `_insert_own` / `_update_own`) and sits
behind the middleware auth gate, so a signed-out click lands on the sign-in form
rather than an empty page.

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
    cta.bg, cta.borderColor, cta.width, cta.href, cta.label
                              see "Shared fragments" above — sage by default

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
    cta.bg, cta.borderColor, cta.width, cta.href, cta.label
                              see "Shared fragments" above — sage by default

Rotated from the shared pool, has a fallback:

    quote.text, quote.by, quote.role

### `availability-reminder`

Merge fields live in `scheduled_tasks/availability-chase.md` (Step 5: operator
`remind` flow), which is its operational spec. Not duplicated here. One
exception: `cta.bg`/`cta.borderColor` must be the magenta pair
(`#c8226d`/`#a51858`) — this is the one template using the design-system
exception, not the sage default — see "Shared fragments" above.

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
    cta.bg, cta.borderColor, cta.width, cta.href, cta.label
                              see "Shared fragments" above — sage by default

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
    cta.bg, cta.borderColor, cta.width, cta.href, cta.label
                             see "Shared fragments" above — sage by default

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
  tests/build_quotes_test.py \
  tests/prerequisites_test.py \
  tests/generate_prerequisites_test.py \
  tests/welcome_availability_test.py
```

CI collects the full `tests/` tree, including all focused tests above, then also
runs `uv run ruff check scripts tests` and `uv run ty check`.

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

Apply every repository migration in numeric order before operating these
workflows. Migration `020` provides idempotency; migration `022` is required by
the new-paper announcement; welcome/add-member also needs `023`
(`members.vouched_by`). Keyed scheduled-task sends should check the exact key
first, insert the same key when logging success, and treat SQLSTATE `23505`
from the unique index as "already sent."

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
- The portal treats a `paper_companions` row as the current source of truth and
  derives `/papers/<paper_id>`. The existing reminder task specs still read
  `papers.companion_url`; if that legacy field is null, those emails omit or
  replace the preview link even when the portal companion exists. For the
  welcome paper card, verify `paper_companions.payload` exists before leaving
  `paper_card` on. In either path, do not use the retired
  `/papers/<slug>/companion` shape.
- Magic-link email rotation is manual in Supabase and separate from the
  structured quote pool used by the other templates.
- Client-behaviour claims (mark loss, compose sanitiser) belong in
  `docs/runbooks/email-client-behavior.md`, not in template head comments.
