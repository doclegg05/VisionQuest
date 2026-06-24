# Phase 4 — Chat-First Home

> Executed inline by the orchestrator loop. Scope contract: Phase 4 section of
> `2026-06-09-chat-first-rebuild-master-plan.md`. User-approved bold redesign
> (2026-06-09) supersedes the 2026-04-01 "Files/Resources retained in nav"
> decision — PRODUCT_DECISIONS.md updated in this phase.

**Goal:** The student home IS a Sage conversation, with ambient panels carrying
the dashboard's vital signs. Pages become destinations Sage navigates to.

## Tasks

- [x] **T1 Classic fallback** — current dashboard preserved verbatim at
  `/dashboard/classic` (shared DashboardClient; one release of parity).
- [x] **T2 Chat-first home** — new `/dashboard`: ChatWindow as the primary surface
  (2/3 on desktop), AmbientPanels rail (1/3; stacks above chat on mobile):
  readiness score + top "what's next" gap, today's tasks, alerts, next
  appointment, overdue orientation items, resume nudge. Same server queries as
  the old dashboard (data parity by construction). "Classic view" link.
- [x] **T3 Nav consolidation** — Files → "Documents" label; Resources removed from
  nav (Resource Center card lives on Learning); Orientation returns to secondary
  nav AFTER completion (read-only archive access). Mini-chat dock: already
  multi-turn (verified — keeps conversationId + loads history); FAB hidden on
  /dashboard since the home IS chat.
- [x] **T4 Docs** — PRODUCT_DECISIONS.md decision entry (supersedes 2026-04-01
  retention), CLAUDE.md nav rule + key-decision row, .claude/rules/ui-patterns.md.
- [>] **T5 Teacher queue reasons** (DEFERRED to Phase 6 hardening — queue scoring internals need their own pass) — surface the urgency reasons in the
  intervention queue UI if the scoring already computes them; otherwise defer to
  Phase 6 with a note.
- [x] **T6 Gates + PR** — full suite, eslint, typecheck, build; manual smoke via
  preview server; PR.

**Acceptance (master plan, honestly tracked):** chat-first home renders with data
parity; mobile stacks at 375px; classic preserved; new-student flow intact
(welcome redirect logic untouched). Lighthouse a11y ≥90 — measured if tooling
available, else noted.
