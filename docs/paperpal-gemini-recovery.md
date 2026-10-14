# Paper Pal Gemini recovery

October 14, 2026: the production hint function returned Gemini 404 for `gemini-2.5-flash`. The replacement for hint and tutor calls is `gemini-3.8-flash`.

Local verification: 448 web tests passed, one skipped; ESLint and TypeScript passed. The regression test exercises both provider entry points and reproduces the old model's 404 before the fix.
