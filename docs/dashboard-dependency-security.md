# Dashboard dependency security follow-up

> Resolved in the subsequent approved workflow: a scoped `@prisma/config` override to `deepmerge-ts@8.0.2` passed compatibility, Prisma generation/migration, and local production-build checks. Working dependencies now match the lockfile; the refreshed full npm audit reports zero findings. See `workflow-production-readiness.md` and `workflow-review-followup.md`. The earlier assessment below is retained as history, not current advisory status.

Date: 2026-09-10. Scope: incremental remediation, not a production security certification.

## Changes

Registry audit initially reported 13 dependency findings (1 critical, 9 high, 2 moderate, 1 low). Updated Next.js and eslint-config-next to 16.3.4, Nodemailer to 9.1.1, and existing overrides for sharp to 0.35.4 and fast-uri to 3.1.7. Compatible lockfile updates include xmldom, js-yaml, fflate, humanfs, and tsx/esbuild. Prisma and authentication architecture were not migrated. Installations used `--ignore-scripts`; no database migration or remote database access was performed.

The Next.js advisories were GHSA-p293-qw3h-jr36 and GHSA-2xp9-vwfh-vxw4; sharp GHSA-rgj7-g3m4-5g8c. These were registry findings, not evidence of exploitation of this application.

## Remaining finding (historical; superseded by isolated verification)

Follow-up: `workflow-production-readiness.md` records a scoped `@prisma/config` override to stable `deepmerge-ts@8.0.2`, adopted after bounded compatibility tests, Prisma/migration/RLS verification and a local standalone build. The refreshed audit reports zero findings. Linux parity, complete assets, normal restricted-only login, deployed verification and independent review remain release gates; this does not establish production readiness.


`npm audit --omit=dev` after updates reports 3 high entries representing one dependency chain: `prisma -> @prisma/config -> deepmerge-ts@7.1.5`. Advisory GHSA-ggr8-5vv4-36mx concerns stack exhaustion when merging recursive object graphs. The fix requires deepmerge-ts 8; Prisma 6.19.3 pins 7.1.5. The audit's suggested Prisma downgrade was **not** applied, nor was a cross-major override forced without compatibility verification. Treat this as unresolved. Do not load untrusted Prisma configuration; this does not replace a maintained upstream fix.

No critical, moderate, or low findings remain in that registry scan. This is time-specific and does not prove absence of vulnerabilities. Build tools are currently declared in dependencies, so `--omit=dev` includes them.

## Verification

- TypeScript passed after dependency changes.
- 57 focused dashboard, task/API, auth, security, and next-step tests passed after updates.
- Updated the dashboard page unit test to mock its CSS-module import; real CSS is exercised separately in the browser harness.
- Full production build and live deployment were not performed in this pass.

Related: `dashboard-security-checks.md`, `dashboard-rls-verification.md`, and `dashboard-contrast-checks.md` record independent route, database, and visual checks.
