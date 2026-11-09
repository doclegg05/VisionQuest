# Consolidated plan execution: 2026-11-09

Britt approved the consolidated remaining-work plan ("implement full plan"). Recorded as D1 approval of W3 and W4 as bounded, and of the W5 spike only (`docs/decisions/engineering-log.md`). D2 to D8 keep their plan defaults, so W6 and W7 built nothing.

## Built (local branches from main `a6157fc7`, not pushed)

| Branch | Plan item | Head |
| --- | --- | --- |
| `docs/consolidated-remaining-work` | Plan, 18 retirement notices, ops checklist, W3 inventory, W5 spike | see `git log` |
| `fix/credly-account-cache` | W3a | `fb5e414f` |
| `design/spokes-student-sweep` | W2, SPOKES PR 2 | `257fdf4d` |
| `design/spokes-remaining-sweep` | W2, SPOKES PR 3 (stacked on PR 2) | `1cfe7a98` |
| `design/spokes-polish` | W2, SPOKES PR 4 (stacked on PR 3) | `ba5b0f02` |
| `feat/durable-job-preferences` | W4 (migration `20261109120000_durable_job_preferences`) | `ebb8d1b6` |

Each task had a task review and fix rounds; two final reviews on the most capable model found one Critical (W4's `rls-coverage` gate, fixed to 1.000) and one Important (sticky-note gloss in dark, fixed). Every pair of branches merges cleanly (`git merge-tree`).

## Not done here

- Push, PRs and CI: the session sandbox blocks `git push` and `gh`. The push script and PR bodies were left in the session scratchpad; regenerate bodies from the branch commits if that is gone.
- W0, W1, W9 production checks: `docs/audits/2026-11-09-ops-evidence-checklist.md`, every row "not run".
- SPOKES screenshot review: needs the `spokes-visual` CI artifact after push.
- W4 never ran against a database: its RLS cases in `src/lib/rls.test.ts` run first in CI.

## Where we left off

Next: Britt pushes the six branches, CI runs, Britt reviews SPOKES screenshots, then merges PR 2, 3, 4 in order and the other three in any order. Follow-ups from the reviews are in the Open Items entry for this date.

Local test runs in this sandbox use `node --import tsx --test` (the tsx CLI is blocked) and need `PRISMA_QUERY_ENGINE_LIBRARY` pointed at the cached engine; harness auto-memory has the detail.
