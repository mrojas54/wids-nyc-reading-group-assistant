# Paper Pal portal

Member- and leader-facing workflow for turning a selected paper into a
live companion page, assessment, and presenter deck.

This guide is written for three audiences:

- **Members** reading or volunteering to lead papers -> start at "Using it
  as a member."
- **Leaders/operators** generating companions -> "Synthesis workflow" and
  "Operational notes."
- **Future maintainers** changing the feature -> "Behind the scenes" and
  "Where things live."

---

## TL;DR

Paper Pal is the supported portal flow for the reading group:

1. Members browse `/papers`, which shows the current reading, upcoming
   picks, member-proposed "want to lead" papers, and recently discussed
   papers.
2. A member can propose a catalog paper and optionally add a note. The
   server action creates or reuses one placeholder meeting for that paper
   and records the suggestion.
3. The meeting leader or an operator opens `/new?paperId=<id>`, uploads a
   PDF, and streams synthesis progress from the `analyze-paper` Edge
   Function.
4. The synthesized companion is stored in `paper_companions.payload` and
   appears at `/papers/<id>`, with multiple-choice hints, Socratic tutoring,
   and `/papers/<id>/present` presenter mode when payload data exists.

Paper Pal replaces the old PDF-packet handoff for normal operation. The
legacy slash-command chain remains a fallback path.

---

## Using it as a member

### Browse the paper queue

Open `/papers` on the member site. The inbox has four sections:

| Section | What it shows |
|---|---|
| Reading now | The next scheduled meeting at or after the current time. |
| Lead's picks | Future scheduled meetings with assigned leaders, excluding the current reading so it is not duplicated. |
| Want to lead | Member paper suggestions whose paper does not already have a meeting with a leader assigned. |
| Recently discussed | Done meetings, plus non-cancelled meetings in the past, newest first. |

`/papers` is deliberately readable without the dashboard auth redirect,
like `/papers/<id>`. Member-only actions still require a roster-linked
session because the server actions call `current_member_id()`.

### Propose a paper you want to lead

Use the "Suggest a paper" form in the Want to lead section:

1. Pick an existing catalog paper.
2. Add an optional note.
3. Submit once; repeat submissions for the same paper are treated as
   no-ops.

The server action validates the paper id, creates a placeholder
`reading_group` meeting in `prep` status when one does not already exist,
and inserts a `paper_suggestions` row as the signed-in member. Migration
`019_meetings_propose_placeholder_unique.sql` keeps one member-proposed
placeholder per paper even when two members submit concurrently.

### Volunteer for a proposed paper

If another member proposed a paper, click the volunteer button on that
card. The action inserts `volunteers(meeting_id, member_id)` through the
RLS-scoped client. The table's unique constraint makes repeated clicks
idempotent.

### Read and practice

Open `/papers/<id>`:

- If `paper_companions.payload` exists, the page renders the synthesized
  dashboard and assessment panel.
- If no payload exists but a legacy static fixture exists under
  `web/content/papers/<id>.json`, the page renders that fixture.
- If the paper exists in the catalog but no companion exists, the leader or
  operator sees a synthesize CTA; everyone else sees a read-only empty
  state.
- If none of those sources exist, the page returns 404.

The assessment panel has multiple-choice and Socratic modes. Socratic mode
is disabled when the synthesized payload has no Socratic prompts.

---

## Synthesis workflow

### Who can synthesize

`/new?paperId=<id>` requires a signed-in roster member and calls the
`can_synthesize_paper_pal(p_paper_id)` RPC:

| Caller | Result |
|---|---|
| `members.role = 'operator'` or `'admin'` | Allowed, reason `owner`. |
| Leader of any meeting that uses the paper | Allowed, reason `leader`. |
| Other signed-in member or anonymous visitor | Not allowed. |

The page-level check is a UX guard. The `analyze-paper` Edge Function and
the `papers-pdfs` Storage insert policy enforce the same gate server-side.

### Upload constraints

The client only accepts:

- MIME type `application/pdf`
- File size up to 32 MB
- Storage path `<paper_id>/<uuid>.pdf` in the private `papers-pdfs` bucket

Migration `018_papers_pdfs_bucket.sql` creates the private bucket and the
INSERT policy. There are no SELECT, UPDATE, or DELETE policies for regular
authenticated users; Edge Functions and maintenance tasks use the service
role for signed URLs and pruning.

### What happens after upload

The browser POSTs to `/functions/v1/analyze-paper` with:

```json
{
  "paper_id": 42,
  "pdf_storage_path": "42/8a0e8f3f-4d4d-4d1f-b5d9.pdf"
}
```

The response is a Server-Sent Events stream:

1. `stage: parsing_pdf`
2. `stage: generating_synthesis`
3. `stage: drafting_assessment`
4. `stage: persisting`
5. `complete`

On success, the function calls `upsert_paper_companion()` so the payload,
provider metadata, generated-by member, timestamp, and regeneration count
move together in one database statement. The browser then navigates to
`/papers/<id>`.

Rate limiting reads `paper_companions.last_synthesis_at` and uses
`PAPER_PAL_REGEN_COOLDOWN_SEC`, defaulting to 300 seconds. Admin callers
can override the provider per request; non-admin callers use
`PAPER_PAL_PROVIDER`.

---

## Assessment and tutoring

Both live assessment functions require a Supabase JWT.

| Function | Request style | Gate | Side effect |
|---|---|---|---|
| `analyze-hint` | POST JSON with `paper_id`, question text/options, and user answer | Operator/admin, or a member with `meeting_attendance.rsvp_status = 'attending'` for a meeting using the paper | None; returns hint JSON only. |
| `analyze-socratic` | POST JSON with paper id, prompt context, history, user response, and turn number | Same as `analyze-hint` | Appends a transcript row to `paper_socratic_turns` via service role when possible. |

If the attendance gate query itself fails, the functions return a retryable
gate-check error instead of pretending the member is unauthorized.

---

## Operational notes

### Required setup

Apply migrations through `019_meetings_propose_placeholder_unique.sql`.
Paper Pal depends on:

- `paper_companions` and its RLS policies (`013`)
- expanded member roles (`014`)
- `paper_companions` provider metadata, `paper_socratic_turns`, and
  `upsert_paper_companion()` (`016`)
- `can_synthesize_paper_pal()` and `current_member_role()` (`017`)
- `papers-pdfs` Storage bucket and INSERT policy (`018`)
- placeholder dedupe for member proposals (`019`)

Deploy the Edge Functions:

```sh
supabase functions deploy analyze-paper    --import-map supabase/functions/import_map.json --execution-timeout 120
supabase functions deploy analyze-hint     --import-map supabase/functions/import_map.json --execution-timeout 30
supabase functions deploy analyze-socratic --import-map supabase/functions/import_map.json --execution-timeout 30
```

Set Supabase secrets:

```sh
supabase secrets set \
  PAPER_PAL_PROVIDER=gemini \
  PAPER_PAL_REGEN_COOLDOWN_SEC=300 \
  PAPER_PAL_PRUNE_DRY_RUN=true \
  GEMINI_API_KEY=... \
  ANTHROPIC_API_KEY=...
```

`PAPER_PAL_PRUNE_DRY_RUN` is read by the weekly
`wids-prune-paper-pdfs` scheduled task, not by the Edge Functions.

### Storage pruning

Register `scheduled_tasks/prune-paper-pdfs.md` as the weekly
`prune-paper-pdfs` scheduled task. It logs command rows under
`name = 'wids-prune-paper-pdfs'`, starts in dry-run mode, and only deletes
oldest PDFs when the bucket exceeds 500 MB, down to a 450 MB floor.

### Dashboard caveat

The dashboard's promoted Paper Pal card still reads `papers.companion_url`.
The full reading page reads `paper_companions.payload` directly. If a
newly synthesized paper appears at `/papers/<id>` but not on the dashboard,
check whether the catalog row's `companion_url` is populated.

### Troubleshooting

| Symptom | First place to check |
|---|---|
| `/new` says only the leader/operator can synthesize | Confirm the caller's `members.role`, or that they are `meetings.leader_id` for a meeting with this `paper_id`. |
| Upload fails with permission/RLS text | Confirm migration `018` is applied and the object path starts with `<paper_id>/`. |
| Synthesis returns 429 | Wait for the `PAPER_PAL_REGEN_COOLDOWN_SEC` window or inspect `paper_companions.last_synthesis_at`. |
| Synthesis fails mid-stream | The page shows the stream error; inspect the Supabase Edge Function logs for `analyze-paper`. |
| Hint/Socratic returns 403 | Confirm the member has an `attending` RSVP for a meeting that uses the paper, or is operator/admin. |
| `/papers/<id>/present` 404s | Presenter mode requires `paper_companions.payload`; legacy static fixtures are not enough. |

---

## Behind the scenes

```text
Browser
  /papers -> InboxScreen -> getInbox()
      proposePaper()/volunteerForMeeting()

  /new?paperId=<id>
      Storage upload: papers-pdfs/<paper_id>/<uuid>.pdf
      POST /functions/v1/analyze-paper

Supabase Edge Function
  can_synthesize_paper_pal()
  signed URL for private PDF
  provider synthesis
  upsert_paper_companion()

Browser
  /papers/<id> -> PaperDashboard + AssessmentPanel
      POST /functions/v1/analyze-hint
      POST /functions/v1/analyze-socratic
  /papers/<id>/present -> presenter deck
```

The shared provider code lives under `web/lib/paperpal/providers/` and is
imported by the Deno functions with the repository import map so Node tests
and Edge Functions use the same schemas and provider logic.

---

## Where things live

```text
docs/
  paper-pal-portal.md                         <- this guide
  superpowers/specs/2026-05-17-paper-pal-*.md <- design background
  superpowers/plans/2026-05-18-paper-pal-*.md <- implementation handoffs

migrations/
  013_paper_companions.sql
  016_paper_pal_provider_metadata.sql
  017_synthesis_gate_rpc.sql
  018_papers_pdfs_bucket.sql
  019_meetings_propose_placeholder_unique.sql

scheduled_tasks/
  prune-paper-pdfs.md

supabase/functions/
  _shared/gate.ts
  analyze-paper/index.ts
  analyze-hint/index.ts
  analyze-socratic/index.ts

web/
  app/papers/page.tsx
  app/papers/[id]/page.tsx
  app/papers/[id]/present/page.tsx
  app/new/page.tsx
  app/new/NewPaperForm.tsx
  components/paperpal/
  lib/paperpal/
```

---

## Lightweight validation

Documentation-only changes do not require a full app build, but these are
the relevant source checks when behavior changes:

```sh
cd web
npm test -- lib/paperpal/__tests__/
npm run typecheck
```

For ops documentation changes, also spot-check:

1. `migrations/README.md` lists every migration file through `019`.
2. `scheduled_tasks/README.md` includes every non-deprecated task that
   should be registered.
3. `supabase/functions/README.md` agrees with
   `migrations/018_papers_pdfs_bucket.sql` about the `papers-pdfs` bucket.
