# Handoff — Discussion board (Phase 8)

**Status:** Stub. Gated on operator approval of the schema migration. Per `tasks.md` this is **NEEDS SCHEMA** — confirm with the operator before writing the migration.

**Goal:** the `04 Discuss` surface from the prototype, live at `/papers/[id]/discuss`. Members post and reply across four paper scopes (abstract / method / math / architecture) with reactions (Helpful / Aha / ?).

---

## Migration (`migrations/014_discussion_board.sql`)

```sql
BEGIN;

CREATE TABLE discussion_threads (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  paper_id     INT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  scope        TEXT NOT NULL CHECK (scope IN ('abstract','method','math','architecture')),
  author_id    INT NOT NULL REFERENCES members(id),
  title        TEXT NOT NULL,
  body         TEXT NOT NULL,
  reactions    JSONB NOT NULL DEFAULT '{"helpful":0,"aha":0,"q":0}',
  reply_count  INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE discussion_replies (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id   UUID NOT NULL REFERENCES discussion_threads(id) ON DELETE CASCADE,
  author_id   INT NOT NULL REFERENCES members(id),
  body        TEXT NOT NULL,
  reactions   JSONB NOT NULL DEFAULT '{"helpful":0,"aha":0,"q":0}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON discussion_threads (paper_id, created_at DESC);
CREATE INDEX ON discussion_replies (thread_id, created_at ASC);

-- RLS auto-enables (ensure_rls trigger). Policies:

-- Read: any active member
CREATE POLICY discussion_threads_select ON discussion_threads FOR SELECT TO authenticated
  USING (current_member_id() IS NOT NULL);
CREATE POLICY discussion_replies_select ON discussion_replies FOR SELECT TO authenticated
  USING (current_member_id() IS NOT NULL);

-- Insert: as self only
CREATE POLICY discussion_threads_insert ON discussion_threads FOR INSERT TO authenticated
  WITH CHECK (author_id = current_member_id());
CREATE POLICY discussion_replies_insert ON discussion_replies FOR INSERT TO authenticated
  WITH CHECK (author_id = current_member_id());

-- Update: any active member can update reactions; gate other fields client-side.
-- (A column-level policy would be cleaner; skip for v1.)
CREATE POLICY discussion_threads_update ON discussion_threads FOR UPDATE TO authenticated
  USING (current_member_id() IS NOT NULL);
CREATE POLICY discussion_replies_update ON discussion_replies FOR UPDATE TO authenticated
  USING (current_member_id() IS NOT NULL);

-- Delete: author only
CREATE POLICY discussion_threads_delete ON discussion_threads FOR DELETE TO authenticated
  USING (author_id = current_member_id());
CREATE POLICY discussion_replies_delete ON discussion_replies FOR DELETE TO authenticated
  USING (author_id = current_member_id());

COMMIT;
```

After applying: `reply_count` and `reactions` aggregates need a trigger or an RPC. Simplest: a `bump_reply_count()` AFTER INSERT trigger on `discussion_replies`. Reactions can be a `toggle_reaction(thread_id, reaction, delta)` RPC that the client calls — easier than RLS-policy gymnastics around column updates.

---

## Files

```
migrations/014_discussion_board.sql
web/lib/paperpal/discussion.ts       — listThreads / getThread / postThread / postReply / toggleReaction; cursor pagination at 20.
web/app/papers/[id]/discuss/page.tsx — server component, fetches threads for the paper id.
web/components/paperpal/discussion/DiscussionScreen.tsx        — main column threaded list.
web/components/paperpal/discussion/ThreadCard.tsx              — single thread + inline replies.
web/components/paperpal/discussion/Composer.tsx ('use client') — new-thread / new-reply form.
web/components/paperpal/discussion/SideRail.tsx                — question queue + member list + per-scope counts.
web/components/paperpal/discussion/discussion.css              — port from prototype discussion-board.css.
```

Port verbatim from `/tmp/design/paper-pal/project/design_handoff/design/discussion-board.jsx` + `.css`.

---

## Realtime (optional Task 8.3)

```ts
supabase
  .channel(`discussion:${paperId}`)
  .on("postgres_changes",
      { event: "*", schema: "public", table: "discussion_threads", filter: `paper_id=eq.${paperId}` },
      handler)
  .on("postgres_changes",
      { event: "*", schema: "public", table: "discussion_replies", filter: `thread_id=in.(${threadIdsCsv})` },
      handler)
  .subscribe();
```

Realtime adds operational complexity (subscription leaks on hot reload, reconnect storms after sleep) — ship without it first, add when there's felt demand.

---

## Test plan

- [ ] Migration applies cleanly. RLS policies present.
- [ ] Member A posts a thread; Member B sees it on reload.
- [ ] Reaction toggle works (idempotent: clicking twice nets to zero).
- [ ] Author can delete their own thread; non-author cannot.
- [ ] SQL editor as member A cannot read a `discussion_threads` row written as member B — actually they can (read = any active member), confirm this is intentional, document.
- [ ] Cursor pagination works at 20 threads.

---

## Risks

- **Moderation.** No moderator role yet. If a chapter member posts abuse, the operator's only tool is `delete from discussion_threads where id = ...`. Acceptable for a small group; flag for V2.
- **Reaction concurrency.** Two members clicking "Helpful" simultaneously race; both reads see `n`, both write `n+1`. Use a SQL `UPDATE ... SET reactions = jsonb_set(...)` with atomic increment, or just accept the occasional dropped reaction.
- **Spam from notifications.** Don't email-notify on every reply. If notifications are added later, batch nightly.
