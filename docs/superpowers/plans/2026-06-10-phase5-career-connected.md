# Phase 5 — Career Trio Connected Through Sage

> Executed inline by the orchestrator loop. Scope contract: Phase 5 section of the
> master plan. Reuses the Phase 3 confirmation machinery — the confirm card IS the
> accept/reject mechanism for resume edits (Reactive Resume propose→review pattern,
> adapted to our HMAC card instead of JSON Patch documents).

## Tasks

- [ ] **T1 propose_resume_edit tool** — section-scoped edits on ResumeContent
  (headline/objective/skills/references via replace|append), zod-validated, ownership
  -checked, confirm-card gated (diff summary on the card), applied to ResumeData via
  parse→normalize→save. Ledgered + audited like all write tools. Tests.
- [ ] **T2 analyze_job_match tool** — read-only: loads a job listing (title, company,
  description excerpt) + the student's resume skills, completed certs, and discovery
  clusters; returns structured data via modelHint so Sage narrates the skill-gap
  analysis grounded in real posting text. Tests.
- [ ] **T3 Credly server-side cache** — badge fetch moves server-side with a 24h DB
  cache (Student.credlyBadgesCache JSON + cachedAt), so badges survive Credly outages
  and stop hitting the public API per page view.
- [ ] **T4 Goal→resume→job thread** — system-prompt addendum: when a career goal is
  confirmed and the resume is empty/stale or skills are missing for saved jobs, Sage
  nudges (uses existing student context; no new queries in the hot path).
- [ ] **T5 Eval + gates** — extend sage-agent-eval with resume-edit and job-match
  scenarios (≥5 new); full suite/lint/typecheck/build; PR.

**Acceptance (master plan):** resume edits never apply without explicit accept
(confirm card); job analysis cites only real posting content (tool feeds the actual
description; eval scenario checks tool selection); each flow tested.
