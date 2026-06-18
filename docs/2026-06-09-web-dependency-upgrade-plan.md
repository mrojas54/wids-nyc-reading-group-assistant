# Web Dependency Upgrade Plan

**Created:** 2026-06-09
**Scope:** `web/` (Next.js member portal)
**Status:** Completed for TypeScript, Vite, and Tailwind; ESLint 10 remains blocked on upstream plugin support.

## Summary

Web dependencies were clean (zero known vulnerabilities) but aging. The June
2026 upgrade pass moved TypeScript, Vite, and Tailwind to their current majors
and documented why ESLint stays on 9.x for now. This remains upgrade-debt
tracking, not a security issue.

Original snapshot taken from [`web/package.json`](../web/package.json) on
2026-06-09; current package state is the same file plus
[`web/postcss.config.mjs`](../web/postcss.config.mjs) and
[`web/app/globals.css`](../web/app/globals.css) for Tailwind v4 config.

## Upgrade status

| Package | Current | Latest major | Status | Notes |
|---|---|---|---|---|
| `typescript` | `^6` | 6.x | Done | Version bump only; no source changes required. |
| `vite` + `vitest` | `vite ^8`, `vitest ^4.1.8` | vite 8.x | Done | **Test-only** — the app builds with `next build --webpack`, so Vite never touches the production bundle. `@vitejs/plugin-react` moved to `^6` with Vite. |
| `eslint` | `^9` | 10.x | Blocked | Gated by the plugin versions bundled by `eslint-config-next` (pinned `16.2.6`), chiefly `eslint-plugin-react` / `eslint-plugin-import` / `eslint-plugin-jsx-a11y`. |
| `tailwindcss` | `^4.3.0` | 4.x | Done | Migrated to Tailwind v4's CSS-first model: `@tailwindcss/postcss`, `@import 'tailwindcss'`, `@theme inline`, and no `tailwind.config.*`. |

For reference, the app-facing stack is current: `next` 16.2.6,
`react`/`react-dom` 19, `zod` 4, `@supabase/*` current. Remaining debt is
concentrated in lint tooling until the Next-bundled ESLint plugins support
ESLint 10.

## Recommended sequencing (safest first)

Each step is an independent branch + PR. Stop and re-run the gates
(`npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`) after
each before moving on.

1. **TypeScript 5 → 6.** ✅ **Done 2026-06-09** — `5.9.3` → `6.0.3` (spec
   `^5` → `^6`). Verified `typescript-estree@8.59.4` peer ceiling is
   `<6.1.0`, so the bundled `typescript-eslint` officially supports 6.0.x
   (no Next/eslint-config-next bump needed). All four gates green:
   `typecheck`, `lint`, `test` (243 passed, 1 skipped), `build`. No source
   changes required — version bump only.
2. **Vite 6 → 8.** ✅ **Done 2026-06-09** — `vite` `6.4.2` → `8.0.16`
   (`^6` → `^8`). The real coupled bump was **not** Vitest: `vitest@4.1.8`
   already declares `vite: ^6 || ^7 || ^8`, so it spans Vite 8 unchanged.
   The package that had to move with Vite was `@vitejs/plugin-react`
   `4.7.0` → `6.0.2` (`^4` → `^6`; v6's required `vite` peer is `^8`, babel
   peers optional). Standard `react()` usage in `vitest.config.ts` needed no
   code change. All four gates green: `typecheck`, `lint`, `test` (243
   passed/1 skipped), `build` (unchanged — Webpack path).
3. **ESLint 9 → 10.** ⛔ **Blocked (verified 2026-06-09)** — held on ESLint
   `9.39.4`. Attempted `eslint@^10` (10.4.1) empirically and reverted.
   Findings:
   - The install does **not** hard-fail — npm emits `ERESOLVE overriding
     peer dependency` (3×) and proceeds. Peer warnings alone are not a block.
   - But `eslint .` **crashes at runtime**:
     `TypeError: ... contextOrFilename.getFilename is not a function` from
     `eslint-plugin-react@7.37.5` (`react/display-name` rule). ESLint 10
     removed the deprecated `context.getFilename()` method; the plugin still
     calls it.
   - The capped plugins — `eslint-plugin-react@7.37.5` (`eslint` peer
     `…|| ^9.7`), `eslint-plugin-import@2.32.0` (`…|| ^9`),
     `eslint-plugin-jsx-a11y@6.10.2` (`…|| ^9`) — are bundled by
     `eslint-config-next`. `typescript-eslint@8.59.4` and
     `eslint-plugin-react-hooks@7.1.1` already allow `^10`.
   - **Bumping Next would NOT unblock this:** the latest
     `eslint-config-next@16.2.9` still pins the same ESLint-9-capped plugin
     versions. The block is upstream in the plugin ecosystem (chiefly
     `eslint-plugin-react`/`eslint-plugin-import` shipping ESLint-10 support).
   - **Recheck trigger:** when `eslint-config-next` (tracking the app's Next
     version) bundles `eslint-plugin-react`/`-import`/`-jsx-a11y` releases
     that declare an `eslint ^10` peer. Until then, stay on ESLint 9
     (currently the `maintenance` dist-tag).
4. **Tailwind 3 → 4.** ✅ **Done 2026-06-12** — `tailwindcss` `^3.4.1` →
   `^4.3.0` with `@tailwindcss/postcss`. The app now has no
   `tailwind.config.*`; theme aliases live in the `@theme inline` block at the
   top of `web/app/globals.css`, followed by the runtime CSS variables. The
   v4 default-border-color compatibility shim is intentionally retained until
   each old implicit border can be made explicit.

## Gotchas captured during triage

- **Vite is not in the app's critical path.** `web` scripts build and serve
  with Webpack (`next dev --webpack` / `next build --webpack`). A Vite major
  bump can only affect the test runner.
- **ESLint is gated by other packages** — specifically the plugin versions
  bundled by `eslint-config-next`. Don't bump ESLint in isolation expecting a
  clean result.
- **Tailwind v4 is CSS-first.** New theme tokens belong in
  `web/app/globals.css` under `@theme inline`; there is no separate
  `tailwind.config.*` to update.
- The `overrides` block (`protobufjs`, `postcss`) exists for transitive
  resolution; re-check it survives each bump.

## Done criteria

- Each package on its current major, or a documented reason it's held back
  (e.g. "ESLint 10 blocked on eslint-config-next").
- All four gates green: `typecheck`, `lint`, `test`, `build`.
- Tailwind: portal visually verified post-migration.
