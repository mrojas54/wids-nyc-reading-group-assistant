# Transactional email runbook

Use this when editing, previewing, or operating the member-facing email
templates. It maps the template files to their live consumers so preview-only
work does not get mistaken for production behavior.

## Architecture

- Template sources live in `assets/emails/template/` as `.html` + `.txt` pairs.
- `scripts/render_email_previews.py` performs flat Mustache-style substitution
  only (`{{ token.path }}`). It has no partials or conditionals; scheduled-task
  prompts and Python composers must resolve branching before substitution.
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

## Template matrix

| Template | Current consumer | Status / constraints |
|---|---|---|
| `magic-link.{html,txt}` | Supabase Auth dashboard -> Email Templates -> Magic Link | Static copy. Rotate manually; see `docs/email-quotes.md`. Not rendered by `render_email_previews.py`. |
| `availability-reminder.{html,txt}` | `scheduled_tasks/availability-chase.md` Step 5c | Live only after the operator replies `remind`. Sent one recipient at a time to active members without an `availability` row for the meeting. |
| `rsvp-confirmation.{html,txt}` | `scheduled_tasks/pre-meeting-reminder.md` Step 4a and `scheduled_tasks/availability-chase.md` Step 5e | Live for attending RSVPs 2 days before a meeting, and for availability submitters during the operator-triggered chase follow-up. |
| `availability-thanks.{html,txt}` | `scripts/render_email_previews.py` | Previewed and tested, but no current scheduled-task spec references it. Verify the send path before wiring it into a live workflow. |
| `pre-meeting-reminder.{html,txt}` | `scripts/render_email_previews.py` | Preview-only. The live `pre-meeting-reminder` task still sends `rsvp-confirmation` to attending members and a plain-text reminder to tentative/no-response members. |
| `new-paper-announcement.{html,txt}` | `scheduled_tasks/new-paper-announcement.md` | Court/queens announcement, **operator-triggered** per new cycle. Per-member Gmail **drafts** — never auto-send. Paper-card fields and prerequisites come from `papers.prerequisites` (JSONB) via `scripts/generate_prerequisites.py` (`--mode gather` then `render`); each prerequisite item may be a string or `{text, url}`, and malformed/blank values fail rendering. Per-send tokens (`recipient.firstName`, `lead.*`, `signoff.names`, `links.*`) are operator-supplied; `quote.*` rotates from the shared pool. Required tokens: `recipient.firstName`, `lead.name`/`lead.initial`/`lead.blurb`, `paper.title`/`paper.shortTitle`/`paper.summary`/`paper.authorsShort`/`paper.url`, `prereqs.lede` + `prereqs.html` (`.txt` twin uses `prereqs.text`), `signoff.names`, `links.availability`, `links.rsvpManage`. |

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
  tests/build_quotes_test.py \
  tests/prerequisites_test.py \
  tests/generate_prerequisites_test.py
```

CI collects the full `tests/` tree, including both prerequisite tests above,
then also runs `uv run ruff check scripts tests` and `uv run ty check`.

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
the new-paper announcement. Keyed scheduled-task sends should check the exact
key first, insert the same key when logging success, and treat SQLSTATE `23505`
from the unique index as "already sent."

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
- The portal treats a `paper_companions` row as the current source of truth and
  derives `/papers/<paper_id>`. The existing reminder task specs still read
  `papers.companion_url`; if that legacy field is null, those emails omit or
  replace the preview link even when the portal companion exists. In either
  path, do not use the retired `/papers/<slug>/companion` shape.
- Magic-link email rotation is manual in Supabase and separate from the
  structured quote pool used by the other templates.
