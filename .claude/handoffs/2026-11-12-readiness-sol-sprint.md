# Deployment readiness, wave 1 and the Sol review sprint: 2026-11-12

Britt asked for a review of what VisionQuest needs before real students and instructors, approved the readiness plan (`docs/plans/2026-11-10-deployment-readiness.md`), then asked for a sprint on the findings of Sol's (GPT) review of the integration branch. Every task ran build, then up to three review rounds; a task still not clean after round 3 is parked for Britt.

## Where the work is

All of it is PR #300 (https://github.com/doclegg05/VisionQuest/pull/300), branch `wave1/integration`, worktree `t3-f5f461cb-c3e79499a0a88764`. Nothing is merged to `main`. The decision trail is `decisions.tsv` (one row per decision, with evidence). The scorecard is `node scripts/readiness/scorecard.mjs`; CI-only gates count with `--ci-green=<run URL>`.

Every PR check is green at `dd61c17c` (CI run 43267766862), the Sage evals included, on Britt's topped-up OpenRouter key. Scorecard with `--ci-green` on that run: Launch tasks 39 of 40 (E0 owner-open), launch metrics 3 of 5 (M4 322.2 KB, M7 935 ms, both live and waiting on a release), owner rows 0 of 12.

Later the same day (Codex/Sol session): CI's first runs found and fixed a real closeout bug (`left(text, bigint)`) plus test-only failures under CI's strict RLS mode; Sol then built B3, H3 and the T6 gate-removal proof, reconciled C9 into C11, and recorded Britt's approval of the H6 notice wording and the H8 incident runbook. Its record is `docs/audits/2026-11-12-launch-gate-reconciliation.md`.

## Ready (reviewed clean, or fixed after the last review)

| Task | What it does |
| --- | --- |
| E1, E2, E6, E9 | Chat failures say what happened, the wait has words and a Stop, "Sage is an AI and can be wrong", and a stalled chat always offers a way out. The 988 help shows on every failure, Stop and timeout for students (never for staff). Stop cancels the model call. |
| F1 | Password hashing off the event loop; a 60 second session cache cleared by every session-ending write. |
| F2 | Dashboard read diet: M1 79 round trips (target 85), M2 7.1 statements a minute (target 8). Needs Britt's sign-off on the 10 minute cache (see below). |
| A6 | Sign-in limits count the address Render's proxy adds (2 trusted hops, IPv6 by /64). Needs one owner check after deploy (DEPLOY.md, "Check the sign-in limits' client address"). |
| H15 | Every staff read of one student's record writes a view row; 33 routes classified by a route walk; no names or logins in audit summaries or archive keys. |
| H10 | Demo closeout tool, fourth round approved by the sprint. Gate is `needs-ci`: the Postgres test has never run. |
| C11 | Alert actions and Undo never overwrite a newer decision; the alert sync keeps a teacher's dismiss. Its Postgres test runs first in CI. |
| T6 | First-day browser test, needs its first CI run and the by-hand gate removal. |

## Decisions waiting on Britt

- Settled 2026-11-12: the H6 notice wording and the H8 incident runbook (approved), F2's 10 minute cache and keeping the typed login out of failed sign-in summaries (accepted).
- Merging #300 (with a merge commit) and releasing it.
- Audit rows now hold the full client IP, and audit retention is proposed at 7 years.
- Whether coordinators may save a personal AI key; whether the browser should show 988 on a dropped connection before the first stream event.
- The parked tasks C1, B1, C3, which hold four more tasks.
- The 12 owner evidence groups (restore test, model capacity, phones, classroom rehearsal and the rest).

## Known limits

- Local full-suite runs in this sandbox can silently drop whole test files under load; totals wobble. CI is authoritative. A manifest script that proves every file reported is owed.
- Postgres-backed tests (H10, C11, RLS) have never run here; this Mac has no local Postgres.
- M3 (round trips before the first word) stays a pilot gap at 190 against 12.

## Where we left off

Next: Britt's word to merge #300 with a merge commit (a squash re-creates the 44-file conflict #299 caused), then a release. After deploy: rerun `npm run readiness -- --only=M4,M7 --no-write`, run DEPLOY.md's sign-in client-address check, and work the owner rows (E0 host timing; O-1 to O-12 in `docs/audits/2026-11-09-ops-evidence-checklist.md`). The H6 notice and H8 runbook are approved; F2's 10-minute cache and the login kept out of failed sign-in summaries were accepted on Britt's "go with your recommendations". Still Britt's: retention numbers, staff MFA policy, the coordinator AI key, 988 on a pre-first-event drop, and the parked C1, B1 and C3.
