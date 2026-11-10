# Operations evidence checklist (W0, W1, W9)

Fill this in as each check runs. It goes with the [consolidated remaining-work plan](../plans/2026-11-09-consolidated-remaining-work.md). Every row starts as **not run**. Write the date, what you saw, and the next action. A check counts only when it ran against the real system on that date. An old run result does not count.

Result values: `verified`, `failed`, `unavailable` (could not reach the system), `not run`.

Never paste a secret, connection string or student name into this file.

## W0: release and access baseline

| Check | How | Owner | Date | Result | Next action |
| --- | --- | --- | --- | --- | --- |
| Deployed SHA matches the release | Render dashboard, deploy page | Britt | | not run | |
| Pending migrations listed | `npx prisma migrate status` against production, from the Terminal panel | Britt | | not run | |
| Out-of-order migration `20260903120000_add_student_must_change_password` reviewed against the ledger | `SELECT migration_name, finished_at FROM "_prisma_migrations" ORDER BY started_at DESC LIMIT 20;` Do not rename it. | Britt | | not run | |
| Org tree placement counts | `node scripts/org-tree-preflight.mjs` (counts only) | Britt | | not run | |
| Instructor sees own classes only | Sign in as a test instructor | Britt | | not run | |
| Regional and state coordinator scope | Sign in as each test coordinator | Britt | | not run | |
| Admin behavior unchanged | Sign in as admin | Britt | | not run | |
| Old dev-login sessions revoked | Bump `sessionVersion` at deploy, then an old cookie must be refused | Britt | | not run | |
| Previous SHA and config recorded for rollback | Render deploy history | Britt | | not run | |

## W1: operations and model acceptance

| Check | How | Owner | Date | Result | Next action |
| --- | --- | --- | --- | --- | --- |
| Host record: chip, RAM, Ollama version, `OLLAMA_NUM_PARALLEL`, `OLLAMA_KEEP_ALIVE`, context length | On the host; `ollama ps` after one Sage turn shows CONTEXT | Britt | | not run | |
| Relay and fence in effect | [Mac Sage connection runbook](../runbooks/mac-sage-connection.md) | Britt | | not run | |
| Fail-closed with the host stopped | Stop the host, send a Sage turn, expect a refusal, not a cloud answer | Britt | | not run | |
| Provider routing matches the report | `npm run sage:ai:accountability` against production | Britt | | not run | |
| Selected 12B model evals | `npm run sage:agent:eval`, `npm run sage:redteam:eval -- --provider=ollama`, `npm run sage:quality:eval`; record SHA and `SAGE_PROMPT_REVISION` | Implementer | | not run | |
| Cron jobs registered and healthy | `npm run cron:health`; needs the `CRON_CHECK_DATABASE_URL` secret, added in GitHub repository Settings, Secrets and variables, Actions, as a repository secret named `CRON_CHECK_DATABASE_URL` | Britt | | not run | |
| Cold-queue triage under 5 minutes | Time an instructor; check the action panel at 375px | Britt | | not run | |
| Benchmark result PRs allowed | GitHub Settings, Actions, General, "Allow GitHub Actions to create and approve pull requests" | Britt | | not run | |
| Restore drill | [Backup and restore runbook](../runbooks/backup-restore.md) | Britt | | not run | |
| Briefing soak | [Briefing soak runbook](../runbooks/sage-briefing-soak.md) | Britt | | not run | |

## W9: close the cohort demo (after December 18)

Do these in order. The local-only AI fence depends on the demo switch; see W9 in the plan.

| Step | How | Owner | Date | Result |
| --- | --- | --- | --- | --- |
| 1. Keep the fence on | Render: set `COHORT_DEMO_LOCAL_ONLY=true` (or confirm `VQ_MAC_RELAY_ENABLED=true`), deploy | Britt | | not run |
| 2. Fence holds | A Sage turn with the host stopped fails closed | Britt | | not run |
| 3. End demo entry | Render: delete `COHORT_DEMO_MODE`, deploy | Britt | | not run |
| 4. Fence still holds | Repeat step 2 | Britt | | not run |
| 5. Normal sign-in only | The sign-in page shows the normal form; a demo cookie is refused | Britt | | not run |

## Readiness plan owner rows

These rows go with the [deployment readiness plan](../plans/2026-11-10-deployment-readiness.md). They hold the owner steps, O-1 to O-12 and E0, that the tables above do not carry. The readiness scorecard (`npm run readiness`) reads the Result column, and a row counts only when it reads exactly `verified`. Where a row asks for a fact, write the fact in Next action.

Some owner steps reuse rows above. O-3 also needs "Restore drill". O-4 is the first five W1 rows plus the E0 row here. O-5 is "Cron jobs registered and healthy". O-7 also needs the five W9 steps. O-11 is "Cold-queue triage under 5 minutes".

| Check | How | Owner | Date | Result | Next action |
| --- | --- | --- | --- | --- | --- |
| O-1: Render region recorded | Render dashboard, service `visionquest`, Settings tab. Write the region in Next action. | Britt | | not run | |
| O-1: Supabase region recorded | Supabase dashboard, Project Settings, General. Write the region in Next action. | Britt | | not run | |
| O-1: Connection string mode recorded | Render dashboard, service `visionquest`, Environment tab. For `DATABASE_URL` and `ADMIN_DATABASE_URL`, write only whether each uses port 6543 or `pgbouncer=true`. Do not paste either string. | Britt | | not run | |
| O-1: Whether a merge to main deploys on its own | Render dashboard, service `visionquest`, Settings tab, Auto-Deploy. Write yes or no in Next action. | Britt | | not run | |
| O-2: Legal basis in writing | The written legal basis for holding real student records. See the [FERPA review](2026-09-06-ferpa-pii-review.md), Part 8. Write where the document is kept in Next action. | Britt | | not run | |
| O-2: FERPA decision D-E, lane C host | [FERPA review](2026-09-06-ferpa-pii-review.md), Part 8, D-E. Write the decision in Next action. | Britt | | not run | |
| O-2: FERPA decision D-G, student notice and the consent form | [FERPA review](2026-09-06-ferpa-pii-review.md), Part 8, D-G. Write the decision in Next action. | Britt | | not run | |
| O-2: FERPA decision D-H, four questions for counsel | [FERPA review](2026-09-06-ferpa-pii-review.md), Part 8, D-H. Write the date the questions went to counsel in Next action. | Britt | | not run | |
| O-2: FERPA decision D-I, the residual accepted in writing | [FERPA review](2026-09-06-ferpa-pii-review.md), Part 8, D-I. Write where the statement is kept in Next action. | Britt | | not run | |
| O-2: FERPA decision D-J, the mood extractor and the summariser instruction | [FERPA review](2026-09-06-ferpa-pii-review.md), Part 8, D-J. Write the decision in Next action. | Britt | | not run | |
| O-3: Supabase plan tier confirmed | Supabase dashboard, billing page. See the [backup and restore runbook](../runbooks/backup-restore.md), section 2. Write the tier in Next action. | Britt | | not run | |
| O-3: Storage export scheduled | [Backup and restore runbook](../runbooks/backup-restore.md), sections 2.2 and 4.4. Storage objects have no managed backup at any tier. | Britt | | not run | |
| O-3: Render secrets kept in a password manager | Copy every value from the Render dashboard, service `visionquest`, Environment tab, into the password manager. Never into this file. | Britt | | not run | |
| E0: Chat time to first text measured at the host | At the host: cold and warm time to first text with 1, 5 and 15 students chatting at once. Write the six numbers and the answer to decision R11 in Next action. | Britt, with an implementer | | not run | |
| O-6: Render health check path set | Render dashboard, service `visionquest`, Settings tab. The health check path is `/api/health`, as `render.yaml` has it. | Britt | | not run | |
| O-6: Render build command matches render.yaml | Render dashboard, service `visionquest`, Settings tab, against `buildCommand` in `render.yaml`. | Britt | | not run | |
| O-6: SAGE_AGENT_MODE set in Render | Render dashboard, service `visionquest`, Environment tab, against `render.yaml`. | Britt | | not run | |
| O-6: Mail keys set in Render | Render dashboard, service `visionquest`, Environment tab. `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `SMTP_FROM` each have a value. Do not paste a value here. | Britt | | not run | |
| O-6: Sentry keys set in Render | Render dashboard, service `visionquest`, Environment tab. `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN` each have a value. Do not paste a value here. | Britt | | not run | |
| O-7: Backup taken before the closeout | [Backup and restore runbook](../runbooks/backup-restore.md), after the five W9 steps and before the closeout kit runs. | Britt | | not run | |
| O-7: Closeout kit preview run | The closeout script from task H10, with no flags. It prints counts only. Write the counts in Next action. | Britt | | not run | |
| O-7: Closeout kit applied | The closeout script from task H10 with `--apply --confirm-demo-disabled`, after the backup. | Britt | | not run | |
| O-7: Zero demo rows confirmed | Run the preview again. It must count zero demo rows before any real student account is created. | Britt | | not run | |
| O-8: App and database in one region | Compare the two regions recorded for O-1. If they differ, recreate one piece as decision R1 in the plan describes. | Britt | | not run | |
| O-8: Production health latency at target | `npm run readiness -- --only=M7`, which prints the number and writes no report. `latency_ms` must be 60 or less. | Britt | | not run | |
| O-9: Notice wording approved | Decision R10 in the plan. Approve the drafted notice before task H6 merges. | Britt | | not run | |
| O-9: Retention numbers approved | [Data retention policy](../DATA_RETENTION_POLICY.md) and `config/retention-policy.json`. | Britt | | not run | |
| O-9: Staff MFA policy approved | Decision R7 in the plan. | Britt | | not run | |
| O-10: iPhone sign-in and orientation document | On the deployed site, on an iPhone: sign in, then open one orientation document. | Britt | | not run | |
| O-10: Android phone sign-in and orientation document | On the deployed site, on an Android phone: sign in, then open one orientation document. | Britt | | not run | |
| O-12: Classroom rehearsal with fictional accounts | On the deployed site, after the demo rows are gone: 15 people sign in from one network within five minutes, load the dashboard and send Sage one message each. Remove the fictional accounts afterwards. | Britt | | not run | |
