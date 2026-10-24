# Node.js security runtime update — 2026-10-24

Baseline: `8bc7cd15233161e38ee6fa1385ba1f6bdb6a64ea` on `main`.

The [upstream October 21 advisory](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases)
lists patched releases 22.23.4, 24.22.1 and 26.12.1. The
[22.23.4 release notes](https://nodejs.org/en/blog/release/v22.23.4)
include TLS hostname verification, Brotli, DNS and HTTP fixes, plus bundled
dependency updates. This review does not establish exploitation or compromise.

## Repository changes

- Raise `web/.nvmrc` from 22.22.3 to 22.23.4; its existing consumers include
  primary web CI, scheduled SPECTER2 parity CI and Cursor setup.
- Set package and lockfile root engines to `^22.23.4 || ^24.22.1 || ^26.12.1`.
  This keeps the three supported major lines while rejecting their older,
  unpatched releases and odd-numbered EOL lines. Future majors require review.
- Raise the independent minimum CLI smoke job from 22.12.0 to 22.23.4.
  Preserve both help-command checks, explicit TypeScript flags, all other test
  commands, audit policy, and required status-check names.
- Align current setup documentation and add Vercel runtime verification steps.
  No application dependencies, resolved versions, integrity hashes or overrides
  change; only the lockfile's root engine metadata changes.

## Validation

Local runtime: Node 22.23.4, fresh `npm ci` from the committed dependency graph.

| Check | Result |
| --- | --- |
| `npm ci --no-audit --no-fund` | Pass, 653 packages installed |
| `npm run lint` | Pass |
| `npm run typecheck` | Pass |
| Audit-policy tests | Pass, 10 tests |
| Both CLI `--help` smoke commands | Pass |
| `NEXT_TELEMETRY_DISABLED=1 npm run build` | Pass |
| Engine-range boundary checks | Accept all three patched floors; reject immediately preceding patches, 22.12.0, 22.22.3, 23.x and 25.x |
| Locked dependency engine review | 22.23.4, 24.22.1 and 26.12.1 satisfy all declarations except an existing optional Windows ia32 Sharp binary requiring Node 20; irrelevant to Linux CI/Vercel |
| Dependency graph comparison | Identical after excluding root engine metadata |
| `git diff --check` | Pass |

The ordinary test run was interrupted by automatic approval review over an
attempted Google API request. A safer run disabled real TCP/UDP connections
using a temporary preload outside the repository, and cleared inherited
`NODE_PATH` so runtime-provided packages could not contaminate module resolution.
It completed with **464 passed, 19 failed, 1 skipped** across 56 files.
Failures were confined to `dispatch.test.ts`, `s2-client.test.ts` and
`resolve-helpers.test.ts`; HTTP mocks did not intercept as expected in this
environment. This is incomplete compatibility evidence, not a green full suite.
The inherited `NODE_PATH` also caused an initial glob-override test failure;
that suite passes all four tests with `NODE_PATH` cleared.

An initial build telemetry request was rejected; disabling telemetry allowed
the build to complete. No production credentials were supplied to validation.
Node 24 and 26 received engine-declaration checks, not full runtime test runs.
The credential-dependent SPECTER2 parity test remains skipped locally.

## Outstanding merge gates

Live `npm audit` on the unchanged dependency graph reports **5 high and
1 critical** affected packages: `@vercel/blob`, `@vercel/cli-config`,
`@vercel/oidc`, `dompurify`, `undici`, and nested `zod`.
The existing audit gate fails as intended. Runtime updates do not patch npm
copies of Undici (6.29.0 and 7.30.0 here), DOMPurify (3.4.16), or nested Zod
(4.1.11 under `@vercel/cli-config`). Resolve these in a dependency-focused
change and rerun the gate; do not use the audit tool's suggested Blob downgrade
without reviewing compatibility.

The baseline's GitHub web, CLI smoke, Python, Deno and SQL checks were successful:
[CI run](https://github.com/mrojas54/wids-nyc-reading-group-assistant/actions/runs/39756802235).
Its Vercel status was successful too. Those historical results do not validate
this patch or override the newer live audit findings. Obtain fresh PR CI and
preview-build results before merging.

## Deployment boundary

The portal uses Vercel with root directory `web`, not Render. Vercel selects a
major and manages patch rollouts; package engines can override its dashboard
selection. Follow [web runtime verification steps](../../web/README.md#nodejs-security-updates)
to establish both build and actual function runtime versions. No production
runtime version, infrastructure setting or credential was changed or verified.
Merging to `main` automatically deploys, so merge/deployment approval is separate
from publishing a review branch or draft PR.
