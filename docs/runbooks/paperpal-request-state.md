# Paper Pal saved assessment state

This storage change builds on the separate [request-deadline change](paperpal-request-timeouts.md).
It saves learner messages before clearing the composer, preserves independent
updates from other tabs, and attaches replies to their original learner turns.
Late replies retain existing summaries and cannot restore a reset conversation.
Unanswered turns remain visible with an explanation and do not advance the
completed-turn count or enter later AI history.

## Storage and rollback

Quiz and tutor actions use unique `paperpal:v3:` localStorage keys. Actions,
migration baselines, and checkpoints have validated schemas; invalid or obsolete
records are skipped. Cached snapshots are invalidated by relevant storage/change
events, so typing does not rescan the log. Dispatch rereads saved state before
applying an action.

At 64 records or 64 KiB of action data, a compactor takes a Web Lock, publishes a
checkpoint, and removes only the records included in it. Readers use the covered
record list to avoid applying those actions twice during cleanup. They retry if
the checkpoint changes while enumerating records. Concurrent writes survive
cleanup even if their logical clock predates the checkpoint.

Browsers without Web Locks retain the journal rather than compact unsafely.
Conversation text can still grow until reset, and storage quotas still apply.
Failed writes stay in memory and retry on the next interaction; a reload before
storage recovers can lose those unsaved changes.

The first action imports v1 progress, and v1 snapshots are mirrored for rollback.
No separate current progress reader needs those snapshots. Refresh older tabs
before using cross-tab behavior. If an old version writes v1 data after rollback,
re-landing requires a new storage version/import; reusing an existing v3 journal
would hide those writes. The unreleased v2 format is not replayed; its latest v1
mirror is imported.

## Verification

This PR adds 17 storage regressions on top of the timeout PR's 16 tests. They
cover cross-tab exchanges and quiz answers, pending-message reload, late replies,
reset and synthesis races, cached reads, invalid records, compaction concurrent
with a writer, native storage events, and recovery after failed writes.

From `web/`, run:

```sh
npm test -- components/paperpal/assessment/__tests__/pending-races.test.tsx components/paperpal/assessment/__tests__/storage-review.test.tsx
```

On November 8, 2026, two Chrome tabs running a local production build passed both
previously failing browser sequences with synthetic paper 900007:

- Tab A submitted question 1; tab B submitted question 2. Both tabs retained the
  correct answers, disabled submitted options, and a 2/2 score after full reloads.
- Tab A's tutor reply was held while tab B completed its exchange and synthesis.
  Releasing A's reply preserved both exchanges and the summary in both tabs after
  full reloads. Both retained the synthesized state and disabled Send controls.

Neither tab logged React #418, another console error, or a warning. Browser
receipts and screenshots were retained locally. The browser run used the combined
implementation at `f3baacb`; the split branches reproduce the same application
and edge-function source. No live AI requests or production data writes were used.

The [preview harness](paperpal-preview-checks.md) supports the same sequences on
Vercel without live AI or database requests. See PR #230 for deployment-specific
browser results. Local fixtures do not establish preview or production behavior.
Production latency sampling, provider billing
after cancellation, and authorized deployment of the two edge functions also
remain open. The optional model-parity test was not rerun.
