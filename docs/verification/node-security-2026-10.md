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
  The initial runtime commit changed only root engine metadata in the lockfile.
  The follow-up below also resolves the dependency audit failures.

## Initial runtime validation

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

## Dependency audit remediation

The first PR CI run confirmed **5 high and 1 critical** affected packages in
`@vercel/blob`, `@vercel/cli-config`, `@vercel/oidc`, `dompurify`, `undici`,
and nested `zod`. Node's bundled Undici update does not patch npm copies.
The follow-up keeps all direct dependency ranges and applies only:

- DOMPurify 3.4.16 → 3.4.17.
- Undici 6.29.0 → 6.29.1 and jsdom's copy 7.30.0 → 7.30.1.
- A scoped `@vercel/cli-config` override, `"zod": "$zod"`, resolving its
  fixed 4.1.11 dependency to the app's existing patched 4.6.7. Even the newest
  cli-config package still declares 4.1.11, so a parent update alone is insufficient.

The audit gate now reports no high or critical findings. `npm ls zod --all`
confirms the nested vulnerable copy is gone. Four synthetic schema checks
verify valid global/auth settings, passthrough keys, and rejection of invalid
boolean/expiration/token-source fields with the overridden Zod. They do not
read real Vercel configuration or credentials. No audit exception was added.

The baseline's GitHub web, CLI smoke, Python, Deno and SQL checks were successful:
[CI run](https://github.com/mrojas54/wids-nyc-reading-group-assistant/actions/runs/39756802235).
Its Vercel status was successful too. Those historical results do not validate
this patch. Obtain fresh PR CI and
preview-build results before merging.

## Deployment boundary

The portal uses Vercel with root directory `web`, not Render. Vercel selects a
major and manages patch rollouts; package engines can override its dashboard
selection. Follow [web runtime verification steps](../../web/README.md#nodejs-security-updates)
to establish both build and actual function runtime versions. No production
runtime version, infrastructure setting or credential was changed or verified.
Merging to `main` automatically deploys, so merge/deployment approval is separate
from publishing a review branch or draft PR.
