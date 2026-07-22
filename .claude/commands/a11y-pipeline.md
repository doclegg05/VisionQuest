---
description: Accessibility-gated ticket-to-draft-PR pipeline — scout, plan (one approval gate), build, test with axe a11y fail-loops, CI, deliver a draft PR
---

# A11y pipeline workflow

The ticket: $ARGUMENTS

You are working in VisionQuest (Next.js / Prisma / PostgreSQL). This is the
accessibility-gated sibling of `/ci-pipeline` — same stage machine, same named agents,
plus an axe-core accessibility gate. Use it for UI-facing tickets (components, pages,
styling, theming) where a11y regressions are the primary risk; non-UI tickets belong in
`/ci-pipeline`. After a single plan-approval gate you run unattended through build, test,
CI, and finish by delivering a **draft PR** for Engineer Review. You never merge.
Spec: `docs/superpowers/specs/2026-07-22-a11y-pipeline-command-design.md`.

## Stage 1 — Intake (Ticket → Engineer Prompt)

1. Interpret `$ARGUMENTS`:
   - **Issue number** (e.g. `/a11y-pipeline 123`): fetch the ticket with exactly
     `gh issue view <n> --json title,body,labels,url`.
   - **Freeform text** (e.g. `/a11y-pipeline "fix contrast on the MFA panel"`): the text
     IS the ticket verbatim — make no `gh` call.
2. Normalize into a Ticket block with three fields:
   - **goal** — what done looks like, in one or two sentences.
   - **context** — labels, body details, constraints worth carrying forward.
   - **source** — the issue URL, or the literal string "prompt" for freeform intake.
3. If the ticket is too vague to write testable acceptance criteria, do not guess.
   Carry numbered clarifying questions forward to the plan gate (Stage 2) and end the
   pipeline there — the plan gate is the only place you pause for a human.

## Stage 2 — Planning (Scout, then Plan — the only gate)

1. **Scout.** Dispatch the **scout** agent (`.claude/agents/scout.md`) with the Ticket
   block as input. It must return a scout report containing:
   - Relevant files with exact paths.
   - Existing patterns to follow — never invent a new pattern when one exists in the repo.
   - Tests that already cover the area.
   - Which CLAUDE.md context-map docs (Level 1–3) apply — for UI work this includes
     `.impeccable.md` and `.claude/rules/ui-patterns.md` (WCAG AA, low-literacy focus).
   - Risks it can see from reading the code.
2. **Plan.** Turn Ticket + scout report into the `/feature` house spec style:
   - **Current state** — what exists today, citing file paths the scout verified.
   - **Target state** — what will exist when done.
   - **Acceptance criteria** — 3–7 testable statements; for a11y tickets, include the
     axe rule(s) or WCAG criteria the change must satisfy.
   - **Non-goals** — defaults for every run: no auth/session changes, no new
     dependencies, no Prisma schema changes, no folder restructuring — unless the
     plan explicitly includes them.
   - Ordered implementation steps, files to create/modify, and one sentence on what
     could break.
   - **Test plan** mapping each acceptance criterion to a specific test.
3. STOP. Present the plan (plus any numbered questions from Stage 1) and wait for
   owner approval. This is the single human gate — after approval, run every remaining
   stage unattended with no further questions.

## Stage 3 — Building

Assume the **builder** role for this stage: follow `.claude/agents/builder.md`
inline (no subagent — fix-loops must keep memory of prior attempts).

1. Create branch `a11y-pipeline/<short-slug>` off an up-to-date `main`.
2. **Tests first.** Write the acceptance tests mapped one-to-one to the approved
   acceptance criteria. Run them and show them failing before any implementation.
3. Implement in small increments; make a conventional commit at each working state.
4. Standing rules while building: wiring proof for anything new, never weaken a
   failing test, no new dependency unless the approved plan listed it, and the design
   rules in `.impeccable.md` (adaptive tokens over hardcoded colors — the `bg-white` +
   ink-token dark-mode contrast bug class is this pipeline's reason to exist).

## Stage 4 — Testing (local fail-loop)

Run the gates under the **gate-runner** contract (`.claude/agents/gate-runner.md`),
inline: report PASS/FAIL per command, failing output verbatim, no fixing or
gate-editing while in this role.

1. Run the local gate — the CI-equivalent checks plus the accessibility suite:
   1. `npm run lint`
   2. `npm run typecheck`
   3. `npm test`
   4. `npm run audit:api-auth`
   5. `npx tsx scripts/catalog/validate.mjs --no-db`
   6. `npm run build`
   7. `npm run test:a11y` — axe-core scan of the public routes (WCAG 2.x A/AA);
      failures print rule id, impact, and offending selectors. Local note: port 3000
      is often occupied on this machine — run with
      `PORT=<free> BASE_URL=http://localhost:<free>` overrides.
   Add `npx prisma validate` whenever the plan touches `schema.prisma`.
2. On any failure: feed the failing output back into the Build stage, fix it, then
   re-run the full local gate from the top. Allow **max 3 fix loops**. An axe violation
   is fixed in the page — never by filtering the rule, excluding a route, or shrinking
   the scanned ruleset (the same never-weaken rule that protects tests). If the cap is
   hit, stop and write an honest failure report. Never push a red branch.
3. **Automated review pass.** Once the local gate is green, review the branch diff
   with the project `code-reviewer` definition (`.claude/agents/code-reviewer.md`):
   use the registered `code-reviewer` agent type if this session has one; otherwise
   dispatch a general-purpose subagent primed with that file. CRITICAL and WARNING
   findings must be fixed (then re-run the full local gate); record SUGGESTION
   findings for the PR body.

## Stage 5 — CI/CD (remote fail-loop)

1. Push the branch with `git push -u origin a11y-pipeline/<short-slug>`, then
   **immediately open the draft PR** to `main`:
   `gh pr create --draft --base main --title "..." --body "..."`.
   The CI workflow triggers on `pull_request` to `main` only, so the PR is what starts
   CI. The initial PR body carries the approved spec and a preliminary summary; it is
   finalized in Stage 6.
2. Watch every check on the PR: `gh pr checks <n> --watch`. (If it reports "no checks"
   immediately after a push, GitHub has not registered the run yet — retry after ~10s.)
3. On a failing check: pull its log with `gh run view <id> --log-failed`, hand that log
   to the Build stage as a new instruction, fix, re-run the full local gate, push, and
   watch again. Allow **max 2 CI fix loops**. If the cap is hit, stop and report with
   the failing log attached. Never leave red CI silent.

## Stage 6 — Engineer Review → Ship

1. Once all checks are green, finalize the draft PR body with:
   - The approved spec: current state, target state, acceptance criteria, non-goals.
   - A plain-English file-by-file walkthrough of the diff.
   - The test plan with results, including the a11y suite output.
   - Self-review checklist, answered explicitly: hardcoded colors instead of adaptive
     tokens? touch targets under 44px? missing ARIA labels on icon-only buttons?
     heading hierarchy broken? weakened/skipped/deleted tests or filtered axe rules?
   - Remaining SUGGESTION-level review findings from Stage 4.
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
