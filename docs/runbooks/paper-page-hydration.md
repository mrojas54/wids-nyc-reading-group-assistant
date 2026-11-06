# Paper page hydration

## Symptom and cause

A full load of `/papers/40` could log React error #418 when the browser had
saved quiz progress. The server rendered unanswered questions; the browser's
first render added saved feedback and disabled answers. React replaced that
part of the page because the HTML did not match.

The shared `useLocalState` hook read localStorage in its state initializer.
Its `typeof window` guard made server rendering safe to execute, but did not
make the server and browser produce the same initial markup. Saved difficulty
lenses, tutor conversations, and `useHintFlags` markers had the same problem.

`useHydrated` now uses React's server snapshot during both server rendering and
the first hydration render. The hooks expose their defaults during that phase,
then expose the saved values. Persistence waits until hydration completes.
The Socratic opener uses a functional update so an empty hydration placeholder
cannot overwrite a saved conversation.

See [React's server-rendering guidance for useSyncExternalStore](https://react.dev/reference/react/useSyncExternalStore#adding-support-for-server-rendering).

## Regression check

From `web/`:

```sh
npm test -- components/paperpal/__tests__/hydration.test.tsx
```

The tests server-render the real assessment and terminology components without
`window`, then hydrate that HTML with saved browser state. They check that:

- React reports no recoverable hydration errors and retains the server DOM.
- Saved answers, preferences, hint markers, and tutor messages are restored.
- Hydration does not write default answers or a new opener over saved progress.
- Quiz interaction still works with empty, malformed, or unavailable storage.

## Verification on November 6, 2026

This bug predates [PR #227](https://github.com/mrojas54/wids-nyc-reading-group-assistant/pull/227).
The same eight tests were run against its base commit,
`39ed0da851660b2ab831fd01f3d72bfa62857a43`, using the same locked dependencies.
All five saved-state cases failed with hydration mismatches; the three storage
fallback cases passed. All eight pass with this fix.

The final local checks passed: 521 web tests (one optional parity test skipped),
576 Python tests, ESLint, TypeScript, Ruff, ty, the production build, and the
dependency audit gate. The build used placeholder Supabase settings; it did not
connect to the live database.

A temporary local Next.js page rendered the real dashboard, lens dropdown, and
assessment with synthetic paper-40 data. After seeding a submitted answer,
Expert lens, and one hint marker on the localhost origin, a full reload restored
all three. The browser recorded no errors or warnings for that check. The
temporary route was removed before the final build and is not part of the PR.

This verifies the hydration fix locally. Production needs a separate read-only
check after the fix is merged and deployed; this work did not change production
data or the production deployment.
