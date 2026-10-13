# Paper Pal production smoke

The Next.js host rewrites only `/functions/v1/analyze-hint` and
`/functions/v1/analyze-socratic` to `NEXT_PUBLIC_SUPABASE_URL` at build time.
Requests retain the signed-in member's Authorization header; Supabase remains
responsible for JWT validation and the paper attendance/leader/operator gate.
No service-role credential is added to browser requests. Rebuild after changing
the Supabase URL. `analyze-paper` continues to use its existing streaming path.

Meeting labels in the inbox and companion use `America/New_York` with explicit
EDT/EST labels. October 28, 2026 at 23:00 UTC must display 7:00 PM EDT; a winter
meeting at 00:00 UTC must display 7:00 PM EST on the previous calendar day.

After deployment and promotion, verify on the canonical production domain:

1. Sign in as an authorized member and open an existing companion.
2. Select a multiple-choice answer and request Ask AI. Confirm a hint appears.
3. Submit a substantive Socratic response. Confirm a live follow-up appears
   without the scripted-fallback warning.
4. Confirm the inbox and companion show the same Eastern meeting time.
5. Record the deployment, commit, tested account role, and any errors. A green
   build alone does not prove provider credentials or member access work.

Local validation for the routing/timezone repair: web suite 445 passed / one
skipped before two additional configuration cases; lint and TypeScript pass.
Regression fixtures cover EDT, EST, the UTC day boundary, narrow endpoint
routing, absent configuration, and a trailing slash in the Supabase URL.
