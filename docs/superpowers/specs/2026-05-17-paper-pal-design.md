# Paper Pal — Design

**Date:** 2026-05-17
**Status:** Draft (this commit)
**Supersedes (in user-facing language only):** [2026-05-04-paper-companion-design.md](./2026-05-04-paper-companion-design.md)
**Source:** Design Handoff bundle `paper-pal/` from Claude Design (`paper-pal/project/design_handoff/`).

## 1. What this changes

"Companion page" — the per-paper static walkthrough at `/papers/<id>` — is renamed **Paper Pal** end-to-end across the member portal. The artifact, the route, the storage shape, and the rendering surface are unchanged in this slice. The brand is what shifts, plus a new authorization gate around the act of generating ("synthesizing") it.

This spec also lays down the **synthesis gate**: who can produce or regenerate a Paper Pal for a given paper. The actual generation pipeline (PDF → structured analysis → JSON payload) continues to run out-of-band via `/wids-make-companion` in this slice; in-portal synthesis lives behind a clearly-labeled stub and is sequenced for a follow-up.

The full PaperPal prototype shipped in `paper-pal/` proposes an in-portal synthesis flow backed by a Gemini Edge Function and a `paper_companions(payload jsonb)` table. **That is the medium-term target**, not what we ship here. This spec marks the path; `tasks.md` in the bundle is the work breakdown for the v2 rewrite.

### Goals (this slice)

1. Rebrand: every user-visible "companion" in the portal becomes "Paper Pal".
2. Encode the authorization rule: **owner OR paper leader** can synthesize a Paper Pal; nobody else can.
3. Distinguish "paper not in catalog" (404) from "paper in catalog, no Paper Pal yet" (synthesize prompt) on `/papers/<id>`.
4. Make the not-yet-synthesized state a gentle CTA, not a dead 404.

### Non-goals (this slice)

- In-portal synthesis. The Synthesize CTA shows operators/leaders **how** to run synthesis (slash command instructions). Wiring it to an Edge Function is the follow-up.
- A `paper_companions` jsonb table. Keep the file-based content layer (`web/content/papers/<id>.json`) intact.
- The richer dashboard layout from the prototype (bento tiles, abstract tile, terminology/math split, Socratic tutor, MCQ assessment, hint flags, presenter mode, discussion board). Those are Phase-by-Phase work in the handoff bundle's `tasks.md`.
- Mobile redesign.
- Anonymous auth. Magic link + roster gate stays.

## 2. Vocabulary

| Term | Meaning |
|---|---|
| **Paper Pal** | The per-paper synthesized companion artifact. Rendered at `/papers/<id>`. Replaces "companion" in user copy. |
| **Synthesize** | The act of generating (or regenerating) a Paper Pal from the paper PDF/text. |
| **Owner** | A member with `role IN ('operator', 'admin')`. The chapter custodian. |
| **Paper leader** | The `meetings.leader_id` member for any meeting whose `paper_id` equals this paper. A given paper can have at most one leader at a time in practice, but the gate accepts multiple historical leaders for the same paper. |

## 3. Authorization rule

For a paper `p`, the synthesis gate is:

```
canSynthesizePaperPal(p) :=
   member.role IN ('operator', 'admin')
   OR EXISTS (
        SELECT 1
        FROM meetings
        WHERE paper_id = p.id
          AND leader_id = current_member_id()
      )
```

Read paths (anyone on the roster can read a Paper Pal; the route stays public for share/forward links) are unchanged.

Three things follow:

1. **The `role` CHECK must permit `'leader'` and `'admin'`.** The current constraint allows only `'member'` and `'operator'` (migration 001). Dashboard code already references the other two as forward-compatible (`web/app/dashboard/page.tsx:54-57`), but the DB rejects writes for them today. A new migration widens the CHECK.
2. **The portal needs a `canSynthesizePaperPal(paperId)` helper.** Implemented in TS in `web/lib/queries.ts` rather than as an RPC, because the `/papers/<id>` route is public — the helper accepts a possibly-null session and returns `false` when no member is signed in.
3. **The `paper_leader` predicate is by membership in `meetings`, not by a `papers.leader_id` column.** No new column on `papers`. The leader-for-this-paper relationship is derived.

## 4. Surface changes

### 4.1 Strings to rename

| File | Was | Now |
|---|---|---|
| `web/app/papers/[id]/not-found.tsx` (heading) | `Companion not found.` | `Paper Pal not found.` |
| `web/app/papers/[id]/not-found.tsx` (body) | `That paper doesn't have a companion page yet…` | `That paper doesn't have a Paper Pal yet…` |
| `web/app/dashboard/page.tsx` (companion card eyebrow) | `Companion` | `Paper Pal` |
| `web/app/dashboard/page.tsx` (companion card meta) | `Open the paper guide` | `Open Paper Pal` |
| `web/app/dashboard/page.tsx` (fallback title) | `Companion reading` | `Paper Pal` |
| `web/components/YourHistory.tsx` (link label) | `Companion →` | `Paper Pal →` |
| `web/components/PaperCompanion.tsx` (TOC heading) | `In this companion.` | `In this Paper Pal.` |
| `web/components/PaperCompanion.tsx` (footer) | unchanged technical sentence | unchanged |

The `PaperCompanion` React component name and filename stay as-is for this slice — renaming them is a separate, mechanical PR. The user-visible string is what matters; the symbol name is internal.

CSS class names (`companion-card`, `companion-eyebrow`, etc.) stay as-is. Renaming CSS tokens has a blast radius disproportionate to the value.

`papers.companion_url` stays as-is. Renaming the column is a destructive schema edit; the column name is internal.

### 4.2 New: synthesis gate on `/papers/<id>`

Currently the page hits `notFound()` when `readPaperContent(id)` returns null — this conflates "paper isn't in the catalog" with "paper exists but hasn't been synthesized yet". The new flow:

```
fetch papers.id (catalog check)
fetch readPaperContent(id)        (file presence check)
fetch canSynthesizePaperPal(id)   (gate, null-session-safe)

if !catalog                    → notFound()                    (real 404)
if catalog && !content && gate → SynthesizePrompt(id, role)   (CTA banner)
if catalog && !content && !gate→ NotYetBanner(id)              (read-only)
if catalog && content          → PaperCompanion + optional Resynthesize CTA
```

`SynthesizePrompt` is an informational card that names the slash command (`/wids-make-companion <id>`) and links to the leader handbook section in the README. **No server-side mutation in this slice.** The button surface is in place for the future Edge Function wiring; clicking it today copies the slash command to clipboard.

`NotYetBanner` is the same card with the CTA removed — readers see "This Paper Pal hasn't been synthesized yet" and the leader name (so they know whom to bug).

### 4.3 Dashboard

The existing "Companion" card on the dashboard becomes the "Paper Pal" card. No new behavior. If the gate passes for the **current** meeting's paper and no Paper Pal exists yet, the card swaps copy to "Synthesize Paper Pal" and routes to `/papers/<id>` (where the prompt lives). One target is enough — don't fork the synthesize entry point.

## 5. Schema changes

### 5.1 Widen `members.role` CHECK

```sql
ALTER TABLE members DROP CONSTRAINT members_role_check;
ALTER TABLE members ADD CONSTRAINT members_role_check
  CHECK (role IN ('member', 'operator', 'leader', 'admin'));
```

The `one_operator` partial unique index stays — only one row may carry `role='operator'`. `'admin'` and `'leader'` are unconstrained in count, matching the dashboard code's expectations.

### 5.2 No new tables

The handoff bundle's Phase 1 proposes a `paper_companions(payload jsonb)` table for in-DB companion storage. **Deferred.** Keep file-based content for this slice. Rationale: lowest blast radius, no RLS surface to design, no migration on the deploy critical path. Move to JSONB when in-portal synthesis lands.

### 5.3 No new RLS

The synthesis gate is enforced **in the portal** (TS) and **in the slash command** (operator already gates this manually). Once in-portal synthesis lands, the Edge Function will enforce the same gate server-side; that's where RLS-or-equivalent on `paper_companions` will live.

## 6. Code shape

### 6.1 `web/lib/queries.ts` — new helper

```ts
export type SynthesisGate = {
  canSynthesize: boolean;
  reason: 'owner' | 'leader' | 'none';
};

/** Encodes the Paper Pal synthesis rule. Returns canSynthesize=false for
 *  unauthenticated callers. Safe to call from public routes. */
export async function canSynthesizePaperPal(
  sb: SupabaseClient,
  paperId: number,
): Promise<SynthesisGate>;
```

### 6.2 `web/app/papers/[id]/page.tsx` — branching

The current implementation has a single happy path: read file, render. The new shape branches on (catalog × content × gate). Lookup is one extra Supabase query for the catalog row and one for the gate; both happen in parallel with the file read via `Promise.all`.

### 6.3 New components

- `web/components/PaperPalSynthesizePrompt.tsx` — owner/leader card. Shows the slash command, a "Copy command" button, and one line of context ("This is the v1 trigger — in-portal synthesis is coming"). Client component because of clipboard.
- `web/components/PaperPalEmptyState.tsx` — non-eligible-reader card. Shows leader name, a "ask your operator" line, and a back link.

Both live under the public layout. Neither calls Supabase from the client.

### 6.4 Migration

`migrations/013_members_role_leader_admin.sql` — widens the CHECK per §5.1.

## 7. What we are NOT doing (this slice)

A flat list, so future readers don't think these were forgotten:

- **In-portal synthesis** — no Edge Function, no Gemini key, no `paper_companions` table.
- **Re-rendering the dashboard as the prototype's bento layout.**
- **Assessment / Socratic tutor / hint flags.**
- **Discussion board** (NEEDS SCHEMA in handoff).
- **Presenter / Reproduce / Compare PDF / SR review.**
- **Reading lens** (Beginner / Engineer / Expert).
- **Renaming `papers.companion_url` to `papers.paper_pal_url`.**
- **Renaming the `PaperCompanion` React component to `PaperPal`** — internal symbol, low value, deferred.

If any of those become important, `paper-pal/project/design_handoff/tasks.md` is the source for sequencing.

## 8. Acceptance

After this slice merges:

1. Every member-portal user-facing string referring to the per-paper artifact reads "Paper Pal", not "companion".
2. `/papers/<id>` for a paper that exists in the catalog but has no JSON content renders the Paper Pal-not-yet-synthesized card, not a 404. A paper id that doesn't match any row still 404s.
3. The Synthesize CTA on that card is visible **only** when the viewer is signed in **and** the synthesis gate returns true. Signed-out viewers and ineligible members see the read-only variant.
4. A member with `role='leader'` or `role='admin'` can be persisted in the DB without violating a CHECK constraint.
5. No new tables. No changes to RLS on existing tables. No changes to the slash-command toolchain.

Anything beyond the four points above is out of scope for this PR and belongs to a follow-up sequenced against the bundle's `tasks.md`.
