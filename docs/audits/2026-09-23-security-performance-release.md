# Security/performance release preparation — 2026-09-23

## Release base and preserved work

The initial ten-agent sweep was run in the owner's dirty `codex/Supabasedesign`
checkout. Before release, fetching `origin/main` revealed 429 commits exclusive to
main and 40 exclusive to that branch. The branch must **not** be deployed wholesale:
it lacks newer privacy, SMS policy, Connect, benchmark, and operational changes.

This release is a fresh branch from main `925b2dfa839aa3bdc136a76b6ef9af15d31943fd`,
`fix/security-performance-release-2026-09-23`, in the sibling
`VisionQuest-security-release` worktree. A baseline captured before the sweep was
used to extract only the sweep delta. Three scoped port reviews resolved overlaps
against current main; a separate read-only review checked the release result.
The original checkout and its unrelated intake/retrieval/schema/prototype work
remain untouched by the port.

### Included

- Authentication hash handling, conditional password rehash/MFA changes, cookie
  cleanup, canonical staff target authorization, reset-token/session revocation.
- Proxy file-suffix bypass and Origin precedence fixes, preserving main's signed
  SMS webhook exemption and crawler protections.
- Storage path/content-signature/download defenses, preserving main's filename
  sanitizer and existing file-ownership checks.
- Sage source/target authorization and audit privacy; current Connect/work-profile
  behavior and latest rights/responsibilities grounding are retained.
- Cache miss coalescing/invalidation fencing and instructor metrics batching;
  AI stream cleanup/body deadlines and parallel independent retrieval reads.
- Serial client polling and portfolio `_count`; main's existing public credential
  privacy/noindex protections remain intact.
- Webhook connection-time DNS validation and bounded egress; SSE/job/report
  resource limits; durable notification overflow. Notification retry delivery
  rechecks current account/preferences and uses current main's `sendPolicySms`,
  not the older direct SMS sender. Transactional email jobs remain distinct.
- Compatible dependency patches including the tested Prisma/deepmerge override;
  build tracing/Docker improvements. Benchmark runtime configs/results are
  explicitly staged rather than implicitly tracing the whole repository.
- Restrictive Student DELETE policy migration with full migrated-database RLS
  coverage, not only a stub-policy check.
- Cron Health no longer exits successfully without its required secret.

### Intentionally not imported

- The old branch's intake feature, cohort ZIP-export route, and development login
  do not exist on current main. Their sweep fixes stay in the original checkout;
  introducing those features is not part of this release.
- Pre-existing schema/retrieval edits and their migrations are not reintroduced
  from the dirty checkout. Current main's existing migrations remain authoritative.
- Existing main privacy fixes are retained, not overwritten with older versions.

## Operational facts checked

- GitHub API confirms PR #187 merged September 3 at `c583189`; the prior sweep's
  old-branch memory saying it was unmerged was stale.
- Current main's runbook has a fallback production URL and does not require the
  unavailable `ALTER DATABASE ... app.base_url` operation.
- Current main's memory records that the operator expired the historical backlog
  on September 4 (0 pending / 189 failed then). This is a historical record, not a
  current aggregate query; do not repeat expiration or dispatch stale jobs.
- Latest observed Cron Health run, [35858856215](https://github.com/doclegg05/VisionQuest/actions/runs/35858856215),
  reported success on September 23 but its log explicitly says the check **did
  not run** because `CRON_CHECK_DATABASE_URL` is missing. Repository secret-name
  inspection confirms it is absent. This release changes that branch to an error
  and exit 2, with a regression test, so missing monitoring cannot look healthy.
- Public `GET https://visionquest.onrender.com/api/health` returned HTTP 200 with
  `healthy`, DB connected and schema ready. This does not establish deployed SHA,
  migration ledger contents, scheduled-job freshness or actual notification delivery.
- `GEMINI_EVAL_BUDGET_OK` was not found among repository variables. Current Sage
  workflows deliberately skip paid model-backed evals unless it is `1`; a green
  workflow with those skips is not live model-release evidence. No budget flag
  was enabled or billing assumption made.
- No Render/Supabase deployment credentials or production DB connection were
  available in the execution environment. No production migration, backlog drain,
  job dispatch, secret rotation, or database configuration change was performed.

## Verification

Final release verification on the new main-based branch:

| Gate | Result |
| --- | --- |
| `npm test` with CI-style fake DB URLs and strict RLS context | **6,176 passed, 0 failed** |
| Real isolated PostgreSQL/pgvector RLS integration | **254 passed, 0 failed** |
| Benchmark runner / scorer unit suites | **115 / 253 passed** |
| Production build and TypeScript | Passed |
| ESLint | 0 errors; 2 existing auth-navigation warnings |
| API auth audit | 218 routes / 312 handlers; 0 warnings / footguns |
| npm dependency audit | 0 vulnerabilities |
| Pipeline, platform, benchmark configuration, catalog (no-DB), readability gates | Passed |
| Independent focused release review | No concrete must-fix defect; 156 focused tests passed |
| Standalone artifact inspection | No `.env*` files; whole-project trace warnings eliminated |

The original sweep's 3,568-test result is not reused as proof for this
substantially newer base. Local evidence logs are in `/tmp/visionquest-release/`.
Remote CI and live operational gates are separate from these local results.

Already independently exercised: all migrations, including
`20260923130000_restrict_student_delete_policy`, applied successfully to a temporary
local PostgreSQL 17 + pgvector database; **254/254 real RLS integration tests passed**.
The cluster was stopped afterward. No configured application database was used.

## Required release gates

1. Configure `CRON_CHECK_DATABASE_URL` through GitHub's encrypted Actions secrets,
   using the correct production scheduling-role connection supplied by the owner.
   Never paste it into an issue, PR, report or chat.
2. Run the read-only Cron Health workflow and inspect its actual report (eight
   expected jobs, including Connect nudges), not just the workflow badge. Inspect
   recent HTTP success/freshness as well as SQL-run status; historical/absent HTTP
   evidence is not proof of delivery.
3. Confirm live Render environment/deployed revision and production migration
   readiness through authorized operator access. Do not infer these from the
   checked-in blueprint or public health response.
4. Confirm the funded Gemini evaluation budget and enable `GEMINI_EVAL_BUDGET_OK=1`
   through the existing operator procedure before claiming model-backed evals
   passed. Re-run those checks; do not lower floors or treat budget skips as passes.
5. Once required CI/review and operational gates pass, merge through normal branch
   protection. Render's normal start applies the restrictive DELETE migration via
   Prisma; do not bypass the migration ledger using ad-hoc production SQL.
6. Verify the deployed SHA, migration completion, public health, and current job
   processor results. Do not activate or drain an unexpected backlog without an
   explicit disposition decision.
