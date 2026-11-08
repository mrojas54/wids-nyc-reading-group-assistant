# Paper Pal request recovery and saved state

Tutor and written-hint requests have one 30-second deadline covering session
lookup, the network request, and response-body reading. A timeout aborts the
request and releases the controls even if the underlying client never settles.
Tutor failures use the existing scripted-probe fallback; hint failures allow a
retry. Leaving the component cancels its outstanding requests.

The tutor saves the learner's message before clearing the composer. Reloading
during a request preserves that message; it does not automatically resend it.
Replies are attached to their original learner turn. A late reply cannot replace
another tab's conversation or synthesis, and replies from before a reset are
discarded.

## Storage across tabs

Quiz and tutor changes are saved as individual actions under unique
`paperpal:v2:` localStorage keys. Tabs replay the actions in logical-clock order,
with the action ID breaking ties, and subscribe to storage changes. Independent
writes therefore do not replace a whole quiz or conversation snapshot. A reset
still intentionally clears the relevant assessment or conversation.

The first action captures existing v1 progress as its baseline. The action log
is authoritative after migration; v1 snapshots are still written for existing
progress readers. Tutor messages, hint count, and synthesis status are reduced
together. Refresh tabs running an older app version before using the new
cross-tab behavior.

Storage remains local to a browser profile and origin. The log is append-only;
it is not a server backup. If browser storage rejects writes, the page keeps
working in memory, but reload persistence is not guaranteed.

## Regression coverage

From `web/`, run:

```sh
npm test -- components/paperpal/assessment/__tests__/pending-races.test.tsx
```

The 18 tests use synthetic papers, mocked authentication and responses, and
controlled clocks. They cover stalled session lookup, fetch and body reading;
the exact timeout boundary; retry and cancellation; pending-message reload;
both tutor response orders; reset and synthesis races; independent quiz writes
with equal clocks; and isolation between papers. Existing hydration tests also
exercise saved quiz and tutor state.

The original implementation failed 10 of the initial 12 checks. With this fix,
all 18 regressions pass. Full local validation passed: 539 web tests, 576 Python
tests, ESLint, TypeScript, the production build, Ruff, and ty. The optional model
parity test was skipped in this run.

An additional browser retest against a local production fixture could not be
completed because browser input automation timed out before activating the
fixture controls. The automated tests and build do not establish production
behavior. Production interaction, timeout, reload, and cross-tab checks remain
untested for this fix. No live AI requests or production data writes were used.
