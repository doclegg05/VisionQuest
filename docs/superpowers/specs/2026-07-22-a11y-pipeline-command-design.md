# `/a11y-pipeline` Command — Accessibility-Gated Ticket-to-Draft-PR Workflow

Second member of the `<gate>-pipeline` family (first: `/ci-pipeline`,
spec `2026-07-22-ci-pipeline-command-design.md`). Same stage machine, same
named reusable agents, different gate: the local Testing stage additionally
runs the axe-core accessibility suite, making this the lane for UI-facing
tickets where accessibility regressions are the primary risk.

## Deliverable

One committed command file: `.claude/commands/a11y-pipeline.md`, plus its
instrument (`npm run test:a11y` → `e2e/a11y.spec.ts`) and conformance
validator (`npm run a11y-pipeline:validate`).

## Stage machine

Identical to `/ci-pipeline` (see its spec and
`docs/diagrams/ci-pipeline.md`): Intake → Planning (Scout, Plan, single
STOP gate) → Building → Testing (local fail-loop, max 3) → review pass →
CI/CD (push, draft PR first, watch, fail-loop max 2) → Engineer Review →
Ship (never merges).

## What differs from /ci-pipeline

- **Gate list** (run under the gate-runner contract): the six CI-equivalent
  checks PLUS `npm run test:a11y` as the seventh gate. The a11y suite scans
  public routes (`/`, `/teacher-register`, `/forgot-password`) with
  `@axe-core/playwright` against WCAG 2.0/2.1 A+AA rulesets and fails on any
  violation, printing rule id, impact, and offending selectors.
- **Fix posture**: an axe violation is fixed in the page, never by filtering
  the rule or shrinking the scanned route list — the same never-weaken rule
  that applies to tests.
- **Branch prefix**: `a11y-pipeline/<short-slug>`.
- **Intended tickets**: UI-facing changes (components, pages, styling,
  theming). Non-UI tickets belong in `/ci-pipeline`.

## Agent reuse

All four named agents are reused by reference, not redefined:
`.claude/agents/scout.md` (dispatched), `.claude/agents/builder.md` (inline),
`.claude/agents/gate-runner.md` (inline, parameterized by this gate list),
`.claude/agents/code-reviewer.md` (dispatched; registry-independent fallback
per the 2026-07-22 hardening).

## Honest scope notes

- Authenticated pages are not yet scanned — requires a seeded test user
  (existing open item; see `docs/superpowers/plans/2026-06-10-a11y-results.md`).
  When that lands, `e2e/a11y.spec.ts` grows; this command does not change.
- Dark-mode scans are not included yet; the known `bg-white` + ink-token
  contrast bug class is dark-mode-specific, so this is the highest-value
  future extension of the suite.
- axe automates only a subset of WCAG; keyboard-only flows and screen-reader
  labels remain manual checks.

## Acceptance criteria (encoded in the validator)

1. `.claude/commands/a11y-pipeline.md` exists and is git-tracked.
2. Intake accepts `$ARGUMENTS` as issue number (exact
   `gh issue view <n> --json title,body,labels,url` invocation) or freeform.
3. All stages present: Scout, Plan, Build, Test, CI/CD, Engineer Review.
4. Exactly one uppercase STOP token (plan approval); failure-cap language
   stays lowercase.
5. Local gate lists the six CI-equivalent commands AND `npm run test:a11y`.
6. Fail-loop caps: max 3 local, max 2 CI.
7. code-reviewer pass before push.
8. Draft PR created before CI watch (`gh pr checks --watch`); CI fail-loop
   fed by `gh run view --log-failed`.
9. Never merges; `Closes #<n>` linkage when issue-sourced.
10. Named agents referenced by their `.claude/agents/` paths (scout, builder,
    gate-runner).
