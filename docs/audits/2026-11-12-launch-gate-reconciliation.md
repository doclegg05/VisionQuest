# Launch gate reconciliation — November 12, 2026

Scope: the remaining Launch rows in the
[deployment readiness plan](../plans/2026-11-10-deployment-readiness.md).
This records evidence and remaining work; it does not authorize real-student
entry, demo deletion, a production restore, or a deployment.

## Completed in this change

| Gate | Result and evidence |
| --- | --- |
| B3 | Empty staff roster offers three steps linked to Classes. New classes preselect the creating instructor and a sole region. Password help uses the shared minimum. Admin labels and region guidance use the actual viewer role. Placement includes instructors with classes but no region. Coordinator choices survive a fresh load after removing the last assignment. Class refreshes retain the form DOM; saving controls retain keyboard focus while blocking repeat activation. Unit tests pass; CI also checks focus and scroll after create/save. |
| C9 | Reconciled with C11, which already supplies audit and conflict protection. Its gate now runs the existing alert route and undo conflict tests. No duplicate implementation. |
| H3 | Public health adds only Sage's connection flag and check time. Local discovery requires the pinned model; relay mode checks its connected agent. Cloud discovery checks the configured model with the platform key. No prompt or student data is sent. A five-minute observed outage raises one alarm until recovery. Staff home shows an actionable outage notice, and a scheduled uptime workflow fails for an absent/false flag. Tests cover healthy, disconnected, unknown, alarm/recovery, local/cloud discovery, and refusal of an unapproved origin. |
| H6 / R10 | Britt approved the existing Sage notice wording in this thread on November 12. Recorded in the operations checklist. |
| H8 | [Incident basics](../runbooks/incident-basics.md) drafted and explicitly approved by Britt in this thread on November 12. Its gate reads that approval from the checklist. |

H3's flag proves connection/discovery, not successful inference, response time,
answer quality, or classroom capacity. Alarm delivery still needs an actual
recipient test in O-6. A Sage outage leaves the database health response at 200
so Render does not restart an otherwise working app; the uptime workflow checks
the separate Sage flag and fails independently.

## CI evidence still required on this head

T6 has a controlled removal script in the existing hermetic E2E job. It first
builds and passes the first-day browser test. It then removes each of the
password, notice, and recovery gates separately, rebuilds, and requires exactly
one browser-test failure at that gate with the expected next URL. An arbitrary
failure is insufficient. It restores sources in `finally` and uploads
`first-day-gate-proof/proof.json` with the tested commit and three detections.
The script refuses non-CI execution and any non-local/non-E2E database URL.
This supplies repeatable evidence for the plan's one-time removal exercise;
it is not counted as passed until that CI step succeeds.

H10's existing closeout integration test also requires CI Postgres. A green
test is evidence for the kit, not authorization to run it on production.

## Remaining production gates

The November 12 live measurements are **M4: 322.2 KB** compressed sign-in assets
(target 235 KB) and **M7: 568 ms** database health latency (target 60 ms).
These measure the currently deployed app. The pending PR has not been deployed,
so its local checks cannot close these production gates. Keep both targets.
After an authorized release, rerun `npm run readiness -- --only=M4,M7 --no-write`.
If either still fails, profile the deployed assets or database path before
changing code or infrastructure. Database-region alignment is O-8 owner work.

Local source metrics pass: M1 is 79 estimated dashboard round trips (target 85),
M2 is 7.1 idle statements/minute (target 8), and M5 is 9.5 MB (target 10).
The previously approved ten-minute F2 cache decision remains in force; these
figures do not establish deployed performance.

E0 remains open: record cold/warm time to first text on the actual host with
1, 5, and 15 simultaneous students, then answer R11. Synthetic provider evals
and connection discovery do not substitute for this acceptance test.

## Owner evidence remains open

The [operations checklist](2026-11-09-ops-evidence-checklist.md) is authoritative.
Its Launch owner rows remain unverified:

- O-1: deployment regions, connection mode, deploy-on-merge and rollback facts.
- O-2: the program's legal/privacy decisions.
- O-3: backup/export arrangements and a restore drill.
- O-4: actual-host configuration, routing/fence behavior and model acceptance.
- O-5: registered cron jobs and successful recent runs.
- O-6: Render build/settings, mail and Sentry configuration, and actual alert delivery.
- O-7: the ordered demo closeout, backup, approved application of the kit and zero-row confirmation. The W9 demo window ends after December 18; do not silently advance it.
- O-8: app/database region alignment and production latency.
- O-10: sign-in and required-document access on actual iPhone and Android devices.
- O-12: the deployed 15-person classroom rehearsal and cleanup of fictional accounts.

Notice approval closes only its O-9 subrow. Retention numbers and the staff MFA
policy remain unapproved. Existing source-plan labels such as `pass` describe
the reviewed proposal; they do not replace the scorecard or dated live evidence.

## Local validation

Production build and TypeScript check pass. ESLint reports zero errors and seven
existing warnings. The full unit runner reports 11,219 passed, zero failures and
two skipped tests; database-only suites remain conditional on CI. The readiness
runner tests pass 87/87. Focused scorecard checks pass B3 (101), C9 (27), H3 (16),
H6 (99) and the H8 owner approval. Browser focus/scroll and controlled-removal
evidence still await CI on the pushed commit.
