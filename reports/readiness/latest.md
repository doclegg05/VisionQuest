# Readiness scorecard

Generated 2026-11-10T19:33:44.136Z at commit cb5e96b2. Flags: none.

## Gates

| ID | Set | Status | Gate | Detail |
| --- | --- | --- | --- | --- |
| T1 | launch | pass | Readiness scorecard | 66 tests passed |
| T2 | launch | pass | Query counter | 36 tests passed |
| T3 | launch | pass | Page weight script | exit 0 |
| T4 | pilot | pending | Counter fidelity | no check yet |
| A1 | launch | pending | Classroom-safe sign-in limits | no check yet |
| A2 | launch | pending | One password rule | no check yet |
| A3 | launch | pending | Students can change a password, and must after staff set one | no check yet |
| A4 | pilot | pending | Staff can finish MFA setup | no check yet |
| A5 | pilot | pending | A signed-out student is told why | no check yet |
| B1 | launch | pending | Regions screen | no check yet |
| B2 | launch | pending | An unplaced instructor is not stranded | no check yet |
| B3 | launch | pending | First-day guidance | no check yet |
| B4 | pilot | pending | Class actions that cannot hurt by accident | no check yet |
| C1 | launch | pending | Verify buttons report failure | no check yet |
| C2 | launch | pending | Alert age is real | no check yet |
| C3 | launch | pending | Queue actions can be undone | no check yet |
| C4 | pilot | pending | Teacher home leads with the queue | no check yet |
| C5 | pilot | pending | One class filter | no check yet |
| C6 | pilot | pending | Program Setup is safe | no check yet |
| C7 | pilot | pending | Staff wording and narrow screens | no check yet |
| D1 | launch | pending | The signed-form banner is removed from the student home, per R5 | no check yet |
| D2 | launch | pending | Orientation documents open on phones | no check yet |
| D3 | launch | pending | Sign-in form first on phones | no check yet |
| D4 | pilot | pending | Student home works on a phone | no check yet |
| D5 | pilot | pending | Forms keep what was typed | no check yet |
| D6 | pilot | pending | One error line | no check yet |
| D7 | pilot | pending | Student wording, and the text-message setup dead end | no check yet |
| D8 | pilot | pending | An instructor can get a missing Student Profile form signed | no check yet |
| E0 | launch | owner-open | Measure before changing any timeout | 0 of 1 row verified |
| E1 | launch | pending | Honest failure states | no check yet |
| E2 | launch | pending | A wait the student can read | no check yet |
| E3 | pilot | pending | Retry repeats nothing | no check yet |
| E4 | pilot | pending | First byte early | no check yet |
| E5 | pilot | pending | Smooth typing on slow phones | no check yet |
| E6 | launch | pending | "Sage is an AI and can be wrong" under the message box, linked to the notice page | no check yet |
| E7 | pilot | pending | The mini chat has Retry and Help on failure | no check yet |
| E8 | pilot | pending | Chat opens with its history | no check yet |
| F1 | launch | pending | Pool and session | no check yet |
| F2 | launch | pending | Dashboard read diet | no check yet |
| F3 | launch | pending | Bookkeeping after the response | no check yet |
| F4 | pilot | pending | Transactions that fit | no check yet |
| F5 | pilot | pending | Teacher home in one pass | no check yet |
| F6 | pilot | pending | The jobs list sends only what it shows | no check yet |
| F7 | hold | pending | A cheaper RLS wrapper | no check yet |
| G1 | launch | pending | Pages show before JavaScript runs | no check yet |
| G2 | launch | pending | Lighter sign-in | no check yet |
| G3 | launch | pending | Smaller orientation video | no check yet |
| G4 | pilot | pending | File downloads cache privately | no check yet |
| G5 | pilot | pending | Load less up front | no check yet |
| G6 | pilot | pending | Loading and error coverage | no check yet |
| G7 | pilot | pending | Tailwind scans `src` only | no check yet |
| H1 | launch | pending | Errors reach a person | no check yet |
| H2 | launch | pending | Demo and real students can never coexist | no check yet |
| H3 | launch | pending | Sage's state is visible | no check yet |
| H4 | launch | pending | The block on cloud AI is explicit | no check yet |
| H5 | launch | pending | Jobs survive a restart | no check yet |
| H6 | launch | pending | Notice and acknowledgement | no check yet |
| H7 | launch | pending | Release hygiene | no check yet |
| H8 | launch | pending | Incident basics page at `docs/runbooks/incident-basics.md` | no check yet |
| H9 | pilot | pending | A per-user limit on uploads | no check yet |
| H10 | launch | pending | Demo closeout kit | no check yet |
| M1 | launch | fail | Estimated database round trips for one student dashboard render | 167 round trips (target at most 85, baseline 167) |
| M2 | launch | unmeasured | Statements per open dashboard per minute at idle | no measuring command yet (target at most 8, baseline 60) |
| M3 | pilot | unmeasured | Estimated database round trips before chat sends its first byte | no measuring command yet (target at most 12, baseline 167) |
| M4 | launch | fail | Compressed scripts and styles on the sign-in page | 322.2 KB (target at most 235, baseline 322) |
| M5 | launch | fail | Orientation video size | 34.7 MB (target at most 10, baseline 34.7) |
| M6 | pilot | fail | Estimated database round trips for one teacher home render | 111 round trips (target at most 60, baseline 111) |
| M7 | launch | fail | Production `/api/health` `latency_ms` | 535 ms (target at most 60, baseline 530) |
| M8 | pilot | unmeasured | Signed-in student dashboard, median server time in production | no measuring command yet (target at most 1000, baseline not measured) |

## Owner track: only Britt can close these rows

| ID | Set | Status | Gate | Detail |
| --- | --- | --- | --- | --- |
| O-1 | launch | owner-open | Regions, connection string mode and deploy-on-merge recorded | 0 of 4 rows verified |
| O-2 | launch | owner-open | Legal basis and FERPA decisions | 0 of 6 rows verified |
| O-3 | launch | owner-open | Backups | 0 of 4 rows verified |
| O-4 | launch | owner-open | Model acceptance at the host | 0 of 6 rows verified |
| O-5 | launch | owner-open | Cron health | 0 of 1 row verified |
| O-6 | launch | owner-open | Render in line with render.yaml | 0 of 5 rows verified |
| O-7 | launch | owner-open | Demo closeout | 0 of 9 rows verified |
| O-8 | launch | owner-open | App and database in one region | 0 of 2 rows verified |
| O-9 | pilot | owner-open | Notice wording, retention numbers and staff MFA policy approved | 0 of 3 rows verified |
| O-10 | launch | owner-open | Real phones | 0 of 2 rows verified |
| O-11 | pilot | owner-open | Cold-queue triage timed | 0 of 1 row verified |
| O-12 | launch | owner-open | Classroom rehearsal | 0 of 1 row verified |

## Scores

Launch tasks: 3/34

Launch metrics: 0/5

Owner rows: 0/12

Pilot tasks: 0/26

Pilot metrics: 0/3
