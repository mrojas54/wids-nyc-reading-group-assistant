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
