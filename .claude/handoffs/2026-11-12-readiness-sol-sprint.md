# Deployment readiness, wave 1 and the Sol review sprint: 2026-11-12

Britt asked for a review of what VisionQuest needs before real students and instructors, approved the readiness plan (`docs/plans/2026-11-10-deployment-readiness.md`), then asked for a sprint on the findings of Sol's (GPT) review of the integration branch. Every task ran build, then up to three review rounds; a task still not clean after round 3 is parked for Britt.

## Where the work is

All of it is on the local branch `wave1/integration`, in the worktree `t3-f5f461cb-c3e79499a0a88764`. Nothing is pushed and nothing is merged to `main`. The decision trail is `decisions.tsv` in that worktree (one row per decision, with evidence). The scorecard is `node scripts/readiness/scorecard.mjs`.

Last full unit suite on the branch (concurrency 4): 11,164 pass, 1 fail (the known sandbox failure "stages a bundled PDF"), 0 cancelled. Scorecard: launch tasks 32 of 40, launch metrics 3 of 5, owner rows 0 of 12.

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

- The Sage notice wording (H6) and its six questions.
- F2's 10 minute dashboard cache instead of the plan's 30 seconds.
- A failed sign-in for a real account no longer stores the typed login (reversed a deliberate choice; one-line revert).
- Audit rows now hold the full client IP, and audit retention is proposed at 7 years.
- Whether coordinators may save a personal AI key; whether the browser should show 988 on a dropped connection before the first stream event.
- The parked tasks C1, B1, C3, which hold four more tasks.
- The 12 owner evidence groups (restore test, model capacity, phones, classroom rehearsal and the rest).

## Known limits

- Local full-suite runs in this sandbox can silently drop whole test files under load; totals wobble. CI is authoritative. A manifest script that proves every file reported is owed.
- Postgres-backed tests (H10, C11, RLS) have never run here; this Mac has no local Postgres.
- M3 (round trips before the first word) stays a pilot gap at 190 against 12.

## Where we left off

Next: push `wave1/integration`, let CI run (first runs of the closeout, alert actions and first-day tests), then Britt's decisions above. Follow-ups from the reviews are listed in the run state file in the session scratchpad and summarized in Open Items.
