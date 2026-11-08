# Paper Pal request deadlines

Tutor and written-hint requests have one 30-second client deadline covering
session lookup, fetch, and response-body reading. A timeout aborts the request
and releases the controls even if a client never settles. Tutor failures use
the existing scripted-probe fallback; hint failures allow a retry. Leaving the
component cancels its requests, and resetting the tutor cancels its current call.

The client sends its remaining budget minus five seconds to the edge function.
The server caps that budget at 25 seconds, includes gate lookup time, and passes
an AbortSignal through both Gemini and Claude fetches. Expired requests do not
start a provider call. A late tutor result cannot start a transcript insert; an
insert already in flight receives the same signal.

These budgets bound waiting; they are not based on measured production p95.
Cancellation does not guarantee that a provider stops computing or billing, or
that an already-started database write can be undone.

## Validation and release

The timeout PR contains 16 regressions using mocked auth, AI responses, and
database clients. It covers unsettled auth/fetch/body reads, timeout boundaries,
retry, late results, provider cancellation, and the actual Socratic handler
discarding an expired result before insertion. From `web/`, run:

```sh
npm test -- components/paperpal/assessment/__tests__/request-timeouts.test.tsx lib/paperpal/edge_helpers/__tests__ lib/paperpal/providers/__tests__/cancellation.test.ts
```

Pending-message persistence, cross-tab state, and unanswered-turn handling are
in a separate storage PR based on this branch. This timeout PR keeps the v1
storage format. The successful local two-tab browser checks apply to the
combined timeout and storage changes, not this branch alone.

Merging deploys the web app, not the Supabase edge functions. Deploying
`analyze-hint` and `analyze-socratic` requires separate production authorization.
The old functions can ignore the new budget header until then. Production
latency, billing after cancellation, and the preview two-tab check remain open.
No live AI requests or production writes were used for validation.
