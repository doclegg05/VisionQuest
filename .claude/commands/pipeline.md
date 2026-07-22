---
description: Autonomous ticket-to-draft-PR pipeline — scout, plan (one approval gate), build, test with fail-loops, CI, deliver a draft PR
---

# Pipeline workflow

The ticket: $ARGUMENTS

You are working in VisionQuest (Next.js / Prisma / PostgreSQL). This is the autonomous
counterpart to `/feature`: after a single plan-approval gate, you run unattended through
build, test, CI, and finish by delivering a **draft PR** for Engineer Review. You never
merge. Spec: `docs/superpowers/specs/2026-07-22-pipeline-command-design.md`.

## Stage 1 — Intake (Ticket → Engineer Prompt)

1. Interpret `$ARGUMENTS`:
   - **Issue number** (e.g. `/pipeline 123`): fetch the ticket with exactly
     `gh issue view <n> --json title,body,labels,url`.
   - **Freeform text** (e.g. `/pipeline "fix the flaky login test"`): the text IS the
     ticket verbatim — make no `gh` call.
2. Normalize into a Ticket block with three fields:
   - **goal** — what done looks like, in one or two sentences.
   - **context** — labels, body details, constraints worth carrying forward.
   - **source** — the issue URL, or the literal string "prompt" for freeform intake.
3. If the ticket is too vague to write testable acceptance criteria, do not guess.
   Carry numbered clarifying questions forward to the plan gate (Stage 2) and end the
   pipeline there — the plan gate is the only place you pause for a human.

## Stage 2 — Planning (Scout, then Plan — the only gate)

1. **Scout.** Dispatch a read-only Explore subagent with the Ticket block as input.
   It must return a scout report containing:
   - Relevant files with exact paths.
   - Existing patterns to follow — never invent a new pattern when one exists in the repo.
   - Tests that already cover the area.
   - Which CLAUDE.md context-map docs (Level 1–3) apply to this change.
   - Risks it can see from reading the code.
2. **Plan.** Turn Ticket + scout report into the `/feature` house spec style:
   - **Current state** — what exists today, citing file paths the scout verified.
   - **Target state** — what will exist when done.
   - **Acceptance criteria** — 3–7 testable statements.
   - **Non-goals** — defaults for every run: no auth/session changes, no new
     dependencies, no Prisma schema changes, no folder restructuring — unless the
     plan explicitly includes them.
   - Ordered implementation steps, files to create/modify, data-model impact, and one
     sentence on what could break.
   - **Test plan** mapping each acceptance criterion to a specific test.
3. STOP. Present the plan (plus any numbered questions from Stage 1) and wait for
   owner approval. This is the single human gate — after approval, run every remaining
   stage unattended with no further questions.

## Stage 3 — Building

1. Create branch `pipeline/<short-slug>` off an up-to-date `main`.
2. **Tests first.** Write the acceptance tests mapped one-to-one to the approved
   acceptance criteria. Run them and show them failing before any implementation —
   this proves the tests are real.
3. Implement in small increments; make a conventional commit at each working state.
4. Standing rules while building:
   - **Wiring proof is mandatory.** For every new module, middleware, or handler, show
     the exact line(s) where it is imported and invoked by the running application.
     Code that exists but is never called counts as not done (the proxy.ts lesson).
   - Never weaken, skip, or delete a failing test to get to green — fix the code, or
     report that the test is wrong and why.
   - No new dependency unless the approved plan listed it.
   - Repo conventions: Zod `parseBody` on new/modified routes, JWT auth checks,
     student-data ownership scoping (`where: { studentId }`), RLS context via
     `withRlsContext`, and no raw Prisma errors returned to the client.

## Stage 4 — Testing (local fail-loop)

1. Run the local gate — the CI-equivalent checks — in this order:
   1. `npm run lint`
   2. `npm run typecheck`
   3. `npm test`
   4. `npm run audit:api-auth`
   5. `npx tsx scripts/catalog/validate.mjs --no-db`
   6. `npm run build`
   Add `npx prisma validate` to the list whenever the plan touches `schema.prisma`.
2. On any failure: feed the failing output back into the Build stage, fix it, then
   re-run the full local gate from the top. Allow **max 3 fix loops**. If the cap is
   hit, stop and write an honest failure report — what failed, what was tried, and the
   current branch state. Never push a red branch.
3. **Automated review pass.** Once the local gate is green, run the project
   `code-reviewer` agent on the branch diff. CRITICAL and HIGH findings must be fixed
   (then re-run the full local gate); record MEDIUM and LOW findings for the PR body.

## Stage 5 — CI/CD (remote fail-loop)

1. Push the branch with `git push -u origin pipeline/<short-slug>`, then
   **immediately open the draft PR** to `main`:
   `gh pr create --draft --base main --title "..." --body "..."`.
   The CI workflow triggers on `pull_request` to `main` only, so the PR is what starts
   CI. (Sage evals additionally trigger only when the PR touches `src/lib/sage/**`,
   `config/sage-*.json`, `scripts/sage-*.mjs`, or `scripts/lib/**`.) The initial PR
   body carries the approved spec and a preliminary summary; it is finalized in Stage 6.
2. Watch every check on the PR: `gh pr checks <n> --watch`.
3. On a failing check: locate the failing run and pull its log with
   `gh run view <id> --log-failed`. Hand that log to the Build stage as a new
   instruction, fix, re-run the full local gate, push (which updates the same PR), and
   watch again. Allow **max 2 CI fix loops**. If the cap is hit, stop and report with
   the failing log attached. Never leave red CI silent.

## Stage 6 — Engineer Review → Ship

1. Once all checks are green, finalize the draft PR body with:
   - The approved spec: current state, target state, acceptance criteria, non-goals.
   - A plain-English file-by-file walkthrough of the diff.
   - The test plan with results, plus the full-suite summary output.
   - Self-review checklist, answered explicitly: hardcoded values or secrets? routes
     without auth checks? unvalidated input reaching the database? dead code?
     weakened/skipped/deleted tests?
   - Remaining MEDIUM/LOW review findings from Stage 4.
   - `Closes #<n>` when the ticket came from an issue.
2. The PR stays a **draft**; this pipeline **never merges**. Marking the PR ready and
   merging is the owner's Ship action — Render auto-deploys `main` after merge.

## Failure and safety posture

- Retry caps everywhere (3 local, 2 CI); hitting a cap produces a report, not thrash.
- Fail-closed: a red branch is never pushed; red CI is never left silent; the pipeline
  never merges, never touches non-local databases, and never runs `prisma migrate`
  against prod.
- If the plan stops matching reality mid-build, stop and report rather than improvise
  around the approved spec.
