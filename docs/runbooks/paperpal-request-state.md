# Paper Pal request recovery and saved state

Tutor and written-hint requests have one 30-second client deadline covering
session lookup, the network request, and response-body reading. A timeout
aborts the request and releases the controls even if a client never settles.
Tutor failures use the existing scripted-probe fallback; hint failures allow a
retry. Leaving the component cancels its outstanding requests.

The client sends its remaining budget minus five seconds to the edge function.
The server caps that budget at 25 seconds, includes gate lookup time, and passes
an AbortSignal through both Gemini and Claude fetches. Expired requests do not
start a provider call. A tutor result arriving after cancellation cannot start a
transcript insert; an insert already in flight receives the same abort signal.
These budgets bound waiting; they are not based on measured production p95.
Cancellation does not guarantee that a provider stops computing or billing, or
that an already-started database write can be undone.

The tutor saves the learner's message before clearing the composer. Reloading
during a request preserves that message without automatically resending it.
Unanswered messages are labeled, remain visible, and are excluded from subsequent
AI history, turn numbering, and the completed-turn threshold for synthesis.
Replies attach to their original learner turn. A late reply cannot replace
another tab's conversation or synthesis, and replies from before a reset are
discarded.

## Storage across tabs

Quiz and tutor changes use individual actions under unique `paperpal:v3:`
localStorage keys. Actions, migration baselines, and checkpoints have validated
schemas. Invalid or obsolete records are skipped. Cached snapshots are
invalidated by relevant storage/change events, so typing does not rescan the log.
A dispatch rereads storage before applying its action.

At 64 records or 64 KiB of action data, a compactor takes a Web Lock, publishes a
checkpoint, then deletes only the records included in that checkpoint. The
checkpoint lists those records so readers do not apply them twice during
cleanup. Readers retry if the checkpoint changes while they enumerate records.
Concurrent writers use unique keys and survive cleanup, even with an older
logical clock. Web Locks serialize compactors; browsers without that API retain
the journal rather than perform unsafe cleanup. The saved conversation itself
can still grow until reset, and browser storage quotas still apply.

The first action imports existing v1 progress. v1 snapshots are also written to
support rollback to the old components; no separate current progress reader
needs them. Refresh tabs running an older app before using cross-tab behavior.
If an old version writes new v1 data after rollback, re-landing requires a new
storage version/import; reusing an existing v3 journal would hide those writes.
The unreleased v2 format is not replayed by v3; its latest v1 mirror is imported.

Storage is local to a browser profile and origin, not a server backup. Failed
writes remain in memory and are retried on the next interaction. A reload before
storage recovers can still lose those unsaved changes.

## Regression coverage

From `web/`, run:

```sh
npm test -- components/paperpal/assessment/__tests__ lib/paperpal/edge_helpers/__tests__ lib/paperpal/providers/__tests__/cancellation.test.ts
```

This PR adds 33 tests using synthetic papers, mocked authentication/providers,
and controlled clocks. They cover unsettled auth/fetch/body reads; exact timeout
boundaries; cancellation, retries and reloads; late replies and resets; synthesis
races; equal-clock quiz writes; cached reads; invalid records; compaction with a
concurrent writer; native storage events; storage recovery; and the actual
Socratic edge handler discarding a late provider result before insertion.

The original implementation failed 10 of the first 12 checks. Review probes
then reproduced six additional expectations before their fixes. All 33 now pass.
Full local validation passed: 554 web tests, 576 Python tests, ESLint, TypeScript,
the production build, Ruff, ty, and Deno checks/lint. The optional model-parity
test was skipped in this run.

A local production-build browser check confirmed that tab B received tab A's
saved quiz update. Input automation then timed out before the second submission
and reload sequence, so the full two-tab browser pass remains incomplete.
Production/preview interactions, a busy-week latency sample, and provider billing
after cancellation remain unverified. No live AI requests or production writes
were used. The changed edge functions still need an authorized deployment before
production benefits from server-side deadlines.
