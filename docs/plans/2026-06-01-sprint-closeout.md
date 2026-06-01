# Sprint Closeout — Production-Readiness (2026-06-01)

Closes the work driven by the May 29 production-readiness review
(`2026-05-29-production-readiness.md`). Every blocker, HIGH, and
completeness-critic gap is now resolved or a deliberately-deferred, documented
decision.

## Shipped this sprint

**Merged (PR #59, squash `67f1a37`):** crisis safety-net; 5 HIGH fixes (H-email,
H-zod, H-data, H-value-loop, H-a11y); completeness #3 (nudge channel), #5
(status-drift), #6 (ET grant boundaries); RLS tests in CI.

**Open PRs (awaiting merge):**
- **#60** — completeness #2: force recovery-question setup on first student login.
- **#61** — completeness #4: data retention & offboarding policy (doc).
- **#62** — §7.1 stale-doc cleanup: RLS runbook status banner.
- **(this branch)** — audit B4 + B5 follow-ups:
  - **B4** — `awardEvent` now rolls back the event row if the state update
    hard-fails, so a retry re-applies both (closes the "event recorded, XP lost"
    window). +1 test.
  - **B5** — per-segment `error.tsx` added to the remaining 11 student routes.

## Deliberately deferred (with rationale)

These were flagged by the review as **follow-ups, not first-cohort blockers**.
Each was evaluated this sprint and intentionally left:

- **B3 — persist exhausted goal-extraction failures to a table.**
  Declined as designed. Goal-extraction exhaustion already emits a loud
  `alert: goal_extraction_exhausted` error log — the correct **ops/monitoring**
  channel. A per-instructor table would be write-only noise without a review
  surface, and an instructor-facing extraction-failure UI is a feature, not a
  reliability fix. Revisit only if/when there's a consumer for it.

- **B4 full `$transaction` atomicity.**
  Not pursued. `updateProgression` uses **optimistic version-locking with
  internal retries**, which does not compose with an interactive transaction
  (deadlock / serialization-failure risk — worse than the rare window it would
  close). The compensating-delete fix above closes the actual gap without
  changing the concurrency model.

- **#4 hardenings — `deactivatedAt` column + durable offboarding auto-archive.**
  Deferred to a larger cohort per operator decision (see PR #61). No live
  students yet, so no exit dates are being lost. Best landed *before* the first
  real cohort so exit timestamps are clean from day one.

- **Paid Supabase backups / PITR.** Operator decision: stay on free tier
  through alpha; revisit before a larger cohort (PR #61).

## Operator / process items (not code)
- Confirm SMTP is provisioned in Render (gates the email channel; in-app works
  regardless).
- §7.6: re-run the audit on `main` before onboarding a real cohort.
- §6 deferrals (pgvector RAG, per-student PDF, etc.) — intentionally out of
  scope before the first cohort.

## Net
The May 29 review has no remaining first-cohort blockers. What's left is the
documented, intentionally-deferred tail above. Sprint closed; next work starts
on new VisionQuest features.
