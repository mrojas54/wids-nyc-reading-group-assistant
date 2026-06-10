# Web Dependency Upgrade Plan

**Created:** 2026-06-09
**Scope:** `web/` (Next.js member portal)
**Status:** Tracked / not yet started — no dependency changes made.

## Summary

Web dependencies are clean (zero known vulnerabilities) but aging. Several
dev-tooling packages are a full major version behind. This is upgrade debt,
not a security issue — nothing here is urgent, but the gap widens with time
and Tailwind in particular gets harder to migrate the longer it waits.

Snapshot taken from [`web/package.json`](../web/package.json) on 2026-06-09.

## What's behind

| Package | Current | Latest major | Risk | Notes |
|---|---|---|---|---|
| `typescript` | `^5` | 6.x | Low–Medium | Mostly stricter checks + removal of deprecated flags. Surfaces as new compile errors, not runtime behavior. |
| `vite` + `vitest` | `vite ^6.0.0`, `vitest ^4.1.8` | vite 8.x | Medium | **Test-only** — the app builds with `next build --webpack`, so Vite never touches the production bundle. Must bump as a pair (Vitest declares the Vite peer range). |
| `eslint` | `^9` | 10.x | Medium | Gated by `eslint-config-next` (pinned `16.2.6`). The lever is the ESLint major that the Next config supports, not ESLint's latest tag. |
| `tailwindcss` | `^3.4.1` | 4.x | **High** | The only genuine migration: new Oxide engine, CSS-first config (`@theme`), `tailwind.config.js` replaced by CSS `@import`. |

For reference, the app-facing stack is already current: `next` 16.2.6,
`react`/`react-dom` 19, `zod` 4, `@supabase/*` current. The debt is
concentrated in build/test/lint tooling.

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
4. **Tailwind 3 → 4.** Treat as a real project, not a version bump:
   - Run the official `@tailwindcss/upgrade` codemod on a branch.
   - Migrate `tailwind.config.js` content to CSS-first `@theme`.
   - Visually verify the portal renders (preview server + screenshot the key
     routes) — utility-class semantics and the default color palette changed
     between 3 and 4.

## Gotchas captured during triage

- **Vite is not in the app's critical path.** `web` scripts build and serve
  with Webpack (`next dev --webpack` / `next build --webpack`). A Vite major
  bump can only affect the test runner.
- **ESLint and Tailwind are both gated by other packages** — ESLint by
  `eslint-config-next`, Tailwind by its own config-model change. Don't bump
  them in isolation expecting a clean result.
- The `overrides` block (`protobufjs`, `postcss`) exists for transitive
  resolution; re-check it survives each bump.

## Done criteria

- Each package on its current major, or a documented reason it's held back
  (e.g. "ESLint 10 blocked on eslint-config-next").
- All four gates green: `typecheck`, `lint`, `test`, `build`.
- Tailwind: portal visually verified post-migration.
