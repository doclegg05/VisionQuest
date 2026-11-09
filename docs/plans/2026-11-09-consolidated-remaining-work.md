# VisionQuest consolidated remaining-work plan

Status: **Consolidated planning baseline, 2026-11-09.** This replaces the active task lists in the 18 documents below. It does not approve proposed features or authorize application changes, external configuration, spending, deployment, branch deletion, or data cleanup.

**Scope: the 18 plan documents only.** Open Items in [`.claude/MEMORY.md`](../../.claude/MEMORY.md) remain the list for everything else (for example the `IntakeClient.tsx` split, the scrape-retry bug, staff Sage alert ranking and HIG Phase 3). That list points here for plan work, and this plan does not repeat it.

Reviewed against local commit `a6157fc7` with three independent subagent reviews (design/delivered features, product/jobs, AI/operations), followed by primary-agent reconciliation. No live accounts, database, hosted configuration, workflow runs or deployed behavior were inspected. “Delivered” below means merged repository implementation; production acceptance is separate.

## Authority and scope

[Product decisions](../PRODUCT_DECISIONS.md) govern scope. [Product guide](../PRODUCT_GUIDE.md) and the [executed charter](2026-08-19-what-better-means-charter.md#execution-status-2026-08-20) retain their product-reference role. Specs and operating runbooks remain references; their historical implementation instructions do not override this plan.

Scope is the 18 documents identified in the preceding open-plan inventory, checked against newer decisions and implementation evidence. This is not a claim that every dated document in the repository was audited. Adjacent September release evidence and the November Microsoft design were consulted to prevent obsolete work from returning.

Britt is the accountable product/operations owner until a replacement is named. The assigned implementer owns technical delivery. Before any proposed feature starts, Britt records its approval, owner and outcome; consolidating it here does not supply that approval. Existing approved SPOKES work remains approved.

## Corrections to the earlier inventory

- The August charter was approved on August 20 and Phases 1–5 shipped in #158 (`c21189a3`). Its DRAFT label is not evidence that execution never happened.
- The October 8 model decision and #221 (`b19c7899`) supersede selecting separate models per role. Evaluate the selected Gemma 4 12B configuration; do not restart a broad bake-off.
- Mac relay chat shipped in #273 (`9f13547c`) and subsequent fixes. OpenRouter is an evaluation provider, not the current production-chat implementation. The deployment-wide cloud fence must remain intact. Current relay availability is unverified.
- #247 (`1613be25`) implemented alert-sync/job scraping scheduling; `e4dc5b47` removed the unused reports route. Those are no longer three unscheduled-route build tasks.
- September RAG/answer-quality release and observation completed in #213/#214; see the [execution report](../audits/2026-09-10-sage-sprint-execution.md). Do not reopen old corpus backfill counts as current defects.
- Free employer feeds restored local job search in #289 (`52d8dc24`); CareerOneStop credentials are not a prerequisite for all useful local jobs.
- The November organization decision supersedes the coordinator freeze. Phase 1 code shipped in #290; Microsoft sign-in and later integration phases did not.

## Source disposition register

Every source remains at its existing URL for provenance and inbound links. Its new notice retires its standalone execution queue. “Deferred” means excluded from the build sequence until reopened, not rejected forever. “Complete” does not assert current hosted health.

| Source | Disposition and surviving destination |
| --- | --- |
| [SPOKES design system](../superpowers/plans/2026-10-15-spokes-design-system.md) | Partly delivered: PR1 #239 (`3999bf38`); PR2–4 become W2. |
| [Production OpenRouter](../superpowers/plans/2026-10-15-production-openrouter.md) | Deferred under current local-only operation; future decision D6 only. |
| [Dashboard data/live updates](2026-09-10-dashboard-data-and-live-updates.md) | Proposed; narrowed factual-state and propagation work in W3/W5. |
| [Persistent jobs/discovery](2026-09-10-persistent-jobs-and-discovery.md) | Proposed; persistence first in W4; gesture breadth deferred. |
| [Ouroboros](self-improving-loop-architecture.md) | Deferred; ten locked historical PM decisions preserved, but June baseline is stale. D7 requires a new feasibility review before implementation. |
| [What better means charter](2026-08-19-what-better-means-charter.md) | Executed product reference; retain only evidence revalidation in W1, not another Phases 1–5 build. |
| [Grant KPI trend](2026-10-16-grant-kpi-trend-writer.md) | Open semantic/population decision D4; implementation W7 after decision. |
| [Unscheduled internal routes](2026-10-15-unscheduled-internal-routes.md) | Mostly delivered; live verification W1 and browse-pool decision D3/W7 remain. |
| [Resume drives Career](2026-09-07-resume-drives-career-tab.md) | Decision memo; existing ranking retained, unimplemented delta in D2/W6. |
| [NLx/MACC research](2026-09-04-nlx-macc-job-search-research.md) | Historical research: option 1 selected, brokering shipped #204 (`666877ba`); credentials/program rules remain D5. |
| [Per-role local models](2026-08-21-local-ai-role-models.md) | Selection strategy superseded by October decision; selected-model acceptance W1. |
| [Loose-ends sprint](2026-09-08-loose-ends-sprint.md) | Expired schedule retired; RAG release complete, selected-model/cron verification W1. |
| [OpenRouter test bench](../superpowers/plans/2026-10-13-openrouter-test-bench.md) | Implementation delivered #234 (`bdfe50ec`); retain synthetic-only runbook and operational limits W1. |
| [One intervention queue](../superpowers/plans/2026-10-15-one-intervention-queue.md) | Implementation delivered #249 (`ddb47c01`); urgent report fixed `6114eb1a`; field acceptance W1. |
| [Cohort demo access](../superpowers/plans/2026-10-19-cohort-demo-access.md) | Delivered #268/#271 (`6196d655`, `829526d5`); dated shutdown W9. |
| [Process optimizations](../superpowers/plans/2026-10-21-process-optimizations.md) | Code delivered #269 (`62b518f8`); operator closure W1, privacy gate D8; median gate remains conditional. |
| [Pre-demo refinement](../superpowers/plans/2026-10-26-pre-demo-refinement.md) | Code delivered #288 (`2583733a`); release acceptance W0; specific residuals must be reproduced first. |
| [Organization tree Phase 1](../superpowers/plans/2026-11-06-org-tree-phase-1.md) | Code delivered #290 (`a6157fc7`); release gate W0, successor scope W8. |

## Execution order and gates

| Order | Work | Scope status | Dependency | Accountable owner |
| --- | --- | --- | --- | --- |
| 0 | W0: establish release/access baseline | Verification required before rollout | Current refs and authorized environment access | Britt/operator |
| 1 | W1: operational and model acceptance | Verify existing behavior; configuration changes separately authorized | W0 for deployed tests | Britt/operator + implementer |
| 2 | W2: finish SPOKES PR2, then PR3, then PR4 | Previously approved | Current source baseline; production rollout waits W0 | Britt/design acceptance + implementer |
| 3a | W3a: Credly badges bound to the account | Defect fix; needs no decision | None | Implementer |
| 3 | W3: factual records | Proposed; approve bounded slice | D1 | Britt + implementer |
| 4 | W4: durable job preferences | Proposed | D1; existing persistence inventory from W3 | Britt + implementer |
| 5 | W5: reliable dashboard propagation | Proposed | W3; W4 writers for job coverage | Britt + implementer |
| 6 | W6: resume-to-Connect delta | Decision-gated | D2; W4 if changing discovery identity | Britt + implementer |
| 7 | W7: browse-pool and grant trend decisions | Decision-gated independent slices | D3/D4; W0 scope baseline | Britt + implementer |
| 8 | W8: Microsoft successor work | New phase plan required | Accepted organization Phase 1; app-specific approvals | Britt/IT + implementer |
| Date gate | W9: demo closeout after December 18 | Existing approved lifecycle | Confirm actual current switches/session behavior | Britt/operator |

W2 and approved planning/spikes for W3/W4 may run independently of owner-only operational inputs. No credential or policy gate blocks unrelated work. Do not merge unrelated streams into one large implementation PR.

### W0: Release and access baseline

Record current branch/main/deployed SHAs, pending migrations and release identity before treating #288/#290 as deployed. Follow [deployment guidance](../../DEPLOY.md) and the [organization design](../superpowers/specs/2026-11-06-microsoft-365-and-org-tree-design.md). Run the counts-only `scripts/org-tree-preflight.mjs` before a narrowing rollout; resolve unplaced staff/classes without dropping access. Review the out-of-order `20260903120000_add_student_must_change_password` migration against the actual ledger; never rename applied migrations.

Acceptance: dated evidence covers instructor own-class access, regional/state coordinator scope, admin behavior, invitation acceptance and denial paths, coordinator transcript/derived-content restrictions, old dev-login session revocation, Linux/build and RLS parity. [Dashboard implementation notes](../dashboard-implementation.md) currently distinguish local evidence from these release checks. Reproduce any carried pre-demo residual before making it a new fix; stale issue text is not a defect demonstration.

Recovery: capture previous deployed SHA/config and migration-compatible rollback before release. Preserve data and resolve placement exceptions before restricting access. This plan performs no deployment.

### W1: Close operational evidence gaps

Use the current [Mac Sage connection runbook](../runbooks/mac-sage-connection.md), [local embedding runbook](../runbooks/embeddinggemma-2-local.md) and [test-bench runbook](../runbooks/openrouter-test-bench.md).

Each line has one owner. The evidence checklist at [`docs/audits/2026-11-09-ops-evidence-checklist.md`](../audits/2026-11-09-ops-evidence-checklist.md) holds the commands and a result column for each.

**Mac host and Sage (Britt, at the host)**
- [ ] Record the relay, fence and model in effect, plus the chip, RAM, runtime, context and output caps, and concurrency.
- [ ] With fictional accounts, test student and staff chat, a permitted tool continuation, durable memory, disconnect then fail-closed then reconnect, and cold and warm time to first text.
- [ ] Check the provider-mix and accountability report against actual call routing. Configuration alone does not prove enforcement, and a local synthetic pass does not prove hosted acceptance.

**Selected model (implementer, on the host Britt names)**
- [ ] Evaluate the selected 12B model with the real runtime prompts: tools, safety, grounded and ungrounded answers, classroom concurrency. Each artifact names the SHA, prompt revision, protocol, model and host settings. Empty answers and unsupported claims count as failures. Label the original and corrected benchmark protocols separately. Do not run a broad model selection or per-role setup.

**Scheduled jobs and the queue (Britt with production access)**
- [ ] Check pg_cron registration, recent outcomes and health for each expected job, including weekly memory consolidation and evidence-gap detection. Do not create duplicate schedules.
- [ ] Time an instructor finding and acting on priority students from a cold queue. Target: under five minutes. Check the action panel and focus at phone width.

**Process owner steps (Britt)**
- [ ] O1 to O7 from current evidence: the Cron Health secret and a real run, benchmark result-PR permission, the evaluation spend cap, the branch-manifest review, hook activation.
- [ ] Never apply the old branch-cleanup manifest without rechecking each branch tip and keeping unique work.
- [ ] Median gating (Task 7) stays on hold unless unrelated flakiness returns and Britt approves. Privacy-leak gating is D8, a separate question.

**Charter obligations (Britt)**
- [ ] Re-check the restore drill and Storage recovery, consent and retention, corpus disposition, the briefing enable and soak, the reading ceiling, and concurrency. The CI accessibility and freshness checks already shipped; measure open violations before opening fixes.

Acceptance: a dated evidence checklist marks each item verified, failed or unavailable, with its owner and next action. Do not infer current health from old run results. Preserve the cloud fence; embeddings/index migration remain a separately approved activation with backup and rollback. Restore previous settings or disable the affected optional feature if verification fails; never weaken safety gates to pass.

### W2: Finish the approved SPOKES rollout

Retain PR2 student sweep → PR3 remaining sweep → PR4 polish, in order. PR1 tokens are already delivered. Re-measure current files before adapting old codemods. `SPOKES_UNSWEPT` in `eslint.config.mjs`, old page-header decorations/static-card hover in `globals.css`, and fill-token text in `InterventionQueuePanel.tsx`/`UpcomingAppointments.tsx` confirm remaining work. The gold-focus/green-button/teal issues in the external source artifact require a fresh artifact check; local code does not prove their current external state.

Acceptance: no unreviewed unswept exceptions; both themes meet contrast requirements, controls remain at least 44px, text at least 13px, reduced motion works, no phone overflow, Sage prompts unchanged, and visual review approves representative student/staff/empty/error states. Remove warning exemptions only after their surfaces pass. Required lint/type/build and relevant accessibility checks accompany each slice. Revert the individual UI slice if accessibility or workflow behavior regresses.

### W3: Define record truth and fix account-bound credential state

After D1, inventory existing domain writers/readers and agree pending versus verified counts and reviewed-version behavior; do not create a second student database. Prove a fictional student's records explain both student and staff counts. Reject stale evidence reviews visibly.

**W3a, the Credly fix, is a defect and ships without D1.** `src/app/api/settings/credly/route.ts` changes the username but leaves `credlyBadgesCache` in place, and `src/app/api/credly/badges/route.ts` serves that cache for 24 hours. So after a username change the page shows the old account's badges under the new name. When Credly fails, the route returns an empty list and caches it for 10 minutes, so an outage reads as "no badges". Clear or bind the cache to the username, and tell upstream failure apart from an empty result. Verify connector entitlements and mappings before automatic certification credit; import remains reviewable.

Acceptance: refresh/logout/second session preserve records; account replacement/deletion never displays prior-account badges; failed imports grant no credit; retry is safe. Use additive migrations if needed, retain prior records and keep a manual refresh/review path for recovery.

### W4: Durable saved and hidden jobs before gesture polish

Current `StudentSavedJob` points only to class `JobListing`, cascades on listing deletion, and `src/app/api/jobs/save/route.ts` rejects browse saves. Generic dismissal fields elsewhere are not job dismissal.

Choose a bounded additive vacancy identity/snapshot and preference design covering class and browse listings, with per-student dismissal and restore. Preserve notes, application status/dates and provenance. Audit multi-class access rather than retaining the first-enrollment assumption. Distinguish lack of interest from withdrawing an application. Do not use the broad display-deduplication key as permanent vacancy identity.

Acceptance: saves/hidden choices survive refresh, second device, listing expiry/pruning, reimport and class transfer within current authorization; the same vacancy stays hidden while distinct requisitions remain visible. Accessible buttons work before optional swipe UI. Migrate existing saves without destructive cascades; rollback disables new discovery affordances while preserving preferences/history.

### W5: Reliable propagation with a recovery path

Reuse agreed records and selectors from W3. Existing notification SSE (`src/lib/notifications.ts`) uses process memory and is not durable dashboard synchronization. Prove a scoped revision/transport spike before choosing common SSE, polling or another mechanism. Avoid prescribing infrastructure before the contract is proven.

Acceptance: two authorized sessions converge after duplicate, reordered or lost updates and reconnect; refresh recovers missed state; scope/role changes cannot deliver another class or student's records; saving works when streaming is disabled. UI distinguishes saved, pending and failed extraction/review. Disable the transport independently if needed; persisted writes and manual refresh remain functional.

### W6: Resume delta after owner decisions

Resume already feeds ranking. Add only proven missing signal: Connect's two matching paths currently omit resume certificate names and past titles. Resolve D2 before changing profile writes or discovery queries. Never fabricate RIASEC, ZIP or experience facts.

Acceptance: matching benchmarks show the agreed benefit without hard-block regression; provenance is explicit, stored settings require the approved confirmation, and query expansion affects only adapters consuming it. Resolve the contradictory proposal to retain all 16 existing titles while adding more within a 16-title cap. Keep prior ranking/config available for rollback.

### W7: Two small independent maintenance streams

Browse pool: after D3, retain manual operation, curate useful sources, or remove the pool. Preserve explicit Local/Remote/All and no-configuration fallback semantics. If scheduling is selected, measure runtime, expiry and failure visibility first. Current Greenhouse/Lever/Ashby/SmartRecruiters source coverage is a source-fit question; free local employer feeds already exist.

Grant trend: after D4, choose computed history or frozen reporting snapshots, then implement one path against current instructor/regional/program/admin scopes. The snapshot handler exists but has no enqueue caller; live snapshot rows are unknown. The old empty-roster card leak is already fixed, so do not reopen it.

Acceptance: card/chart/drill-down use the same authorized population; zero-roster, multi-class deduplication and region/state isolation pass. Computed history is labeled reconstructed from current records; snapshots require idempotent uniqueness, scheduling and health. Inspect and preserve existing snapshots before any table retirement. Roll back the reader/scheduler without destroying reporting history.

### W8: Plan the Microsoft successor separately

The [November design](../superpowers/specs/2026-11-06-microsoft-365-and-org-tree-design.md) contains undelivered Phase2 staff Microsoft identity, Phase3 connection foundation and app integrations, Phase4 provider/experimental Copilot work, and a coordinator-results dashboard requiring its own design. Adopted organization decisions are not blanket approval of every later expansion.

Prepare a bounded Phase2 plan after W0 accepts Phase1; preserve student sign-in. App integrations follow the connection foundation and individual scope/data approvals. Personal-account tests do not establish organization-tenant consent, Conditional Access or IT readiness. Target demo date is December 18, not a promise of tenant activation. Feature switches stay off until accepted; disabling a connector must preserve staff access and existing records.

### W9: Close the cohort demo after December 18

**The local-only AI fence is tied to the demo switch.** `isDemoLocalOnlyRequired()` in `src/lib/ai/demo-local-only.ts` is true while `COHORT_DEMO_MODE` is on, or when `VQ_MAC_RELAY_ENABLED=true` or `COHORT_DEMO_LOCAL_ONLY=true`. Deleting `COHORT_DEMO_MODE` alone turns cloud inference back on. Do these steps in this order:

1. In Render, set `COHORT_DEMO_LOCAL_ONLY=true` (or confirm `VQ_MAC_RELAY_ENABLED=true` is set), and deploy.
2. Confirm cloud calls are still refused: a Sage turn with the local host stopped must fail closed, not answer from a cloud model.
3. Delete `COHORT_DEMO_MODE` in Render and deploy.
4. Repeat step 2.

Then confirm the session behavior, disable demo entry under the existing lifecycle decision, and verify regular staff-created-account entry and rejection of continued demo access. Keep independent local-only/provider policy intact. Demo-row archive/deletion and shared-roster reset are separate explicit operations; do not rerun them from stale checkboxes. Record the result and recovery settings without exposing credentials.

## Decision register

| ID | Owner decision needed | Default until resolved |
| --- | --- | --- |
| D1 | Approve narrowed W3–W5 scope, accountable owner and success metric; prioritize correctness/persistence before gestures or live transport. | Proposed only; no implementation authorization inferred. |
| D2 | Resolve resume memo D1–D4: live derivation versus confirmed settings; whether to write Career DNA; experience-level use; keyword/title budget. | Retain existing ranking; no silent new profile writes. |
| D3 | Browse-pool purpose: curated SPOKES sources, manual retention, or removal. | Keep current manual behavior; no new schedule. |
| D4 | Grant trend: reconstructed current-state trend versus immutable reported snapshots; population including/excluding unlinked referrals. | No new writer job; preserve snapshot data and role boundaries. |
| D5 | Obtain COS credentials if desired; confirm MACC program/reporting obligations from authoritative sources. | Existing student-reported results and employer feeds remain usable; no claim of verified assessment or reporting integration. |
| D6 | Explicitly reopen future cloud chat adoption, reconcile FERPA/provider approval and deployment-wide fence, and separate embedding identity/index recovery. | Production OpenRouter deferred; no key/config change or cloud fail-open. Recheck provider contracts when reopened. |
| D7 | Reopen Ouroboros feasibility against current architecture and locked PM decisions, with a manual baseline, correction cost, stop condition and containment. | Excluded from execution; historical decisions are preserved, not expanded into autonomy authorization. |
| D8 | Should any nonzero privacy leak fail the memory evaluation? Implement separately if approved; median voting is a different conditional choice. | Do not claim the current duplicate/hit-rate grader enforces printed leak counts. |

## Completion and maintenance

A work item closes only with evidence matched to its claim: code and local gates for implementation, actual executions for operations, user observation for usability, deployed SHA/config for release. Mark unavailable dependencies explicitly. Store sanitized evidence under `docs/audits/` with date/config/revision and a short recovery record. Completed implementation checkboxes are not a reason to skip production acceptance; unticked historical checkboxes are not a reason to rebuild.

This consolidation is complete when all 18 sources have retirement notices, source links resolve and the register accounts for every previously listed plan. It does not mean W0–W9 have been executed. No application tests are required for this documentation-only consolidation; verify links and the diff.
