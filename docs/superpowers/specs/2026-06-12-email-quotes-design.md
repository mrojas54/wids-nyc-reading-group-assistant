# Rotating quotes from legacy women in STEM — design

**Date:** 2026-06-12
**Status:** Approved (design)
**Scope:** Availability + reminder emails (primary), dashboard widget (secondary)

## Problem

The availability and reminder emails are functional but flat. We want a small,
recurring moment of inspiration: a rotating quote from a legacy woman engineer
or scientist (Grace Hopper, Hedy Lamarr, Katherine Johnson, Ada Lovelace, Anita
Borg, Vera Rubin, …). One template already proves the pattern —
`rsvp-confirmation` ships a hardcoded Maryam Mirzakhani quote — but there is no
shared, verifiable, rotating source. This feature builds that source and wires
it into the email path and the member dashboard.

Explicitly **out of scope:** the magic-link email. It is a Supabase-static
template with its own manual rotation process (`docs/email-quotes.md`) and is
not touched here.

## Non-negotiable constraint: no apocryphal quotes

`docs/email-quotes.md` already documents a hard-won rule: "famous person said
X" lines are frequently fabricated online. This design makes that rule
**structural** — only quotes explicitly marked `verified: true` *and* carrying a
`sourceUrl` are eligible for selection, and the build fails CI if a `verified`
quote lacks a source.

## Architecture overview

```
data/quotes/<author-slug>/          ← curation surface (one folder per person)
  author.json                       ← structured bio record
  YYYYMMDD_quotes.json              ← dated quote snapshots (history)
  quotes.json                       ← symlink → newest snapshot (human convenience)
        │
        ▼
scripts/build_quotes.py             ← validates + resolves newest-by-filename
        │                              + refreshes the symlink
        ▼
web/lib/quotes.generated.json       ← committed bundle (single runtime representation)
        │
        ├── scripts/quotes.py       ← Python selector  → email render path
        └── web/lib/quotes.ts       ← TS selector       → dashboard QuoteCard
```

Both runtimes read **only the generated bundle**. `build_quotes.py` is the sole
component that touches the per-author folders and resolves which dated snapshot
is current. A committed bundle + a drift test mirrors how this repo already
handles generated artifacts (`data/arxiv-taxonomy.json`, the specter2 exports).

## 1. Data model

### Curation surface: `data/quotes/<author-slug>/`

One folder per person; the folder name is the author slug and must equal
`author.id`.

`author.json` — structured bio:

```json
{
  "id": "grace-hopper",
  "name": "Grace Hopper",
  "role": "Computer scientist · US Navy rear admiral",
  "birthdate": "1906-12-09",
  "deathdate": "1992-01-01",
  "fields": ["computer science", "compilers"],
  "notable_contributions": "Built the first compiler (A-0); drove COBOL's creation; popularized \"debugging\".",
  "wikipediaUrl": "https://en.wikipedia.org/wiki/Grace_Hopper"
}
```

- **Required:** `id`, `name`, `role`.
- **Recommended:** `birthdate`, `notable_contributions`.
- **Optional:** `deathdate`, `fields`, `wikipediaUrl`.

`YYYYMMDD_quotes.json` — a dated snapshot, top-level array of quotes:

```json
[
  {
    "id": "hopper-always-done",
    "text": "The most dangerous phrase in the language is, 'we've always done it this way.'",
    "year": null,
    "source": "Attributed; widely documented in her public lectures",
    "sourceUrl": "https://…",
    "verified": true
  }
]
```

- **Required per quote:** `id`, `text`, `verified`. When `verified` is `true`,
  **both** `sourceUrl` and a non-empty `source` (free-text provenance note) are
  required — the build fails CI otherwise.
- **Optional:** `year`.

`quotes.json` — a symlink pointing at the newest `YYYYMMDD_quotes.json`. It is a
**convenience for humans browsing the folder only**; the build does not depend on
it (see §2). `build_quotes.py` refreshes it after each run so it never goes
stale. On platforms without symlink support the refresh warns and continues.

### Dated versioning + rollback

Each curation pass adds a new `YYYYMMDD_quotes.json` rather than editing in
place. This gives in-tree, human-readable history and a trivial rollback path
that complements the existing "Reversing an apocryphal rotation" runbook in
`docs/email-quotes.md`: to revert, add a newer-dated snapshot with the prior
content (or delete the bad snapshot so the previous one becomes newest).

## 2. Build: `scripts/build_quotes.py`

Globs `data/quotes/*/`. For each folder:

1. Reads `author.json`; validates required fields and that the folder slug
   equals `author.id`.
2. Resolves the current quotes file as `max(YYYYMMDD_quotes.json)` by filename
   (dates sort lexicographically, so newest wins). The `quotes.json` symlink is
   **ignored** for resolution — a stale or dangling symlink can never break the
   build.
3. Validates each quote: unique `id`, non-empty `text`, and `sourceUrl` present
   whenever `verified` is `true`.
4. Refreshes the `quotes.json` symlink to point at the resolved newest file
   (best-effort; warns on symlink-unsupported platforms).

Then it assembles the bundle and writes `web/lib/quotes.generated.json`:

```json
{
  "version": 1,
  "authors": [
    {
      "author": { "id": "grace-hopper", "name": "…", "role": "…", "birthdate": "…", "notable_contributions": "…" },
      "quotes": [ { "id": "hopper-always-done", "text": "…", "year": null, "source": "…", "sourceUrl": "…", "verified": true } ]
    }
  ]
}
```

Authors are sorted by `id` and quotes by `id` so the bundle is deterministic.
The bundle shape mirrors the source (each entry = `{author, quotes}`) — no
flattening, no separate authors map, because the data is genuinely one author
per unit. The bundle changes only when an author folder changes.

**Validation failures are hard errors** (non-zero exit) so CI blocks a
malformed or unsourced quote.

## 3. Selection (one spec, two implementations)

`scripts/quotes.py` (Python) and `web/lib/quotes.ts` (TypeScript) each load the
bundle and implement the identical algorithm:

```
selectQuote(bundle, dateKey, salt=""):
    eligible = [ (author, quote)
                 for entry in bundle.authors
                 for quote in entry.quotes
                 if quote.verified ]
    sort eligible by quote.id            # stable, deterministic order
    if not eligible: return FALLBACK     # never throws
    return eligible[fnv1a(str(dateKey) + salt) % len(eligible)]
```

- **`fnv1a`** is a tiny, documented string hash implemented identically in both
  languages and pinned by tests. It scatters selections non-monotonically across
  the pool — the "temperature-like" variety requested — while keeping selection
  **fully reproducible** (same `dateKey` → same quote), which previews and tests
  depend on. Selection is a single pure modulo — no cross-day state — so an
  occasional adjacent-day repeat (~1/n, shrinking as the pool grows) is accepted
  in exchange for a provably-correct, trivially-portable Python/TS pair.
- **`salt`** lets the operator nudge variety without code changes.
- **`dateKey` granularity:**
  - Emails: days-since-epoch of the **send date** → a whole batch shares one
    quote; rotates per send-day.
  - Dashboard: days-since-epoch of **today** → a quote-of-the-day.
- Each eligible item already carries its `author`, so there is no separate
  resolve step. Emails read `author.name` / `author.role`; the dashboard may
  additionally use `notable_contributions`, dates, etc.
- `FALLBACK` is a hardcoded constant (the seed Grace Hopper quote) so neither
  surface can ever render an empty quote or crash on a malformed bundle.

## 4. Email integration

### Templated emails (HTML + TXT)

Add a reusable quote block (HTML + TXT) reusing `rsvp-confirmation`'s existing
`.quote-text` serif treatment to:

- `assets/emails/template/availability-reminder.{html,txt}` (the "chase")
- `assets/emails/template/availability-thanks.{html,txt}`

And **standardize** `rsvp-confirmation` so its quote comes from the shared pool
instead of the hardcoded Mirzakhani default. (Its `.txt`/`.html` already carry
the `quote.*` tokens and a documented "fall back to Mirzakhani until rotation is
wired" contract — this feature *is* that rotation; the haiku tokens are a
separate rotation and are left untouched.)

Tokens (Mustache-style, matching the existing system):
`quote.text`, `quote.by` (← `author.name`), `quote.role` (← `author.role`).
These are **optional with a fallback** — consistent with rsvp-confirmation's
current contract — so an unresolved quote never blocks a send.

### Inline plaintext reminder (pre-meeting Step 4b)

The pre-meeting "plain reminder" for the tentative / no-response bucket (and all
admin meetings) is **composed inline in `scheduled_tasks/pre-meeting-reminder.md`
Step 4b**, not a template file. There is no HTML quote block to add here.
Instead, append a single plaintext quote line to the inline admin and
reading-group bodies, e.g.:

```
— "<quote.text>"
  <quote.by>, <quote.role>
```

resolved via `scripts/quotes.py` with the same send-date `dateKey`. If selection
yields the fallback, the line still renders cleanly. This keeps the plain
reminder genuinely plain (no markup) while still carrying the rotating quote.

### Rendering

`scripts/render_email_previews.py`:

- Extend the render set to include `availability-reminder` (and the plain
  pre-meeting reminder).
- Compute `quote.*` via `scripts/quotes.py` using a fixed `dateKey` so previews
  are reproducible.
- Migrate rsvp-confirmation's hardcoded Mirzakhani tokens to the selector.

### Scheduled-task docs

- `scheduled_tasks/availability-chase.md` (Step 5): add a "resolve quote tokens
  via `scripts/quotes.py`" instruction.
- `scheduled_tasks/pre-meeting-reminder.md` (Step 4b): same note for the plain
  reminder branch.

## 5. Dashboard widget

- `web/lib/quotes.ts`: imports `web/lib/quotes.generated.json`; exports
  `selectQuote()` and `getQuoteOfDay()`.
- `QuoteCard` — a small server component rendering the day's quote, styled with
  the existing UI primitives (sage/serif, design-system aligned). It may surface
  `author.notable_contributions` and dates beneath the quote.
- Placement: below `NextMeetingCard` on the dashboard (easy to relocate).

## 6. Testing

**Python** (`tests/`):

- `quotes_select_test.py`: `fnv1a` determinism; `selectQuote` determinism;
  no-back-to-back repeat; verified-only eligibility; empty/one-element pools
  return the fallback without throwing.
- Build/schema validation: folder slug == `author.id`; required fields present;
  every `verified` quote has a `sourceUrl`; newest-by-filename resolution.
- Extend `render_email_previews_test.py` for the new templates' `quote.*`
  tokens resolving.

**TypeScript** (`web/`):

- `web/lib/__tests__/quotes.test.ts`: selector determinism, `getQuoteOfDay`,
  bundle schema.
- `QuoteCard` component test (vitest + RTL, matching existing `__tests__`).

**Drift guard:** a test re-runs `build_quotes.py` and asserts the committed
`web/lib/quotes.generated.json` is unchanged (CI fails if someone edits a source
file without rebuilding).

## 7. Error handling summary

- Selectors never throw: empty/one-element pools and malformed bundles fall back
  to a hardcoded constant.
- Email render: quote tokens are optional with a documented fallback; an
  unresolved quote logs a warning (existing `render_email_previews` pattern) and
  the send proceeds.
- `build_quotes.py`: hard error (non-zero exit) on any schema or sourcing
  violation, so unsourced/`verified` quotes cannot reach the bundle.
- Symlink refresh is best-effort and warns rather than failing on platforms
  without symlink support.

## 8. Seed pool

Seed from the **already-verified** entries in `docs/email-quotes.md`: Grace
Hopper, Ada Lovelace, Katherine Johnson, Hedy Lamarr, Mary Allen Wilkes, Radia
Perlman, Barbara Liskov, Frances Allen — plus Maryam Mirzakhani (already live in
rsvp-confirmation). Each becomes a `data/quotes/<slug>/` folder with a sourced
`YYYYMMDD_quotes.json`.

Entries currently marked *(verify source — …)* (Margaret Hamilton, Joan Clarke)
stay **out** until a real primary source is found. Additional names from the
brief (Anita Borg, Vera Rubin, others) are added **only** with a real
`sourceUrl`.

`docs/email-quotes.md` is updated to point at `data/quotes/` as the
machine-readable source of truth for non-magic-link emails (its magic-link
manual-rotation prose stays, since that template is Supabase-static and out of
scope).

## File inventory

New:
- `data/quotes/<slug>/author.json`, `data/quotes/<slug>/YYYYMMDD_quotes.json`,
  `data/quotes/<slug>/quotes.json` (symlink) — per seed author
- `scripts/build_quotes.py`
- `scripts/quotes.py`
- `web/lib/quotes.generated.json`
- `web/lib/quotes.ts`
- `web/components/QuoteCard.tsx`
- `tests/quotes_select_test.py`
- `web/lib/__tests__/quotes.test.ts`
- `web/components/__tests__/QuoteCard.test.tsx`

Modified:
- `assets/emails/template/availability-reminder.{html,txt}` (add quote block)
- `assets/emails/template/availability-thanks.{html,txt}` (add quote block)
- `assets/emails/template/rsvp-confirmation.{html,txt}` (standardize quote onto pool)
- `scripts/render_email_previews.py`
- `tests/render_email_previews_test.py`
- `scheduled_tasks/availability-chase.md`
- `scheduled_tasks/pre-meeting-reminder.md`
- `web/app/dashboard/page.tsx` (mount `QuoteCard`)
- `docs/email-quotes.md` (point at `data/quotes/`)
- CI workflow (run `build_quotes.py` drift check if not covered by pytest)
