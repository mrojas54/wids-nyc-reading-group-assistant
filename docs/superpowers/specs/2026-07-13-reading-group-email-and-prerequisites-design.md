# Reading-Group Announcement Email + Newest-Paper / Prerequisites Generator

**Date:** 2026-07-13
**Status:** Design approved — ready for implementation planning
**Source design:** `ReadingGroupEmail.dc.html` — Claude Design project `aa31a29a-7e2e-4e43-b93c-8535036e0ac4`

## 1. Background

The assistant already has a transactional email system:

- **Templates:** `assets/emails/template/*.{html,txt}` pairs, hand-ported to
  email-client-safe **table-based** markup (MSO/Outlook conditional comments,
  VML buttons, inlined literal hex, hidden preheader, `@media` overrides), each
  with a plain-text twin.
- **Renderer:** `scripts/render_email_previews.py` does **flat** Mustache
  (`{{ token.path }}`) substitution only — no conditionals/partials — writes
  `*_rendered.{html,txt}`, and prints a JSON document the Gmail-MCP draft step
  consumes. Dynamic tokens come from `scripts/quotes.py` and
  `scripts/discussion_questions.py`. It uses **hardcoded sample tokens**; it
  never reads the database.
- **Send path:** the operator's **Gmail MCP**, driven by `scheduled_tasks/*.md`
  agent prompts. Sends are created as **drafts** the operator reviews before
  sending. Authoritative template→consumer map: `docs/runbooks/transactional-emails.md`.
- **Papers / Paper Pal:** `papers` table (`id, title, url, abstract, authors[],
  venue, year, pdf_drive_url, added_at`); AI paper analysis lives in Supabase
  **edge functions** (`analyze-paper`, `analyze-hint`, `analyze-socratic`) that
  call the provider layer in `web/lib/paperpal/providers/`. There is **no
  "prerequisites" concept anywhere today** — it is net-new.

The `ReadingGroupEmail.dc.html` design is a court/queens-voice announcement whose
flexible content block is labeled **"Recommended pre-requisites."** This project
delivers (1) that template as a real repo template, and (2) a generator that
fills the newest paper's card fields and its AI-drafted prerequisites.

## 2. Decisions (locked during brainstorming)

| Fork | Decision |
|------|----------|
| Template shape | **Flat per-purpose template** — no changes to the renderer's flat-Mustache behavior. |
| Header voice | **Court/queens** as the default for this announcement (both voices exist in the design; only the court variant is ported for this template). |
| Prereqs source | **AI-drafted, saved for edit** (durable draft the operator can revise before send). |
| AI plumbing | **Agent-in-the-loop** — the script emits a generation *contract*; the scheduled-task/skill agent (which already has Claude access, like the Gmail-MCP step) drafts the content. No new Python AI dependency or secret. |
| Prereqs storage | **JSONB on `papers`** — a new nullable `papers.prerequisites` column (additive migration). Not a separate table; not the `paper_companions` payload. |

## 3. Deliverable 1 — the template

**Files:** `assets/emails/template/new-paper-announcement.html` + `.txt`

Ported from the design canvas into the same table-based, email-safe idiom as
`rsvp-confirmation.html` (MSO comments, VML CTA button, hidden preheader,
`@media` mobile overrides, inlined hex, plain-text twin). The design's palette
(`#467560` green, `#c8226d` magenta, `#fefcef` cream, `#152a23` dark green) is
already the established brand palette, so colors port 1:1.

**Fixed block set** (the design marks these optional; this purpose-built email
always includes them):

1. **Court header** — mark PNG, "✦ Women of Data Science NYC ✦" eyebrow,
   "A New Queen Has Stepped Up to Reign This Month", italic subhead, magenta
   rule, "WiDS · NYC AI Reading Group".
2. **Greeting + intro** — `Hi {{ recipient.firstName }},` then two lines:
   `{{ lead.name }}` leads on `{{ paper.shortTitle }}` — `{{ paper.summary }}`.
3. **New co-lead card** — `{{ lead.initial }}` / `{{ lead.name }}` / `{{ lead.blurb }}`.
4. **Primary CTA** — "Share your availability" → `{{ links.availability }}`
   (availability uses the hosted form, per the design's own note — no inline
   slot tokens).
5. **Paper card** — `{{ paper.title }}` / `{{ paper.authorsShort }}` /
   "Read the paper" → `{{ paper.url }}`.
6. **Recommended pre-requisites** — `{{ questions.lede }}` +
   `{{ questions.item1 }}`, `{{ questions.item2 }}`, `{{ questions.item3 }}`.
   *(Turned on here — this is the email's purpose.)*
7. **Sign-off** — `{{ signoff.names }}`.
8. **Closing quote** — `{{ quote.text }}` / `{{ quote.by }}` / `{{ quote.role }}`,
   from the shared pool via `scripts/quotes.py`.
9. **Footer** — "Manage your RSVPs" → `{{ links.rsvpManage }}`.

**Token contract** (documented in the template header comment, matching the
existing templates' convention; render **refuses to send if any are unresolved**):

- *Required:* `recipient.firstName`, `lead.name`, `lead.initial`, `lead.blurb`,
  `paper.title`, `paper.shortTitle`, `paper.summary`, `paper.authorsShort`,
  `paper.url`, `questions.lede`, `questions.item1..3`, `signoff.names`,
  `links.availability`, `links.rsvpManage`.
- *Rotated (shared pool, has fallback):* `quote.text`, `quote.by`, `quote.role`.

**Preview-harness hook:** add a `NEW_PAPER_TOKENS` sample dict and a
`render_pair("new-paper-announcement", …)` call to
`scripts/render_email_previews.py`, and include its output in the emitted JSON,
so the template is covered by the same reproducible preview + unresolved-token
CI guard as the others.

## 4. Deliverable 2 — the newest-paper / prerequisites generator

**File:** `scripts/generate_prerequisites.py` (name provisional), run via
`uv run python -m scripts.generate_prerequisites`. Two sub-modes, so the LLM step
sits in the agent between them (mirroring how `render_email_previews.py` hands
JSON to the Gmail-MCP agent step):

### Mode `gather`
1. **Select the newest paper** — the `paper_id` of the most recent `meetings`
   row that has one (the current cycle's paper), falling back to `papers`
   ordered by `added_at DESC`. DB access reuses the psycopg connection pattern
   from `scripts/zotero_push.py`.
2. Emit a **generation contract** JSON to stdout: the paper's `id`, `title`,
   `abstract`, `authors`, `url`, plus instructions for the agent to produce:
   - `paper.shortTitle` — a condensed title,
   - `paper.summary` — one sentence for the intro line,
   - `paper.authorsShort` — "Zhao, Guo & Wang" style,
   - `questions.lede` + `questions.item1..3` — three recommended prerequisites.

### Agent step (in the scheduled-task / skill loop)
The agent reads the contract, drafts the fields with Claude, and persists them by
`UPDATE papers SET prerequisites = <jsonb> WHERE id = <paper_id>` (via the
Supabase MCP `execute_sql`, the same tool the scheduled tasks already use),
with `status: "draft"`.

### Mode `render`
Reads `papers.prerequisites` for the paper, maps it onto the template tokens
(`paper.*` + `questions.*`), merges with the operator-supplied per-send tokens
(`recipient.firstName`, `lead.*`, `signoff.names`, `links.*`) and a rotated
`quote.*`, renders `new-paper-announcement.{html,txt}`, and emits the Gmail-MCP
draft JSON. The unresolved-token guard applies.

**Data flow:**

```
gather (script, reads DB)
  → generation contract JSON
    → agent drafts with Claude
      → UPDATE papers.prerequisites (status=draft)   [operator can edit here]
        → render (script, reads papers.prerequisites + per-send tokens)
          → Gmail-MCP draft   [operator reviews/edits/sends]
```

## 5. Data model

**Migration `022_papers_prerequisites.sql`** (additive; verify `022` is unused on
remote branches before assigning — `git ls-remote` / `gh api`):

```sql
ALTER TABLE papers ADD COLUMN prerequisites JSONB;
```

Existing `papers` RLS applies unchanged (operators/service-role write; members
read). Column shape:

```json
{
  "lede": "A quick primer to get the most out of the discussion.",
  "items": ["…", "…", "…"],
  "summary": "One-sentence paper summary → paper.summary token.",
  "short_title": "Condensed title → paper.shortTitle token.",
  "authors_short": "Zhao, Guo & Wang",
  "status": "draft",
  "model": "claude-opus-4-8",
  "generated_at": "2026-07-13T00:00:00Z"
}
```

The whole generated bundle lives in one editable place, satisfying
"saved for edit." The column is named `prerequisites` (the headline artifact);
it also carries the derived paper-card fields (`summary`, `short_title`,
`authors_short`).

## 6. Testing

- **Template:** covered by `render_email_previews.py` (byte-reproducible sample
  render + unresolved-token guard). Visual check by opening the generated
  `new-paper-announcement_rendered.html` in the browser preview.
- **Generator:** unit tests for the pure pieces — newest-paper selection query
  shaping and the `papers.prerequisites` → token mapping — in the style of
  `tests/find_paper_suggest_test.py`. The `gather` contract and `render` output
  are asserted against fixed fixtures. DB access is mocked (no live DB in CI).
- **Lint/type:** `ruff` + `ty` over `scripts/` (the new module is in scope).

## 7. Out of scope (YAGNI)

- Portal UI for editing prerequisites (v1 edits happen via SQL or in the Gmail
  draft; a Paper Pal portal editor is a clean follow-up).
- Other announcement variants (availability-only, recap, agenda) — each becomes
  its own flat template later, per the "flat per-purpose" decision.
- Renderer conditional/section support and the standard-mark voice variant.

## 8. Pre-implementation checklist

- [ ] Confirm migration number `022` is not taken on any remote branch.
- [ ] Confirm the write path for `papers.prerequisites` (operator session vs
      service-role) matches how scheduled tasks currently `execute_sql`.
- [ ] Confirm exact `meetings`→`papers` join for "newest paper" against the live
      schema.
