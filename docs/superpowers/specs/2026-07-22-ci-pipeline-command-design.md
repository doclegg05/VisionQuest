# `/ci-pipeline` Command — Autonomous Ticket-to-Draft-PR Workflow

**Date:** 2026-07-22
**Status:** Approved (design), pending implementation
**Owner gate decisions:** single human gate at Plan approval; freeform or issue-number intake; draft PR output, never merges.

## Problem

VisionQuest has a complete CI quality bar (`.github/workflows/ci.yml`: lint, auth audit,
catalog integrity, typecheck, unit tests, RLS integration tests, build, smoke;
plus the gating Sage evals in `sage-evals.yml`) and high-ceremony *interactive*
commands (`/feature` stops for approval at every gate). It has no *autonomous*
pipeline: a way to hand a ticket to agents that scout, plan, build, and test with
fail-loops, push through CI, and deliver a draft PR for engineer review — the
overnight-session working pattern.

## Deliverable

One committed command file: `.claude/commands/ci-pipeline.md`.
No application code changes. No CI changes.

Personal commands (`/bug`, `/chore`, `/feature`) remain local-only per
`.git/info/exclude`; `/ci-pipeline` is a shared project command like `/review` and
`/deploy`, so it is tracked.

## Stage machine

Mirrors the reference diagram: Ticket → Prompt → Planning (Scout, Plan) →
Building (Build) → Testing (Test, fail-loop) → CI/CD (fail-loop) → Engineer
Review → Ship. Rendered flowchart: `docs/diagrams/ci-pipeline.md`.

### 1. Intake (Kanban Ticket → Engineer Prompt)

- `$ARGUMENTS` is a GitHub issue number (`/ci-pipeline 123`) or freeform text
  (`/ci-pipeline "fix the flaky login test"`).
- Issue number → `gh issue view <n> --json title,body,labels,url` becomes the
  ticket; freeform text is the ticket verbatim.
- Normalized Ticket block: **goal**, **context**, **source** (issue URL or
  "prompt"). If the ticket is too vague to produce acceptance criteria, the
  pipeline says so and stops at the Plan gate with numbered questions rather
  than guessing.

### 2. Status: Planning

- **Scout Agent** — a read-only Explore subagent. Input: the Ticket block.
  Output: scout report — relevant files with paths, existing patterns to follow
  (per repo rule: never invent a new pattern when one exists), tests covering
  the area, which CLAUDE.md context-map docs (Level 1–3) apply, and risks.
- **Plan step** — orchestrator turns Ticket + scout report into:
  - Spec in the `/feature` house style: current state (verified file paths),
    target state, 3–7 testable acceptance criteria, non-goals (defaults: no
    auth/session changes, no new dependencies, no Prisma schema changes, no
    folder restructuring — unless explicitly included).
  - Ordered implementation steps, files to create/modify, data-model impact,
    one sentence on what could break.
  - Test plan mapping each acceptance criterion to a test.
- **GATE (the only one):** present the plan and STOP for owner approval.
  After approval the rest of the pipeline runs unattended.

### 3. Status: Building

- Branch `ci-pipeline/<short-slug>` off up-to-date `main`.
- Tests first: acceptance tests mapped one-to-one to acceptance criteria,
  run and shown failing before implementation (proves tests are real).
- Implement in small increments; conventional commits at each working state.
- Standing rules baked into the command text:
  - Wiring proof mandatory — every new module/middleware/handler must be shown
    imported and invoked by the running app (the proxy.ts lesson).
  - Never weaken, skip, or delete a failing test to get to green.
  - No new dependency unless the approved plan listed it.
  - Repo conventions: Zod `parseBody` on new/modified routes, JWT auth checks,
    student-data ownership scoping, RLS context, no raw Prisma errors to client.

### 4. Status: Testing (local fail-loop)

- Local gate = the CI-equivalent checks, in order:
  1. `npm run lint`
  2. `npm run typecheck`
  3. `npm test`
  4. `npm run audit:api-auth`
  5. `npx tsx scripts/catalog/validate.mjs --no-db`
  6. `npm run build`
  (`npx prisma validate` added when the plan touches `schema.prisma`.)
- Any failure → feed the failing output back to the Build stage, fix, re-run
  the full local gate. **Max 3 fix loops**; on cap, stop and write an honest
  failure report (what failed, what was tried, current branch state). Never
  push a red branch.
- **Automated review pass:** run the project `code-reviewer` agent on the diff.
  CRITICAL and HIGH findings must be fixed (then the local gate re-runs);
  MEDIUM/LOW get listed in the PR body.

### 5. CI/CD (remote fail-loop)

- Push branch with `-u`, then **immediately open the draft PR** to `main` —
  the CI workflow triggers on `pull_request` to `main` only, so the PR is what
  starts CI. (Sage evals additionally trigger only when the PR touches
  `src/lib/sage/**`, `config/sage-*.json`, `scripts/sage-*.mjs`, or
  `scripts/lib/**`.) The initial PR body carries the spec and a preliminary
  summary; it is finalized in stage 6.
- Watch all checks on the PR: `gh pr checks <n> --watch`.
- On failure: find the failing run and pull `gh run view <id> --log-failed` →
  hand the log to the Build stage as a new instruction → fix → full local gate
  → push (updates the same PR) → watch again.
  **Max 2 CI loops**; on cap, stop and report with the failing log attached.

### 6. Engineer Review → Ship

- Once checks are green, finalize the draft PR body:
  - The spec (current/target/acceptance criteria/non-goals).
  - Plain-English file-by-file walkthrough of the diff.
  - Test plan with results; full-suite summary output.
  - Self-review checklist answers (hardcoded values? unauth'd routes?
    unvalidated input? dead code? weakened tests?).
  - Remaining MEDIUM/LOW review findings.
  - `Closes #<n>` when issue-sourced.
- The PR stays a **draft**; the pipeline **never merges**. Marking ready and
  merging is the owner's Ship action; Render auto-deploys `main`.

## Implementation shape

Orchestrator-driven: the main session executes `ci-pipeline.md` directly,
delegating only Scout (Explore subagent) and the review pass (`code-reviewer`
agent). Build/Test fix-loops run inline so the fixer retains memory of prior
attempts. (Rejected: subagent-per-stage — cleaner isolation but each fix-loop
would start context-blind and token cost balloons.)

**Named reusable agents** (added 2026-07-22): the workflow's roles are extracted
as named project agents in `.claude/agents/` so future `<gate>-pipeline`
workflows reuse them instead of rebuilding similar agents:

- `scout.md` — read-only recon; Ticket block in, five-section scout report out.
- `builder.md` — plan execution contract: tests-first, wiring proof, repo
  conventions, fix-loop instruction handling. Runs inline in `/ci-pipeline`.
- `gate-runner.md` — ordered gate-list execution contract: PASS/FAIL per
  command, failing output verbatim, no fixing while in role. Parameterized by
  gate list, so each `<gate>-pipeline` supplies its own. Runs inline.
- `code-reviewer.md` — pre-existing project agent, used as-is for the pre-push
  review pass.

Plan is deliberately NOT an agent: it owns the single human approval gate, so
it stays with the orchestrator.

## Failure and safety posture

- Retry caps everywhere (3 local, 2 CI); caps produce reports, not thrash.
- Fail-closed: red branch is never pushed; red CI is never left silent;
  the pipeline never merges, never touches non-local databases, never runs
  `prisma migrate` against prod.
- If the plan stops matching reality mid-build, stop and report rather than
  improvise around the approved spec (standing `/feature` rule carried over).

## Acceptance criteria for this deliverable

1. `.claude/commands/ci-pipeline.md` exists, is git-tracked, and passes a dry
   read-through: every stage above is present with its gate, loop caps, and
   guardrails.
2. `/ci-pipeline 123` intake path specifies the exact `gh issue view` invocation;
   freeform path requires no `gh` call.
3. The command instructs exactly one STOP (plan approval) — no other
   mid-pipeline questions.
4. Local gate list matches the CI workflow's checks that can run locally
   (lint, typecheck, test, audit:api-auth, catalog --no-db, build).
5. CI stage opens the draft PR *before* watching checks (CI only triggers on
   PRs to `main`), uses `gh pr checks --watch`, and specifies
   `gh run view --log-failed` as the fail-loop input.
6. Draft-PR stage forbids merging and includes the `Closes #<n>` linkage rule.
7. The command references the named reusable agents by their
   `.claude/agents/` paths (scout, builder, gate-runner, code-reviewer) so the
   roles are identifiable and shareable across the `<gate>-pipeline` family.
