# `docs/superpowers/` — historical design specs, plans and runbooks

**Everything under this directory is a dated snapshot, not current guidance.**

These are the design specs (`specs/`), implementation plans (`plans/`) and
one-off runbooks (`runbooks/`) that were written *before* each feature was
built, in the workflow the superpowers plugin drives: brainstorm → spec → plan
→ implement. They are kept because they record *why* something was built the
way it was, and the top-level [README](../../README.md) links each feature's
spec and plan for that reason.

They are **not** kept up to date after implementation. A plan can describe
tasks that were later dropped, env vars or flags that were renamed, and
commands that no longer exist. Where a plan and the code disagree, the code
is right. Where a plan and a current doc disagree, the current doc is right:

| For … | Read … |
|---|---|
| how to operate a feature today | `docs/runbooks/` and the per-feature docs in `docs/` |
| what a scheduled task does | `scheduled_tasks/` |
| how a script is invoked | the script's own module docstring |
| the current web setup and gates | `web/README.md` and `.github/workflows/` |

Concrete hazard this banner exists for: searching the repo for a flag such as
`RUN_PARITY` surfaces a 2026-05 plan next to the live test, and the plan reads
like current guidance. It is not. The date in each filename is the date the
document stopped being maintained.
