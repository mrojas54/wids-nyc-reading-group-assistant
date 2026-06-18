# Pre-Meeting Reminder email — design

**Date:** 2026-06-18
**Status:** Approved (design)
**Scope:** New transactional email template `pre-meeting-reminder.{html,txt}` + a static discussion-questions source + preview/test wiring. **Not** wired into the live scheduled task (deliberate — see §8).

## Problem

A Claude Design handoff (`design_handoff_pre_meeting_reminder`) delivers a
high-fidelity HTML prototype for a **Pre-Meeting Reminder** email: sent to people
who RSVP'd to a reading-group meeting, it restates when/where/who, links the
paper + Paper Pal, lists eight discussion questions to prime the conversation,
and closes with a "before you arrive" nudge and a rotating women-in-science
quote.

The prototype is a browser mock (modern CSS — flex, grid, CSS variables,
`::before` counters, Go-style `{{ .FirstName }}` tokens). It is a **visual
spec, not transport markup**. This design ports it into the repo's existing
transactional-email system as a production, email-client-safe template, reusing
the patterns already proven by `availability-reminder` and `rsvp-confirmation`.

Two product decisions were made up front:

1. **Discussion questions** have no existing data source — the Paper Pal
   companion payload only stores MCQ quiz questions + one Socratic opener
   (`web/lib/paperpal/providers/schema.ts`), and the guide flow that once emitted
   a discussion list is deprecated. Decision: **read them from a static
   `questions.json`** for v1; per-paper auto-population is a later follow-up.
2. **Integration**: **build, register, and preview the template only** this pass.
   Wiring it into `scheduled_tasks/pre-meeting-reminder.md` (recipients, send
   flow) is deferred to a follow-up so this PR stays small and reversible.

## What this is NOT (explicit out-of-scope)

- No changes to `scheduled_tasks/pre-meeting-reminder.md` send logic or
  recipients. The live task keeps sending `rsvp-confirmation` + the inline plain
  reminder exactly as today.
- No per-paper question storage, AI generation, or schema/migration changes.
- The handoff's **Tweaks panel** (`tweaks-panel.jsx`) and the prototype
  `.meta-strip` / `.post-note` chrome are authoring-only and **never ship**.

## Architecture overview

```
data/discussion-questions/sample.json     ← static question source (v1)
        │                                    { "questions": ["…", …] }
        ▼
scripts/discussion_questions.py           ← load + compose (mirrors scripts/quotes.py)
        │   load_questions(path) -> list[str]
        │   question_tokens(qs)  -> { questions.lede, questions.html, questions.text }
        ▼
scripts/render_email_previews.py          ← injects question + quote tokens, flat {{ }} sub
        │                                    (quote.* via scripts/quotes.py, as today)
        ▼
assets/emails/template/pre-meeting-reminder.{html,txt}
```

The template stays **logic-free** (flat Mustache substitution only — the
renderer's stated contract: "no partials, no conditionals"). Anything
variable-length or computed — the question list, the count-aware lede — is
**pre-composed in Python** and injected as a ready-made token. This mirrors how
the quote block already works and how `availability-reminder` strips its optional
location chip via comment markers rather than template conditionals.

## 1. Template port — `pre-meeting-reminder.{html,txt}`

A new HTML + TXT pair in `assets/emails/template/`, structurally modeled on
`availability-reminder.html` (the most recent, most complete sibling).

**Email-safety requirements (carried over from the sibling):**

- Table-based layout; one centered card, max-width 640px.
- All colors inlined as literal hex (the handoff's Design Tokens are
  authoritative — magenta `#c8226d`, sage `#355c4b`/`#467560`, paper
  `#fefcef`/`#ddd4be`, foreground `#1a160f`, navy logo `#16205e`).
- `<!--[if mso]>` font + VML `roundrect` fallback for the primary CTA button.
- Hidden preheader; `@media (max-width:600px)` for the responsive stack.
- Self-hosted/fallback font stacks (Geist → system sans; Newsreader → Charter /
  Georgia serif; Geist Mono → ui-monospace) — Google Fonts links are not relied
  on in email.

**Fidelity degradations (documented inline in the template, per the handoff's
"treat HTML as visual spec" note):**

- The cream **dotted-grid** paper background (`radial-gradient` +
  `background-attachment:local`) is unreliable in email clients (Outlook/Gmail
  strip background-images). Render a **solid cream `#fefcef` card** on the dark
  `#1a160f` outer backdrop; keep the dot motif only as a progressive
  enhancement if it survives, never as a dependency.
- `::before` counters become literal `01 02 …` text cells (see §3).
- The inline logo **SVG is copied verbatim** from the prototype (the handoff
  says reuse it); other icons (arrow, book, clock) follow the sibling's inline
  `currentColor` stroke SVGs.

**Section order (matches the handoff Layout):** logo lockup → greeting → intro →
meeting strip (When / Where / Leading) → primary CTA → paper card → discussion
questions → before-you-arrive note → sign-off → quote block → footer.

The `.txt` counterpart mirrors `availability-reminder.txt`: same content, plain,
hard-wrapped, with section headers in caps and the numbered questions as a plain
list (§3).

## 2. Tokens

Mustache-style, reusing existing token names wherever the sibling already
defines them. Free-text prose from the handoff (intro, before-you-arrive note,
eyebrows) is **baked into the template as static copy** — only true data is
tokenized.

| Token | Source / meaning | Notes |
|---|---|---|
| `recipient.firstName` | greeting | reused name |
| `meeting.when` | "Tue, Jun 23 · 6:30pm" | new |
| `meeting.location` | "Jack's Wife Freda" | new |
| `meeting.leader` | "Michelle & Claudia" | new (serif italic in HTML) |
| `meeting.dayName` | "Tuesday" | new — used in intro + sign-off |
| `links.calendar` | join / add-to-calendar CTA | reused name |
| `paper.title` | paper card title | reused name |
| `paper.subtitle` | descriptive tagline under title | new (distinct from `authorsShort`) |
| `paper.companionUrl` | "Open in Paper Pal" link | reused name |
| `questions.lede` | count-aware lede (§3) | new, computed |
| `questions.html` | composed question rows (§3) | new, computed, HTML-raw |
| `questions.text` | composed plain list (§3) | new, computed, `.txt` only |
| `quote.text` / `quote.by` / `quote.role` | rotating quote (§4) | reused, from `quotes.py` |
| `signoff.names` | "Michelle & Claudia" | new — defaultable |
| `links.rsvpManage` | "Manage your RSVPs" footer link | reused name |
| `links.portalBase` | portal base URL | reused name |

All tokens are required at render time **except** the quote block, which keeps
the sibling's optional-with-fallback contract (an unresolved quote never blocks
a send). `render_email_previews.py` fails CI on any other unresolved token.

## 3. Discussion questions

### Static source — `data/discussion-questions/sample.json`

Mirrors the `data/quotes/` precedent (static JSON feeding emails). v1 shape:

```json
{
  "questions": [
    "Why did the authors <b>combine LSTM and Transformer</b> instead of relying on a single architecture?",
    "Do the six selected features … <b>genuinely make sense</b> for predicting gold futures?"
  ]
}
```

- Plain strings. Inline `<b>…</b>` is allowed for the handoff's bolded phrases;
  it passes through raw in HTML and is **stripped** for the `.txt`.
- Seeded with the handoff's eight verbatim questions so the preview matches the
  screenshots.
- Count is **not** fixed at 8 — the renderer handles N (see lede).

### Composer — `scripts/discussion_questions.py`

Structured like `scripts/quotes.py` (load + pure transform, easy to unit-test):

- `load_questions(path=SAMPLE_PATH) -> list[str]` — reads the JSON, validates a
  non-empty `questions` array of non-empty strings; raises an actionable
  `RuntimeError` otherwise (matches `quotes.load_bundle` error style).
- `question_tokens(questions) -> dict[str, str]` returns three tokens:
  - `questions.lede` — `"{Word} to chew on — pick the ones that pull at you."`
    where `Word` is the capitalized number word for `len(questions)` ("Eight"),
    falling back to the digit for counts past a small map. Keeps the handoff's
    lede honest when the array length changes.
  - `questions.html` — an email-safe table: one `<tr>` per question, a
    top-aligned mono number cell (`f"{i:02d}"` → `01 02 …`, magenta `#c8226d`,
    `min-width:26px`) + a text cell (15px, dashed `#b9ae96` bottom border, none
    on the last). `<b>` spans pass through. This is the email-table analog of
    the prototype's `<li>` + `::before` counter.
  - `questions.text` — plain numbered list (`01. …`, blank line between, `<b>`
    stripped) for the `.txt`.

The `SAMPLE_PATH` constant is the **single seam** the later "auto-load" follow-up
repoints at a per-paper source — no template or composer change needed then.

## 4. Quote integration

Identical to every other template: the closing block carries `{{ quote.text }}`,
`{{ quote.by }}`, `{{ quote.role }}`, resolved via
`scripts/quotes.py` (`select_quote(load_bundle(), date_key)` →
`quote_tokens(...)`). The handoff's seven hardcoded quotes are **dropped** in
favor of the live committed bundle. No new quote work — `quotes.py` already
ships.

## 5. Preview rendering — `scripts/render_email_previews.py`

- Add a `PRE_MEETING_TOKENS` dict with realistic sample values (reuse the
  existing gold-futures paper sample for cross-template consistency).
- Compose the question tokens once — `qtokens = question_tokens(load_questions())`
  — alongside the existing shared quote tokens `q`.
- Call `render_pair("pre-meeting-reminder", {**PRE_MEETING_TOKENS, **q, **qtokens})`,
  add it to the emitted JSON document, and include its unresolved tokens in the
  hard-fail check.

Output: `pre-meeting-reminder_rendered.{html,txt}` next to the source, plus the
JSON the Gmail-MCP draft step consumes — same as the other three.

## 6. Testing — `tests/render_email_previews_test.py` + new module test

Extend the existing parametrized pattern:

- `test_pre_meeting_reminder_carries_quote_tokens` — `{{ quote.* }}` present in
  both `.html` and `.txt`.
- `test_pre_meeting_reminder_carries_question_tokens` — `{{ questions.html }}`
  in `.html`, `{{ questions.text }}` in `.txt`, `{{ questions.lede }}` in both.
- Fold `pre-meeting-reminder` into the existing
  `test_preview_main_resolves_quotes_from_pool` loop (token resolved AND quote
  value present in the rendered output).
- Add `tests/discussion_questions_test.py` (new): `load_questions` validation
  (rejects empty array / empty string / missing key); `question_tokens`
  determinism; lede count-word correctness (8 → "Eight", and a past-map
  fallback); `<b>` stripped in `.text` but preserved in `.html`; `01/02`
  zero-padded numbering.

All Python gates per house rules: `ruff`, `mypy --strict`, `pytest` green before
commit.

## 7. Error handling

- `load_questions` raises an actionable error on a missing/empty source so a
  broken JSON fails loudly in preview/CI, never silently shipping an empty list.
- Quote tokens stay optional-with-fallback (unresolved quote → warning, send
  proceeds), consistent with the sibling contract.
- Every non-quote token unresolved → `render_email_previews.main()` returns 1
  and prints the offending keys (existing behavior, now covering the new pair).

## 8. Follow-ups (deliberately deferred)

1. **Auto-load questions per paper** — repoint `SAMPLE_PATH`/`load_questions` at
   a real per-paper source (companion-derived or operator-curated). The composer
   and template don't change.
2. **Wire into the scheduled task** — decide recipients (unified reading-group
   reminder vs. pending-bucket-only) and replace/augment the relevant branch of
   `scheduled_tasks/pre-meeting-reminder.md` Step 4. Needs the question source
   from (1) to be live first.

## Open notes

- **Greeting copy.** The handoff's verbatim greeting is *"Good morning gorgeous
  {firstName},"* — it presumes a morning send, but the daily task can fire any
  time. The port keeps the hifi copy as-is; flagging for the operator to confirm
  or swap to a time-neutral *"Hi {firstName},"* (the availability-reminder
  convention). Cosmetic, non-blocking.
- **Quote pool vs. handoff list.** The handoff lists seven scientists; the live
  bundle (`data/quotes/`) currently has six folders with partial overlap. The
  email renders whatever the bundle holds — no action unless the operator wants
  the handoff's exact set seeded.

## File inventory

New:
- `assets/emails/template/pre-meeting-reminder.html`
- `assets/emails/template/pre-meeting-reminder.txt`
- `data/discussion-questions/sample.json`
- `scripts/discussion_questions.py`
- `tests/discussion_questions_test.py`

Modified:
- `scripts/render_email_previews.py` (register the new pair + question tokens)
- `tests/render_email_previews_test.py` (quote + question token coverage)

Untouched (by design): `scheduled_tasks/pre-meeting-reminder.md`, all schema /
migrations, the web app.
