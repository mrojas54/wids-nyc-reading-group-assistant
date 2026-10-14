# Paper Pal Gemini recovery

October 14, 2026: the production hint function returned Gemini 404 for `gemini-2.5-flash`. The replacement for hint and tutor calls is `gemini-3.8-flash`.

Local verification: 448 web tests passed, one skipped; ESLint and TypeScript passed. The regression test exercises both provider entry points and reproduces the old model's 404 before the fix.

Deploy the `providers/gemini.ts` model replacement in both `analyze-hint` and `analyze-socratic` Supabase function bundles. A Vercel deployment alone does not publish Edge Functions. Preserve each deployed bundle's other code. Confirm live hints and a fresh tutor turn on the canonical production domain, without a fallback warning, before closing the recovery task.

Supported model reference: https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash
