# Handoff — Wire the pre-meeting-reminder template into the live send

**Date:** 2026-06-19
**Author of handoff:** PR-review session (reviewed #99)
**Suggested branch:** `claude/pre-meeting-reminder-wiring` (cut fresh from `main`)
**Status of prerequisite:** PR #99 merged to `main` (template + composer + previews shipped, **not** wired to send)

---

## TL;DR

PR #99 built a production, email-safe **Pre-Meeting Reminder** template and a
discussion-questions composer, and wired both into the *preview* renderer — but
the **live scheduled task still doesn't use them**. The next branch should close
that gap: make `scheduled_tasks/pre-meeting-reminder.md` actually render and send
the new template (with discussion questions), and address the small follow-ups
surfaced in review.

This is a docs-driven send pipeline (the operator/agent executes the steps in
the `.md`), so "wiring" mostly means rewriting the relevant steps of that
markdown task to point at the new template + composer, plus the supporting code
to load per-paper questions.

---

## What already exists (from PR #99, on `main`)

- `assets/emails/template/pre-meeting-reminder.{html,txt}` — table-based,
  inline-hex, VML CTA fallback, responsive. Tokens it expects:
  `recipient.firstName`, `meeting.dayName`, `meeting.when`, `meeting.location`,
  `meeting.leader`, `links.calendar`, `paper.title`, `paper.subtitle`,
  `paper.companionUrl`, `signoff.names`, `links.rsvpManage`, `links.portalBase`,
  `quote.text|by|role`, and the three composed `questions.lede|html|text`.
- `scripts/discussion_questions.py` — pure load + transform (mirrors
  `scripts/quotes.py`). `load_questions(path)` + `question_tokens(list)`.
  Reads `data/discussion-questions/sample.json` (the **only** source today).
- `scripts/render_email_previews.py` — renders the template with
  `PRE_MEETING_TOKENS` + quote + question tokens (preview/CI only).
- Tests: `tests/discussion_questions_test.py`, extended
  `tests/render_email_previews_test.py`; both in the CI Python job.

## What is NOT done (the gap to close)

`scheduled_tasks/pre-meeting-reminder.md` (the live daily task) is **untouched**:

- **Step 4a** still sends `rsvp-confirmation.{html,txt}` to the attending bucket.
- **Step 4b** still sends an inline plain-text reminder to the tentative/no_response
  bucket and all admin meetings.
- **Neither step references** `pre-meeting-reminder.{html,txt}` or any
  `questions.*` token. The composer's `SAMPLE_PATH` is a single hardcoded
  gold-futures sample, not per-paper.

So today nothing in production emits the new template.

---

## Proposed scope for the new branch

### 1. Per-paper discussion questions (the real seam)
`scripts/discussion_questions.py:SAMPLE_PATH` is documented as the v1 seam to
repoint. Decide the source of truth for per-paper questions and implement load:
- Option A: a `papers` column / related table in Supabase (check schema first via
  `list_tables`; add a migration if needed).
- Option B: per-paper files under `data/discussion-questions/<paper-slug>.json`.
- Keep `load_questions(path)` signature; add a resolver that maps a meeting's
  `paper_id`/slug → the right source, falling back loudly (the loader already
  raises actionable `RuntimeError`s).

### 2. Rewrite the live task to use the new template
In `scheduled_tasks/pre-meeting-reminder.md`:
- Replace the Step 4 plain-text/RSVP-confirmation sends (for **reading_group**
  meetings) with a render of `pre-meeting-reminder.{html,txt}`.
- Document the full token table (mirror the style of availability-chase Step 5b),
  including how `meeting.when` / `meeting.dayName` / `paper.subtitle` /
  `meeting.leader` / `signoff.names` are derived, and how `questions.*` are
  composed via `scripts/discussion_questions.py`.
- Decide what admin meetings get (the new template is reading-group-shaped;
  likely keep the plain text for admin).
- Preserve the existing idempotency machinery (Step 2/Step 5 keyed on
  `pre-meeting-reminder:meeting=<id>`, unique-index backstop). Unchanged.

### 3. Review follow-ups from PR #99 (small, optional but cheap)
- **Style-sync guard:** `_SANS`/`_MONO` + hex colors in
  `discussion_questions.py` are hand-copied to match the template's inline
  styles with no test guarding the match. Add a test asserting the font-stack
  constants also appear in `pre-meeting-reminder.html`, or share a constant.
- **`question_tokens([])` degrades oddly** (`"0 to chew on"`, empty rows). The
  single caller funnels through the non-empty-guaranteeing `load_questions`, so
  add a one-line guard or a contract comment.
- **Greeting decision:** template opens "Good morning gorgeous {firstName},".
  Author flagged it as a non-blocking open question (presumes a morning send;
  register may be off). Recommend time-neutral "Hi {firstName},". Operator call.

---

## Constraints / conventions to honor

- Composers stay **pure load + transform** (no template/branching logic) so the
  renderer stays a flat `{{ token }}` substitution — match `quotes.py`.
- HTML question text is escaped in the composer (`html.escape(q, quote=False)`)
  because the renderer does **not** escape on substitution. Keep that invariant
  if you add any new HTML-bearing token.
- Add any new test file to `.github/workflows/ci.yml` (the Python job lists test
  files explicitly).
- Email-safety rules from the spec: no `background-image`, hosted PNG logo (not
  inline SVG), real table for the numbered list, table-based layout, inline hex.

## Reference docs (already in repo)

- Spec: `docs/superpowers/specs/2026-06-18-pre-meeting-reminder-email-design.md`
- Plan: `docs/superpowers/plans/2026-06-18-pre-meeting-reminder-email.md`
- Sibling live task for idempotency/token patterns:
  `scheduled_tasks/availability-chase.md` (Step 5b token composition, Step 5c/5e
  idempotency).

## Verification gates (mirror CI)

```bash
uv run ruff check scripts tests
uv run ty check
uv run pytest          # full Python suite
uv run python -m scripts.render_email_previews   # eyeball the rendered html/txt
```
Then spot-check that the live task's documented token table has **no unresolved
`{{ }}`** against a real meeting row, and that per-paper questions resolve for a
paper other than the gold-futures sample.

## First steps for the next session

1. `git fetch origin main && git checkout -b claude/pre-meeting-reminder-wiring origin/main`
2. Read the three reference docs above + `scheduled_tasks/pre-meeting-reminder.md`.
3. Inspect the `papers` / `meetings` schema (Supabase `list_tables`) to decide the
   per-paper questions source (scope item 1).
4. Implement in this order: per-paper loader → live task rewrite → review
   follow-ups → CI wiring.
