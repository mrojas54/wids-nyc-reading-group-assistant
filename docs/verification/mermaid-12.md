# Mermaid 12 verification — 2026-09-26

**Approved for the tested desktop/mobile browser matrix below.** Mermaid
12.0.0 uses Dagre/classic and the existing WiDS base theme. The scoped
Chevrotain override resolves lodash-es to 4.18.1. The production-built portal
preserves diagram content and renders labels at their intended size, with
horizontal scrolling for wide diagrams.

This is a browser/rendering approval for the tested fixtures, not a blanket
claim about every browser version, every generated diagram, or production
Supabase data. No production deployment or database change was performed.

## Dependency and portal gates

| Check | Result |
| --- | --- |
| Clean install (`npm ci`) | Passed using Node 22.22.3 / npm 10.9.8 |
| `npm ls lodash-es chevrotain --all` | All affected paths resolve to lodash-es 4.18.1; no invalid dependencies |
| Full-tree `npm audit` | 0 vulnerabilities, including development dependencies |
| `npm run lint` | Passed |
| `npm run typecheck` | Passed |
| `npm test` | 39 files passed, 332 tests passed; one SPECTER2 parity test skipped |
| `npm run build` | Passed; production bundle used for browser tests |

The skipped SPECTER2 test requires private model credentials and is a separate
scheduled integration check, unrelated to Mermaid. The build still emits
Next.js Edge Runtime warnings for `process.cwd` inside Next's own internals;
the test runner emits Node localStorage experimental warnings. Neither was
suppressed or converted into a pass. There were no failed portal checks.

Run all npm commands from `web/`. The build and browser tests used synthetic
Supabase settings pointing to a loopback-only stub, not live credentials.

## Browser matrix and appearance

| Engine | Desktop | Narrow viewport | Result |
| --- | --- | --- | --- |
| Chromium 151.0.7922.34 | 1280 × 1000 | 390 × 844 | Passed |
| Firefox 153.0 | 1280 × 1000 | 390 × 844 | Passed |
| Playwright WebKit 26.5 | 1280 × 1000 | 390 × 844 | Passed |

The matrix exercises 17 flowcharts per browser/viewport (102 renders): the
15 existing diagrams on `/papers/test`, `/papers/2`, and `/papers/6`, plus the
exact Mermaid fence in `docs/availability-reminder-flow.md` and a synthetic
five-node fixture containing tier1, tier2, tier3, accent, and ghost classes.
The last two were injected through a temporary local paper-content fixture
and removed after verification. Rendering used the real Next.js production
bundle, React component, CSS, dynamic Mermaid import, and classDef injection.

Acceptance checks passed:

- No browser page errors, Mermaid fallback panels, missing diagrams, or page
  horizontal overflow in any of the 24 page/browser/viewport cases.
- Node counts, edge counts, and node/subgraph label text matched current main
  (`287c5f0c5ad6d93f5c401c39cf72f6f35c8f44fa`, Mermaid 11.17.2).
- Every diagram rendered at intrinsic scale (minimum measured ratio 0.99998,
  allowing fractional CSS-pixel rounding), preserving the 14px text sizing.
- In all six browser/viewport combinations, both representative fixtures
  scrolled to their exact horizontal endpoint and exposed the rightmost edge.
- Visual inspection confirmed readable sage/paper colors, white accent text,
  tier differentiation, arrows, labels, and accessible left/right content in
  the captured representative and tier screenshots. New line wrapping and
  geometry are accepted; pixel identity with v11 is not required.

The initial browser run revealed a **pre-existing** defect: v11 and v12 both
shrunk most portal SVGs to about 300px wide. On the 23-node reminder flow,
labels became too small to read. The renderer now disables `flowchart.useMaxWidth`,
and the frame preserves intrinsic width with non-shrinking, auto-centered
content. Oversized diagrams start at the left edge and scroll; small diagrams
remain centered. This implements the existing CSS comment's stated behavior.

## Regression evidence

Two RED/GREEN cycles were observed before implementation:

1. Real Mermaid configuration resolution returned `layout: elk`; the new
   component test required the portal's Dagre contract. Explicit Dagre/classic
   settings made it pass.
2. Real configuration returned `flowchart.useMaxWidth: true`; the expanded test
   required intrinsic sizing. The renderer and CSS fix passed the repeated
   full portal checks and the browser matrix.

The component test uses real Mermaid initialization and config resolution;
only SVG layout is stubbed because jsdom does not implement SVG text metrics.
Actual layout, styling and scrolling were verified separately in browsers.

## Remaining limits

- WebKit 26.5 is not Safari 17.4 or a physical iPhone. Old Safari, real mobile
  hardware, and touch/keyboard interaction were not certified. Mermaid 12's
  upstream floor remains ES2024 / Safari 17.4+ / Node 22.12+.
- The matrix covers the committed flowcharts and representative fixtures,
  not every live/generated Paper Pal payload or non-flowchart diagram type.
- An npm audit pass establishes the dependency-graph result; exploit
  reachability and prebundled-code exposure were not independently audited.
- Graph counts and label comparisons are smoke checks, not a proof of all
  diagram semantics. Layout wrapping differs from v11 and was reviewed as a
  visible migration change.

## Why the override is scoped

Mermaid 12 depends on Chevrotain 11.1.2, whose lodash-es pins are affected by
[GHSA-r5fr-rjxr-66jc](https://github.com/advisories/GHSA-r5fr-rjxr-66jc) and
[GHSA-f23m-r3pf-42rh](https://github.com/advisories/GHSA-f23m-r3pf-42rh).
Both are patched in lodash-es 4.18.0; 4.18.1 already exists elsewhere in this
lockfile. The override changes only the Chevrotain subtree and avoids npm's
suggested forced downgrade to Mermaid 11.17.2.

Remove the override when Mermaid's resolved parser dependencies no longer pin
vulnerable lodash-es, and verify a clean install, full audit and browser checks
before removal. `npm install` and a targeted `npm update lodash-es` retained
stale nested pins in the existing PR lock on npm 10.9.8. Regenerating the
Mermaid dependency delta from current main produced the correct scoped lock;
`npm ci` and `npm ls` then verified all three paths used 4.18.1.

Upstream compatibility changes: [Mermaid 12 release notes](https://github.com/mermaid-js/mermaid/releases/tag/mermaid%4012.0.0).
