# PR 211 web check

## RED — October 22, 2026

At `cfe4caf6`, the existing CI command, run from `web/` with Node 22.22.3,
reproduces the failure:

```text
node --experimental-strip-types scripts/check-audit.mts
npm audit found unapproved high or critical vulnerabilities:
- vite: high severity finding
```

The lockfile resolves Vite 8.3.2. Advisory
[GHSA-587h-7wmj-h5pm](https://github.com/advisories/GHSA-587h-7wmj-h5pm)
includes that version and identifies 8.3.3 as patched. The audit gate failed
before CI could run lint, type checking, or Vitest.

The existing audit command is the regression check. Keep its policy unchanged;
update only Vite within the existing supported major, then run the web checks.

## GREEN and VERIFY

Updated the Vite requirement and lockfile to 8.3.5, including the Rolldown
dependencies required by that patch release. The audit policy is unchanged.

With Node 22.22.3, after a clean `npm ci`, all commands below passed from `web/`:

- `node --experimental-strip-types --test scripts/check-audit.test.mts`: 10 passed.
- `node --experimental-strip-types scripts/check-audit.mts`: no high or critical findings.
- `npm run lint`.
- `npm run typecheck`.
- `npm test`: 53 files passed, 1 skipped; 448 tests passed, 1 skipped.

`git diff --check` also passed. npm still reports two low-severity findings
in the existing Mermaid/KaTeX dependency chain; those do not fail the CI policy.
The SQL migrations and production systems were not changed by this fix.
GitHub CI must independently verify the pushed commit on its Linux runner.
