# Handoff — Spaced-repetition review (Phase 9)

**Status:** Deferred stub. The Paper Pal handoff bundle explicitly defers this; ship only if there's chapter appetite. Document exists so the migration shape is recorded.

**Goal:** cross-paper spaced-repetition deck. The prototype surfaces it at `Tweaks → New surfaces → Spaced-repetition review`. Cards are derived from `terminology` and `mathExplanations` across all papers a member has opened; per-member review schedule lives in `sr_cards`.

---

## Migration (`migrations/015_sr_cards.sql`)

```sql
BEGIN;

CREATE TABLE sr_cards (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id    INT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  paper_id     INT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('term','math')),
  ref          TEXT NOT NULL,         -- term name or math.formula hash
  front        TEXT NOT NULL,
  back         TEXT NOT NULL,
  ease         REAL NOT NULL DEFAULT 2.5,   -- SM-2 ease factor
  interval_d   INT  NOT NULL DEFAULT 0,
  due_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  reps         INT  NOT NULL DEFAULT 0,
  lapses       INT  NOT NULL DEFAULT 0,
  last_grade   INT,                          -- 0..5
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (member_id, paper_id, kind, ref)
);

CREATE INDEX ON sr_cards (member_id, due_at);

-- Optional aggregate view of per-paper mastery (term retention %, math retention %).
-- Build the read-side as a SQL view rather than a separate table.
CREATE VIEW sr_mastery AS
SELECT
  member_id,
  paper_id,
  kind,
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE reps > 0 AND last_grade >= 3) AS retained
FROM sr_cards
GROUP BY member_id, paper_id, kind;

-- RLS (ensure_rls trigger auto-enables):
CREATE POLICY sr_cards_select_own ON sr_cards FOR SELECT TO authenticated
  USING (member_id = current_member_id());
CREATE POLICY sr_cards_insert_own ON sr_cards FOR INSERT TO authenticated
  WITH CHECK (member_id = current_member_id());
CREATE POLICY sr_cards_update_own ON sr_cards FOR UPDATE TO authenticated
  USING (member_id = current_member_id())
  WITH CHECK (member_id = current_member_id());
CREATE POLICY sr_cards_delete_own ON sr_cards FOR DELETE TO authenticated
  USING (member_id = current_member_id());

COMMIT;
```

Views aren't auto-RLS'd; either expose `sr_mastery` only to `authenticated` and let the underlying table policies filter, or wrap as a SECURITY INVOKER function.

---

## Card seeding

When a member first opens `/papers/[id]` with a populated companion: a server action enumerates `payload.terminology` and `payload.mathExplanations` and inserts one `sr_cards` row per item (`due_at = now()`). Idempotent via the UNIQUE constraint.

Trigger point: the existing `PaperScreen` server component (TASK in this handoff: bolt on a single `seedSrCards(memberId, paperId, payload)` server call wrapped in a `noStore()`-friendly `try/catch`).

---

## Review algorithm

Plain SM-2 is fine. On grade `q` ∈ {0..5}:

```
if q < 3:
  reps = 0; interval_d = 1; lapses += 1
else:
  reps += 1
  ease = max(1.3, ease + (0.1 - (5-q)*(0.08 + (5-q)*0.02)))
  interval_d = match reps { 1 -> 1, 2 -> 6, _ -> round(interval_d * ease) }
due_at = now() + interval_d days
last_grade = q
```

Implement once in `web/lib/paperpal/sr.ts`. Tests should pin the SM-2 numbers exactly so future tweaks (FSRS, etc.) show up as diffs.

---

## UI

`/papers/review` (cross-paper, not per-paper):

- Card front: term or formula.
- Back: definition + source-paper chip linking back to `/papers/[id]`.
- Grade buttons: `Again (0)`, `Hard (3)`, `Good (4)`, `Easy (5)`.
- Top strip: `N due today` + ease histogram (1-line sparkline).

Per-paper review (`/papers/[id]/review`) is a filtered version of the same screen.

---

## Wobble integration

PR #45 records hint flags client-side via `recordHint(paperId, sectionRef)` and surfaces a "Wobbled · N" pill on the section breakdown. For SR: at card-seed time, boost initial `interval_d = -1` (immediately due) for cards whose `sectionRef` has hint flags > 0. Cheap signal, no cross-member aggregation needed.

---

## Out of scope for this handoff

- FSRS instead of SM-2 (defer; ship with what works).
- Cross-member wobble aggregation (the prototype's `wobble-review.jsx` is the reference; needs its own small table).
- Push / email reminders for due cards.

---

## Test plan

- [ ] Migration applies, RLS policies present.
- [ ] First load of a paper with N terms seeds N rows, all due immediately. Re-loading the same paper doesn't duplicate.
- [ ] Grading 5 on a card moves `due_at` forward by 1 day on the first rep, 6 on the second.
- [ ] Grading 0 resets `reps` and bumps `lapses`.
- [ ] Member B cannot see Member A's cards via the SQL editor.

---

## Risks

- **Cold-start emptiness.** New members open the app and see "No cards due." Mitigation: seed lazily and surface "You've reviewed everything you've opened. Open another paper." copy, not a 404-shaped empty state.
- **Schema drift with companion payload.** A re-generated companion may rename a term; old `sr_cards.ref` rows orphan. Acceptable in v1; document.
- **Card volume.** A typical paper yields ~12 terms + ~5 math cards. Ten papers = ~170 cards per member. Fine for SM-2; flag if FSRS adds memory pressure.
