# Paper Pal preview browser checks

The Vercel preview exposes `/preview/paperpal?run=123&mode=quiz` for manual storage
checks without a member session. Use the same URL in two tabs. Change `run` to a
new number (1–10 digits) for a fresh fixture; storage from earlier runs is retained.
The page displays the deployment commit so results can be tied to the tested code.

The harness renders the real `McqMode` and `SocraticMode` components, with their
normal storage, reducers, and hydration behavior. Only the hint/tutor service
functions are replaced. Replies are generated in the browser; no auth lookup,
HTTP request, provider call, or database operation is made. Holding a mock reply
tests storage ordering, not the transport deadline in #229.

## Isolation

- Both proxy and page require `VERCEL_ENV=preview` and an exact Host match against
  the deployment's `VERCEL_URL` or `VERCEL_BRANCH_URL` ending in `.vercel.app`.
  Missing values, production/development environments, and other hosts return 404.
  Production aliases stay blocked if a preview artifact is promoted.
- The response sets `connect-src 'none'` to block fetch, XHR, WebSocket, and beacon
  connections, including same-origin function rewrites. Forms and frames are
  blocked too. The page uses full navigations instead of Next prefetch links.
- Portal performance telemetry is omitted on this route. The response is
  uncached and marked `noindex, nofollow`.
- Synthetic paper IDs are negative and namespaced by run. Fixture progress is
  saved only in this preview origin's localStorage; real member progress is not
  loaded or cleared. The mock controls belong to each tab and reset on reload.
- No service worker or global fetch override is installed. Normal paper pages
  continue using the existing authenticated services and request deadlines.

## Browser sequences

1. **Quiz:** In A, select “Code and execution traces” for Q1 and submit. In B,
   select Q2, choose “The harness code,” and submit. Fully reload both tabs.
   Check for a 2/2 score and saved correct feedback for both questions.
2. **Tutor race:** Open `mode=tutor` in both tabs with the same fresh run. In A,
   enable “Hold mock replies in this tab” and send a distinct message. In B,
   send a different message, wait for its mock reply, and choose “I've got it.”
   Back in A, release the pending reply. Fully reload both tabs and verify both
   learner messages, both matching replies, the synthesis, and disabled Send.
3. **Pending reload:** Use another fresh run. Hold a reply, send a message, and
   fully reload before releasing it. The learner message must remain with “No
   reply saved.” Send a new message and check that the tutor can respond again.

Inspect both consoles for React #418 and save screenshots of the reloaded views.
These checks establish preview UI/storage behavior with mocked services. They do
not test live auth, provider responses, server-side deadlines, billing after
cancellation, or production data writes.

## Automated checks

From `web/`:

```sh
npm test -- app/preview/paperpal/__tests__ lib/paperpal/__tests__/preview-guard.test.ts
npm run lint
npm run typecheck
npm run build
```

The harness tests fail on any auth or fetch call. Guard tests cover production,
development, missing environment values, production aliases, and both permitted
preview hosts. Page tests check the guard independently of proxy. A local built
app was also checked over HTTP: production returned 404, preview returned 200
with the connection-blocking policy, and an unrelated host returned 404.
