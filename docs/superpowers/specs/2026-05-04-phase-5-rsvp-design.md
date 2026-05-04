# Phase 5 — RSVP Control (Design)

Date: 2026-05-04
Status: approved (verbal), spec pending review

## Goal

Let signed-in members RSVP **attending / tentative / declined** to the next scheduled meeting from the dashboard. Persist in `meeting_attendance`. The dashboard reflects the saved choice on reload.

This is the next slice of the WiDS member app, layered on the dashboard merged in Phase 3 (PR #4). It supersedes the Phase 5 section of `docs/superpowers/plans/2026-05-03-wids-member-app.md`, which uses outdated zinc/blue Tailwind utilities and assumes `myRsvp` doesn't exist yet.

## Constraints

- **Design system:** sage primary, magenta as the voice for selected state, paper neutrals. Indigo is not used here. CSS lives as classes in `web/app/globals.css` matching the existing `next-meeting-*` / `btn` conventions; no inline Tailwind utility classes in the component markup.
- **Voice:** sentence case, em-dashes, "you" for member, no emoji, no exclamation points.
- **Data layer:** all reads/writes go through the server-rendered Supabase client and respect RLS. The action and queries already follow the auth_user_id → members.id resolution pattern from Phase 4.
- **Scope:** RSVP UI on the next meeting card only when `meeting.status === 'scheduled'`. Prep meetings get availability submission, not RSVPs.

## Architecture

### Data layer

- **`myRsvp(sb, meetingId)`** — already exists at [`web/lib/queries.ts:79`](../../web/lib/queries.ts). Returns `RsvpStatus | null`. Reused as-is. No new query.
- **Migration `008_meeting_attendance_grants.sql`** — adds the missing table-level grants for `authenticated`. RLS policies on `meeting_attendance` exist (002), but no `GRANT` was issued, so PostgREST returns `42501 permission denied` even when policies match. Same latent failure mode as Phase 4 / migration 007. Apply via Supabase MCP `apply_migration`, commit the file as a source-of-truth checkpoint.

  ```sql
  GRANT SELECT, INSERT, UPDATE ON meeting_attendance TO authenticated;
  GRANT USAGE, SELECT ON SEQUENCE meeting_attendance_id_seq TO authenticated;
  ```

- **Server action `web/app/dashboard/rsvp-actions.ts`** — `setRsvp(meetingId, status)`. Resolves the current member via `auth.getUser()` → `members` lookup on `auth_user_id`. Upserts `meeting_attendance` on `(meeting_id, member_id)` with `rsvp_status` and `responded_at`. Calls `logServerAction("setRsvp", "success" | "failure", ...)` on both paths and `revalidatePath("/dashboard")` on success.

### Component layer

- **New: `web/components/RsvpButtons.tsx` (client component)**

  Props:
  ```ts
  { meetingId: number; current: RsvpStatus | null }
  ```

  State machine:
  - **Collapsed mode** when `current ∈ {"attending","tentative","declined"}` and the user is not editing. Renders a single line: `"You're <verb> — change?"` where the dash is a real em-dash and `change?` is an inline magenta button.
  - **Picker mode** when `current ∈ {null, "no_response"}` or after the user clicks `change?`. Renders three buttons in this order: **Attending / Tentative / Can't make it**. All three share identical paper-outline styling. If a previous choice exists, that one renders pre-filled magenta (`aria-pressed="true"`) so the member can see their current selection before flipping.

  Behavior:
  - Optimistic update via `useTransition`: on click, immediately switch to collapsed mode showing the new verb; if the action throws, revert to `current` and re-open the picker.
  - All buttons receive `disabled` while pending; the row gets `aria-busy="true"`.

  Verb labels (used in the collapsed line):
  - `attending → "attending"`
  - `tentative → "tentative"`
  - `declined → "not coming"`

- **Modified: `web/components/NextMeetingCard.tsx`**

  - Add prop `myRsvp: RsvpStatus | null`.
  - When `meeting.status === "scheduled"`, append `<RsvpButtons meetingId={meeting.id} current={myRsvp} />` inside a `<section class="next-meeting-rsvp">` after the existing companion CTA, with a top divider matching the visual rhythm of the existing `<dl>`.
  - When `meeting.status === "prep"` (or anything else), render no RSVP block. The availability banner above already covers prep flow.

- **Modified: `web/app/dashboard/page.tsx`**

  Add an `await` for `myRsvp` between the existing prep-meeting lookup and `myStats`:

  ```ts
  const rsvp = meeting?.status === "scheduled"
    ? await myRsvp(sb, meeting.id)
    : null;
  ```

  Pass `myRsvp={rsvp}` to `<NextMeetingCard>`. Preserves the existing shell layout (Brandmark + sign-out) and the rest of the dashboard.

### Styling (`web/app/globals.css`)

New classes, following existing patterns. Prefer existing semantic tokens over raw color scales:

- `.next-meeting-rsvp` — top border `var(--border-1)`, padding-top to match existing card rhythm.
- `.rsvp-picker` — flex row, gap-2, flex-wrap.
- `.rsvp-btn` — `var(--bg-surface)` background, `var(--border-2)` border, `var(--fg-1)` text, rounded-md, px-3 py-1.5; hover → `var(--state-hover-bg)`.
- `.rsvp-btn[aria-pressed="true"]` — `var(--state-selected-bg)` background, white text, `var(--state-selected-ring)` outline. Reuses the design system's canonical "selected" treatment.
- `.rsvp-collapsed` — single line, `var(--fg-2)` text. The verb is bold (`<strong>`).
- `.rsvp-change` — inline `var(--accent-fg)`, underlined on hover, no background, button reset.
- Disabled / aria-busy state — opacity 0.6; no spinner.

No new tokens introduced. If a needed semantic alias is missing, add it to `globals.css` rather than hardcoding a `--color-*` scale value in the component class.

## Error handling

| Path | Behavior |
|---|---|
| `setRsvp` succeeds | Optimistic state stays; `revalidatePath` refreshes the server tree; reload shows persisted state. |
| `setRsvp` throws (network, RLS, missing member) | Component reverts optimistic state to `current`, re-opens picker. Action already logged the failure to `command_log`. No toast in v1 — the revert is the signal. |
| Member row missing (`auth_user_id` unlinked) | Action throws `"not on roster"`. Should not happen post-Phase 2, but the failure is logged and the UI degrades to the revert path. |
| Meeting transitions `scheduled → done` between page load and click | Upsert still succeeds; the post-action revalidation surfaces the new status. Not a bug worth defensive code. |
| `current === "no_response"` | Treated as "no choice yet" — render picker. The DB default produces this when a row exists without a real RSVP; functionally identical to `null`. |

## Out of scope

- The `notes` column on `meeting_attendance`. Column exists in 001, not exposed in this UI.
- RSVP deadlines or automated reminders.
- Showing other members' RSVPs. `attendance_select_own` enforces own-rows-only at the DB layer; nothing to expose.
- RSVP on prep meetings. Date isn't fixed yet, so the action would be meaningless.
- Toasts / banner-style success messages. The collapsed-line update is the success signal.

## Hand-test plan

1. Apply `migrations/008_meeting_attendance_grants.sql` via Supabase MCP.
2. Verify (or insert) a `meetings` row with `status='scheduled'` and `scheduled_at` in the future. Tie it to a paper if testing the companion CTA alongside.
3. Sign in as `mirojas1524@gmail.com`. Dashboard loads → `NextMeetingCard` shows three paper-outline RSVP buttons.
4. Click **Attending** → card collapses to `"You're attending — change?"`. Inspect `meeting_attendance` in Supabase: row exists with `rsvp_status='attending'`, `responded_at` populated.
5. Click **change?** → picker re-opens with **Attending** pre-filled magenta. Click **Tentative** → collapses to `"You're tentative — change?"`. Verify same row updated (`rsvp_status='tentative'`, new `responded_at`).
6. Click **change?** → **Can't make it** → collapses to `"You're not coming — change?"`. Verify.
7. Reload page (full SSR) → collapsed state with the correct verb persists.
8. Optional: simulate a failure path by temporarily revoking the grant, click an RSVP, confirm the picker reverts. Re-grant before merging.

## Why this design

- **Magenta-as-selection** matches the design system's defined role for magenta (selected state / active accent). Pre-click, the three buttons read as equally weighted real options — which they are. Post-click, the magenta fill is the answer.
- **Collapse-with-change?** keeps the dashboard quiet for the common case (member has decided, doesn't need to see the other two options every visit). The `change?` affordance is enough to recover.
- **Migration 008** is the cheapest way to prevent a repeat of the phase-4 P0. Cataloguing the grants per table as we extend the member-app surface is more reliable than spotting it during hand-test.
- **`myRsvp` reuse** avoids duplicating a query that already exists with the right return type.
