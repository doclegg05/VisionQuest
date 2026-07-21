# VisionQuest Maturity Review & Repair — 2026-07-20

Status: Repair session complete (overnight autonomous session on branch `claude/sage-maturity-review-06d785`)
Scope: Sage (AI wrapper) · student workflow · instructor monitoring · orientation · security & data protection
Companion decisions: see the 2026-07-20 entry in [PRODUCT_DECISIONS.md](./PRODUCT_DECISIONS.md)

## Headline assessment

The implementation was substantially more mature than its own documentation: production RAG
(hybrid pgvector + FTS with RRF and chunk citations), gating red-team CI evals, FERPA-aware
local/cloud provider routing, a deterministic crisis safety net, scrypt auth with Postgres RLS
defense-in-depth. The consistent weak spot was the **verification/truth layer** — orientation,
goals, and certifications were self-attested; failed AI extractions vanished silently; crisis
alerts pointed at transcripts nobody could open; and there was no student-data lifecycle.
This session repaired all 20 verified findings below.

## Findings and repairs (all shipped this session unless marked deferred)

### Sage / AI layer
| Finding | Repair |
|---|---|
| No Gemini `safetySettings` — default filters could block crisis-coaching replies | Explicit BLOCK_ONLY_HIGH on every generation path; wire-level tests |
| Failed extractions silently lost (TODOs at `goal-extractor.ts:114`, `retry.ts:52`) | `FailedExtraction` dead-letter table; goal/discovery/mood/classroom extractors persist; teacher review + replay UI at `/teacher/failed-extractions` |
| No retry on the cloud chat turn | Transient-failure retry (429/5xx/network), pre-first-token only on streams |
| No prompt versioning | `SAGE_PROMPT_REVISION` stamped on every LlmCallLog row + AI audit event; printed in eval CI |
| Stale skill docs and red-team fixtures (Gemini 2.5 / 211 / "RAG is future"; retired personality string) | All re-pointed at verified current behavior |
| ~5 background model calls/turn, no budget | Priority plan (mood/wellbeing exempt and first) + opt-in `SAGE_POST_RESPONSE_MAX_CALLS` cap + per-turn summary log |
| Message-count history truncation | Token-budget-aware trimming (compact 3000 / full 12000), summary + newest 2 always survive |
| RAG corpus thin (50/513 docs embedded) | **Deferred** — content triage is human work (see Deferred) |

### Student workflow & orientation
| Finding | Repair |
|---|---|
| Welcome flow completed signature-required items via "I've read this" — forms never signed | Quick-wins exclude signature items; API rejects student completions missing signed submissions; dry-run backfill script re-opens past bypasses with staff alerts |
| Instructor-led orientation steps (TABE, screenings) honor-system one-click | `pending_verification` state → intervention-queue entry → teacher confirm/decline in ProgressTab; students advance unblocked ("waiting on your instructor") |
| `/api/orientation/complete` awarded Onboarded + 75 XP unconditionally | Now refuses until every required item is complete |
| Orientation completion-flag desync (`allAlreadyDone` never synced; failures swallowed) | Shared idempotent sync on both paths with a retry notice |
| Sage `submit_form` tool bypassed completion rules via raw upsert | Routed through the shared `applyStudentOrientationCompletion` helper |
| Students could self-confirm Sage-proposed goals; nothing nudged confirmation | Self-confirm 403s; `goal_unconfirmed` alert at 7d (high at 14d); "Confirm this goal with your coach" next-step; awaiting-confirmation badge |
| Discovery completion gated solely on the LLM extractor | Audited teacher override endpoint + OverviewTab action + stall nudge after 10 assistant turns |
| Certs/applications self-reported with no provenance | `verificationStatus` on Certification/Application; Sage tools and student routes stamp `self_reported`; audited teacher verify; grant-KPI/outcomes/CSV split verified vs self-reported |
| Classic dashboard past its "one release" window; no mood capture on home | `/dashboard/classic` → redirect; ambient daily mood check-in card (1–10 scale, low scores trigger the wellbeing safety net) |

### Instructor monitoring
| Finding | Repair |
|---|---|
| Crisis alerts said "open their conversation" but no transcript viewer exists | Structured crisis context card (category — never message text — time, recent mood, 988 response checklist) rendered across teacher surfaces; copy fixed. **Owner decision: card only, no transcript access** |
| Crisis notifications fanned out to ALL teachers | Routed to assigned class instructors; zero-resolution or any failure falls back to all active teachers (never narrower) |
| Staff reads of student data unaudited | `recordStudentView` — 1 audit row per teacher/student/surface/day on the student-detail surface |
| Crisis detection English-only | Spanish patterns (17, accent-robust) + Spanish red-team fixtures |

### Security & data protection
| Finding | Repair |
|---|---|
| Unscoped staff where-clause relied on RLS role collapse (flagged fragile in-code) | Coordinators fail closed in `buildManagedStudentWhere` itself; tripwire tests added; admin/teacher semantics unchanged |
| Six AI endpoints without rate limits | DB-backed per-user limits on propose-goal, insights, panel/refresh, mood, chat/upload, slash-commands |
| No data lifecycle | `docs/DATA_RETENTION_POLICY.md` (durations pending OWNER-CONFIRM) + admin-only offboarding (export bundle → deactivate → sessionVersion bump → `offboardedAt`), audited |
| Validation standard drift (Zod vs hand-rolled) | Convention codified in `.claude/rules/api-conventions.md`; routes touched this session use Zod |

## Verification

Per-item unit/route tests were written alongside every change (≈250 new tests). Full gate at
session end: `npm test`, `npx tsc --noEmit`, `npx eslint .`, `npx prisma validate`,
`npm run build`. Known pre-existing failure (not introduced here): `forms-delivery.test.ts`
"stages a bundled PDF" fails in this worktree (missing bundled PDF assets / tsx CLI probe) —
reproduces on the clean tree.

## Schema changes (migrations authored, applied on next deploy — NOT run tonight)

1. `20260720120000_add_prompt_revision` — `LlmCallLog.promptRevision`
2. `20260720121000_add_student_offboarded_at` — `Student.offboardedAt`
3. `20260720122000_add_orientation_verification` — `OrientationProgress.verificationStatus/verifiedBy/verifiedAt`
4. `20260720123000_add_outcome_verification` — same triplet on `Certification` + `Application`
5. `20260720124000_add_failed_extraction` — `FailedExtraction` table (RLS-protected staff surface)

All additive; `prisma migrate deploy` runs them on the next Render deploy.

## Needs owner action (morning list)

1. **Run the signature backfill**: `node scripts/backfill-unsigned-orientation-items.mjs` (dry-run) against prod, review output, re-run with `--apply`. Students who bypassed signatures get re-opened items + staff alerts.
2. **Confirm retention durations** in [DATA_RETENTION_POLICY.md](./DATA_RETENTION_POLICY.md) (every `OWNER-CONFIRM` marker) — TANF/SNAP grant record-retention rules needed from the program side.
3. **Product call**: "Sign Authorization for Release of Information" now ends in pending-verification even after digital signatures, because its `ai-data-consent` companion form has no PDF and can't be collected digitally. Either exempt it or supply the missing document.
4. **Schema decision**: should `StudentSavedJob` (the Sage `update_application_status` target) also carry verification fields? Reports count `Application`, which is covered.
5. **Nav link**: `/teacher/failed-extractions` is reachable by URL only; add to teacher nav if wanted.
6. **Optional flag**: set `SAGE_POST_RESPONSE_MAX_CALLS` after reviewing `sage.post_response.summary` logs (default off = unchanged behavior).

## Deliberately deferred (framework discipline — manual first)

- Automated retention purge (after manual offboarding is proven on real cases)
- DSAR self-serve student export; cascade hard-delete
- Break-glass transcript viewer (only if the crisis card proves insufficient; read-auditing prerequisite is now in place)
- RAG corpus triage: 463 inactive ProgramDocuments need human review before embedding
- Dead-letter replay for non-goal extractors
- Document-surface consolidation (`/files` vs `/resources` vs Learning Resource Center) — product-shaping UX decision
- Cohort/longitudinal analytics — build on the new verified-outcome data once it matures
