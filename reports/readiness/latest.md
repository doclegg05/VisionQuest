# Readiness scorecard

Generated 2026-11-12T17:34:44.697Z at commit dd61c17c-dirty. Flags: --ci-green=https://github.com/doclegg05/VisionQuest/actions/runs/43267766862.

## Gates

| ID | Set | Status | Gate | Detail |
| --- | --- | --- | --- | --- |
| T1 | launch | pass | Readiness scorecard | 68 tests passed |
| T2 | launch | pass | Query counter | 56 tests passed |
| T3 | launch | pass | Page weight script | exit 0 |
| T4 | pilot | pass | Counter fidelity | 69 tests passed |
| T5 | pilot | pending | Check the counter against a real database | no check yet |
| T6 | launch | pass | First-day browser test in CI | not run here: green in CI run https://github.com/doclegg05/VisionQuest/actions/runs/43267766862 (1 test file found) |
| A1 | launch | pass | Classroom-safe sign-in limits | 141 tests passed |
| A2 | launch | pass | One password rule | 76 tests passed |
| A3 | launch | pass | Students can change a password, and must after staff set one | 456 tests passed |
| A4 | pilot | pending | Staff can finish MFA setup | no check yet |
| A5 | pilot | pending | A signed-out student is told why | no check yet |
| A6 | launch | pass | The sign-in limits count the real client address | 122 tests passed |
| B1 | launch | pass | Regions screen | 347 tests passed |
| B2 | launch | pass | An unplaced instructor is not stranded | 21 tests passed |
| B3 | launch | pass | First-day guidance | 101 tests passed |
| B4 | pilot | pending | Class actions that cannot hurt by accident | no check yet |
| B5 | pilot | pending | Archiving a region ends its coordinators' access | no check yet |
| C1 | launch | pass | Verify buttons report failure | 153 tests passed |
| C2 | launch | pass | Alert age is real | 23 tests passed |
| C3 | launch | pass | Queue actions can be undone | 125 tests passed |
| C4 | pilot | pending | Teacher home leads with the queue | no check yet |
| C5 | pilot | pending | One class filter | no check yet |
| C6 | pilot | pending | Program Setup is safe | no check yet |
| C7 | pilot | pending | Staff wording and narrow screens | no check yet |
| C8 | pilot | pending | Student page polish from the C1 reviews | no check yet |
| C9 | launch | pass | Alert audit and conflict checks (delivered with C11) | 27 tests passed |
| C10 | pilot | pending | Queue polish from the C3 reviews | no check yet |
| C11 | launch | pass | Alert Undo never overwrites a newer action | 59 tests passed |
| D1 | launch | pass | The signed-form banner is removed from the student home, per R5 | 6 tests passed |
| D2 | launch | pass | Orientation documents open on phones | 26 tests passed |
| D3 | launch | pass | Sign-in form first on phones | 20 tests passed |
| D4 | pilot | pending | Student home works on a phone | no check yet |
| D5 | pilot | pending | Forms keep what was typed | no check yet |
| D6 | pilot | pending | One error line | no check yet |
| D7 | pilot | pending | Student wording, and the text-message setup dead end | no check yet |
| D8 | pilot | pending | An instructor can get a missing Student Profile form signed | no check yet |
| E0 | launch | owner-open | Measure before changing any timeout | 0 of 1 row verified |
| E1 | launch | pass | Honest failure states | 337 tests passed |
| E2 | launch | pass | A wait the student can read | 85 tests passed |
| E3 | pilot | pending | Retry repeats nothing | no check yet |
| E4 | pilot | pending | First byte early | no check yet |
| E5 | pilot | pending | Smooth typing on slow phones | no check yet |
| E6 | launch | pass | "Sage is an AI and can be wrong" under the message box, linked to the notice page | 65 tests passed |
| E7 | pilot | pending | The mini chat has Retry and Help on failure | no check yet |
| E8 | pilot | pending | Chat opens with its history | no check yet |
| E9 | launch | pass | Chat never traps a student waiting | 125 tests passed |
| F1 | launch | pass | Pool and session | 196 tests passed |
| F2 | launch | pass | Dashboard read diet | 153 tests passed |
| F3 | launch | pass | Bookkeeping after the response | 202 tests passed |
| F4 | pilot | pending | Transactions that fit | no check yet |
| F5 | pilot | pending | Teacher home in one pass | no check yet |
| F6 | pilot | pending | The jobs list sends only what it shows | no check yet |
| F7 | hold | pending | A cheaper RLS wrapper | no check yet |
| F8 | pilot | pending | Alert sync follow-ups from the F3 database review | no check yet |
| G1 | launch | pass | Pages show before JavaScript runs | 4 tests passed |
| G2 | launch | pass | Lighter sign-in | 34 tests passed |
| G3 | launch | pass | Smaller orientation video | 7 tests passed |
| G4 | pilot | pending | File downloads cache privately | no check yet |
| G5 | pilot | pending | Load less up front | no check yet |
| G6 | pilot | pending | Loading and error coverage | no check yet |
| G7 | pilot | pending | Tailwind scans `src` only | no check yet |
| H1 | launch | pass | Errors reach a person | 471 tests passed |
| H2 | launch | pass | Demo and real students can never coexist | 100 tests passed |
| H3 | launch | pass | Sage's state is visible | 16 tests passed |
| H4 | launch | pass | The block on cloud AI is explicit | 133 tests passed |
| H5 | launch | pass | Jobs survive a restart | 23 tests passed |
| H6 | launch | pass | Notice and acknowledgement | 99 tests passed |
| H7 | launch | pass | Release hygiene | 4 tests passed |
| H8 | launch | pass | Incident basics page at `docs/runbooks/incident-basics.md` | 1 of 1 row verified |
| H9 | pilot | pending | A per-user limit on uploads | no check yet |
| H10 | launch | pass | Demo closeout kit | not run here: green in CI run https://github.com/doclegg05/VisionQuest/actions/runs/43267766862 (10 test files found) |
| H11 | pilot | pending | Delivery jobs have known bounds | no check yet |
| H12 | pilot | pending | Error reporting stays small in the browser | no check yet |
| H13 | pilot | pending | Error reporting follow-ups from the two privacy audits | no check yet |
| H14 | pilot | pending | The closeout removes demo files from storage | no check yet |
| H15 | launch | pass | Every staff read of one student's record is written down | 197 tests passed |
| M1 | launch | pass | Estimated database round trips for one student dashboard render | 79 round trips (target at most 85, baseline 163) |
| M2 | launch | pass | Statements per open dashboard per minute at idle | 7.1 statements per minute (target at most 8, baseline 60) |
| M3 | pilot | fail | Estimated database round trips before chat sends its first byte | 190 round trips (target at most 12, baseline 190) |
| M4 | launch | fail | Compressed scripts and styles on the sign-in page | 322.2 KB (target at most 235, baseline 322) |
| M5 | launch | pass | Orientation video size | 9.5 MB (target at most 10, baseline 34.7) |
| M6 | pilot | fail | Estimated database round trips for one teacher home render | 114 round trips (target at most 60, baseline 114) |
| M7 | launch | fail | Production `/api/health` `latency_ms` | 935 ms (target at most 60, baseline 530) |
| M8 | pilot | unmeasured | Signed-in student dashboard, median server time in production | no measuring command yet (target at most 1000, baseline not measured) |

## Owner track: only Britt can close these rows

| ID | Set | Status | Gate | Detail |
| --- | --- | --- | --- | --- |
| O-1 | launch | owner-open | Regions, connection string mode and deploy-on-merge recorded | 0 of 4 rows verified |
| O-2 | launch | owner-open | Legal basis and FERPA decisions | 0 of 6 rows verified |
| O-3 | launch | owner-open | Backups | 0 of 4 rows verified |
| O-4 | launch | owner-open | Model acceptance at the host | 0 of 6 rows verified |
| O-5 | launch | owner-open | Cron health | 0 of 1 row verified |
| O-6 | launch | owner-open | Render in line with render.yaml | 0 of 6 rows verified |
| O-7 | launch | owner-open | Demo closeout | 0 of 9 rows verified |
| O-8 | launch | owner-open | App and database in one region | 0 of 2 rows verified |
| O-9 | pilot | owner-open | Notice wording, retention numbers and staff MFA policy approved | 1 of 3 rows verified |
| O-10 | launch | owner-open | Real phones | 0 of 2 rows verified |
| O-11 | pilot | owner-open | Cold-queue triage timed | 0 of 1 row verified |
| O-12 | launch | owner-open | Classroom rehearsal | 0 of 1 row verified |

## Scores

Launch tasks: 39/40

Launch metrics: 3/5

Owner rows: 0/12

Pilot tasks: 1/35

Pilot metrics: 0/3

Note: --ci-green was used. 2 gates count as pass on CI run https://github.com/doclegg05/VisionQuest/actions/runs/43267766862, without running here: T6, H10.
