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
| Cron jobs registered and healthy | `npm run cron:health`; needs the `CRON_CHECK_DATABASE_URL` secret | Britt | | not run | |
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
