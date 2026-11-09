# Record-truth inventory (W3)

Date: 2026-11-09. Branch: `docs/consolidated-remaining-work`.
Plan reference: `docs/plans/2026-11-09-consolidated-remaining-work.md`, section W3.

This is a read-only inventory of the code in `src/`. It lists, for each student record type a dashboard counts, who writes it, who reads it for a count, and which states each reader treats as done. No database was queried and no code was changed. Every row cites a file and line that was read on this date. Line numbers will drift; the file names are the stable part.

The last section, "Proposed definitions", is a proposal. It needs Britt's agreement (decision D1) before anyone builds on it.

## How to read the tables

- "Writer" means code that creates or updates a row of that model.
- "Reader" means code that turns rows into a number shown on a student or staff screen, or that feeds such a number.
- "Counts as done" is the filter the reader applies. If a reader applies none, the table says "all rows".

## 1. Goals

Model: `Goal` (`prisma/schema.prisma:249`). Status is a free string. The allowed set is `proposed, active, in_progress, confirmed, blocked, completed, abandoned` (`src/lib/goals.ts:12-21`). Review state is `confirmedAt` and `confirmedBy`, not a status.

| Role | Location | Detail |
| --- | --- | --- |
| Writer | `src/app/api/goals/route.ts:89` | Student creates a goal. Status comes from the request body and defaults to `active` (line 56). Any valid status except `proposed` is accepted (lines 71-77), including `completed`. No `confirmedAt` is set. |
| Writer | `src/lib/sage/propose-goal.ts:106` | Sage creates a goal with status `proposed` (line 25 sets the constant, line 111 uses it). |
| Writer | `src/app/api/teacher/students/[id]/goals/[goalId]/route.ts:87` | Staff update. |
| Writer | `src/lib/goals/transition-goal-status.ts:233` | Shared status transition. A confirming change sets `confirmedAt` and `confirmedBy` (lines 194-198). |
| Writer | `src/lib/demo/bootstrap.ts:153` | Demo seed only. |
| Reader | `src/app/(student)/layout.tsx:32` | Nav phase. Counts `status in GOAL_PLANNING_STATUSES` (active, in_progress, confirmed, blocked, completed; `src/lib/goals.ts:23-29`). |
| Reader | `src/app/(student)/dashboard/page.tsx:27` | Same filter. Used to decide the welcome redirect. |
| Reader | `src/lib/teacher/dashboard.ts:377` | Staff roster `goalsCount`. Same planning set, applied in memory through `goalCountsTowardPlan`. |
| Reader | `src/lib/progression/student-next-step.ts:343-370` | Next-step engine. Planning set, monthly planning set, unconfirmed proposals, and completed weekly/daily/task goals. |
| Reader | `src/lib/dashboard/readers.ts:24` | Student "Learning" detail: confirmed goals linked to an active pathway. Requires `confirmedAt` not null, status not `abandoned` or `proposed`, and `pathway.active`. |
| Reader | `src/lib/progression/fetch-readiness-data.ts:35-38` and `:106-110` | Readiness. A goal at level `bhag` with status `completed` sets `bhagCompleted`. No confirmation check. |
| Reader | `src/app/api/teacher/classes/[id]/readiness-check/route.ts:56-62` | Class readiness. Planning set with no pathway. |
| Reader | `src/lib/sage/coaching-arcs.ts:297` | Coaching arc. Weekly goal count. |

## 2. Certifications and requirements

Models: `Certification` (`prisma/schema.prisma:511`), `CertRequirement` (`:532`), `CertTemplate` (`:550`).

There are two levels of state.

- Requirement level: `completed` plus `verifiedBy`/`verifiedAt`. A template can set `needsFile` and `needsVerify` (`:550-562`).
- Certification level: `status` (`in_progress` or `completed`) and a separate `verificationStatus` (`null`, `self_reported`, `verified`; comment at `:518-520`).

`Certification.status` is derived. `recomputeCertificationStatus` sets `completed` only when every required template is satisfied, and "satisfied" includes the file and verifier rules (`src/lib/certification-service.ts:61-64`, `src/lib/certifications.ts:66-75`).

| Role | Location | Detail |
| --- | --- | --- |
| Writer | `src/app/api/certifications/route.ts:70` | Creates the checklist from templates. |
| Writer | `src/app/api/certifications/route.ts:224` | Student marks a requirement complete or incomplete. |
| Writer | `src/app/api/certifications/route.ts:232` | Stamps the parent `verificationStatus = self_reported` and clears the verifier (lines 229-240). |
| Writer | `src/lib/sage/cert-actions.ts:149` and `:162` | Sage path. Same two writes, including the `self_reported` stamp. |
| Writer | `src/app/api/portfolio/route.ts:137` | Adding a portfolio item can mark a linked requirement complete (lines 123-145). It does not stamp `self_reported` and does not clear `verifiedBy`. |
| Writer | `src/app/api/teacher/certifications/route.ts:210` | Staff verify or unverify a requirement (`verifiedBy`, `verifiedAt`). |
| Writer | `src/app/api/teacher/certifications/route.ts:138` and `:302` | Template create and delete cascade to requirements. |
| Writer | `src/app/api/teacher/outcomes/verify/route.ts:61` | Staff set the parent `verificationStatus` to `verified` or back to `self_reported`. |
| Writer | `src/lib/certification-service.ts:46` and `:83` | Adds missing requirement rows. Recomputes `status` and `completedAt`. |
| Reader | `src/lib/progression/fetch-readiness-data.ts:39` and `:111-115` | Student readiness. Counts `Certification.status = "completed"`. |
| Reader | `src/lib/teacher/readiness-snapshot.ts:56-59` | Readiness takes `max(progression counter, DB count)`. The counter is an XP-ledger value written by `awardEvent` (`src/app/api/certifications/route.ts:248`). |
| Reader | `src/lib/teacher/dashboard.ts:270-277`, `:388-394` | Staff roster. Reads `certifications[0]` with no `certType` filter or order. `certDone` uses `getCertificationProgress`, so it requires file and verifier where the template says so. `certPendingVerify` counts requirements that are `completed` and have no `verifiedBy`. |
| Reader | `src/lib/dashboard/readers.ts:27-34` | Student "Learning" and "Ready-to-Work" lines. Completed count, verified count (`verificationStatus = verified`), and "completed with no verification record" (`verificationStatus = null`). "Awaiting instructor review" counts `completed && !verifiedBy` and also requires `template.needsVerify`. |
| Reader | `src/app/api/teacher/certifications/route.ts:81` | Staff certifications page. `pendingVerify` counts `completed && !verifiedBy`, with no `needsVerify` check. |
| Reader | `src/lib/instructor-metrics.ts:68-76` | Instructor report. Started and `status = completed`, by window. No verification filter. |
| Reader | `src/lib/grant-metrics.ts:96-98` | Grant "certifications" actual. `status = completed`, by window, no verification filter. |
| Reader | `src/lib/grant-metrics.ts:154-157` | Splits the same completed set by `verificationStatus` so it reconciles with the headline. |
| Reader | `src/lib/class-requirement-compliance.ts:77-80` and `:218-220`; `src/lib/evidence-gap-detection.ts:116` | Class requirement compliance and evidence gaps. `status = completed`, keyed by `certType`. |
| Reader | `src/lib/sage/coaching-arcs.ts:253-316` | Coaching arc week 6 counts `status: "complete"` (line 316). |
| Reader | `src/lib/connect/packet.ts:183`, `connections.ts:433`, `matching.ts:231` | Employer packet and matching. Require `status = completed` and `verificationStatus = verified`. |

## 3. Orientation items and forms

Models: `OrientationItem` (`prisma/schema.prisma:324`), `OrientationProgress` (`:338`), `FormSubmission` (`:1516`), and the structured-form model `FormResponse` (status default `draft`, around `:1587`).

Orientation progress has `completed` plus an optional `verificationStatus` (`null`, `pending`, `verified`, `declined`; comment at `:345-346`). A pending claim is stored with `completed = false` (`src/lib/orientation-completion.ts:87-97`), so any reader that filters on `completed: true` excludes pending claims.

`FormSubmission.status` is written as `pending` (sign and upload) and then `approved` or `rejected` (staff review). `FormResponse.status` is `draft`, `submitted`, `reviewed`, or `needs_changes` (`src/app/(student)/forms/[templateId]/FormFillClient.tsx:23`).

| Role | Location | Detail |
| --- | --- | --- |
| Writer | `src/lib/orientation-completion.ts:87` | Student claim on an honor-system item: `completed=false`, `verificationStatus=pending`. |
| Writer | `src/lib/orientation-completion.ts:103` | Student completion on other items: `completed=true`, verification cleared. |
| Writer | `src/app/api/orientation/route.ts:87`, `:106`, `:143` | Student un-mark, staff decline (`declined`), staff complete (`verified` for honor-system items or on request). |
| Writer | `src/app/api/orientation/welcome-video/route.ts:30` | Marks the welcome-video item complete. |
| Writer | `src/lib/intake/provision.ts:509`, `:515` | Intake bundle creates rows, `pending` when the student attested. |
| Writer | `src/app/api/teacher/orientation/route.ts:99` | Item delete cascades to progress rows. |
| Writer | `src/app/api/forms/sign/route.ts:106`, `src/app/api/forms/upload/route.ts:84` | `FormSubmission` upsert with `status = pending`. Both clear the reviewer. |
| Writer | `src/app/api/teacher/students/[id]/forms/route.ts:163` | Staff review: `approved` or `rejected` (schema at line 57). |
| Writer | `src/lib/intake/pdf-stamped-packet.ts:1081`, `:1127` | Anonymous intake flow writes both models. |
| Writer | `src/app/api/student/forms/[templateId]/route.ts:121`, `.../submit/route.ts:64`, `src/app/api/teacher/forms/responses/[id]/route.ts:76` | `FormResponse` draft, submit, review. |
| Reader | `src/app/(student)/layout.tsx:34`, `src/lib/progression/fetch-readiness-data.ts:33` and `:100-104` | Student orientation done. `completed: true`. |
| Reader | `src/lib/teacher/dashboard.ts:266-268`, `:432` | Staff orientation done. `completed: true`. Same filter as the student. |
| Reader | `src/lib/class-progress.ts:35-45` | Class average. `completed: true` over all items. |
| Reader | `src/lib/progression/fetch-readiness-data.ts:34`, `src/lib/class-progress.ts:35`, `src/lib/teacher/dashboard.ts:339` | Orientation total is `orientationItem.count()` with no `required` filter. |
| Reader | `src/lib/teacher/readiness-snapshot.ts:44-47` | `orientationComplete` when `completed >= total` over those totals, or when the sticky flag in progression state is already set. |
| Reader | `src/app/api/orientation/complete/route.ts:29-41` | Completion gate. Only `required: true` items, `completed: true`. |
| Reader | `src/app/api/orientation/route.ts:74-77` | Student list. `pendingVerification` counts `!completed && verificationStatus = pending`. |
| Reader | `src/lib/orientation-completion.ts:42-47` | Signature guard. A form counts as signed if `signatureFileId` is set or `status = approved`. |
| Reader | `src/app/(student)/dashboard/page.tsx:54-56` | Intake banner. Any `FormSubmission` row for the two intake form ids clears it. |
| Reader | `src/lib/teacher/dashboard.ts:446-452` | Staff intake status. `approved` is "certified". Any other status is "needs_review". |
| Reader | `src/lib/class-requirement-compliance.ts:85-89`, `:222-226`; `src/lib/evidence-gap-detection.ts:118-120` | Form requirement met when `status` is `approved` or `submitted`. |
| Reader | `src/lib/instructor-metrics.ts:83-86`, `src/lib/forms/region-rollup.ts:200-204` | `FormResponse` counts: `submitted` or `reviewed`. |

## 4. Portfolio and evidence

Model: `PortfolioItem` (`prisma/schema.prisma:566`). It has no status, reviewer or verification field. Evidence for a certification requirement is the `fileId` on `CertRequirement`, reviewed through the requirement's `verifiedBy` (section 2).

| Role | Location | Detail |
| --- | --- | --- |
| Writer | `src/app/api/portfolio/route.ts:124`, `:219`, `:233` | Create (optionally in the same transaction as a requirement update), update, delete. |
| Writer | `src/lib/sage/agent/write-tools.ts:610`, `:681`, `:724` | Sage create, update, delete. |
| Reader | `src/lib/progression/fetch-readiness-data.ts:40`, `:116-120` | Readiness. All rows. |
| Reader | `src/lib/teacher/dashboard.ts:291`, `:440` | Staff `portfolioItems`. `_count`, all rows. |
| Reader | `src/lib/sage/coaching-arcs.ts:307` | Coaching arc. All rows. |
| Reader | `src/lib/teacher/readiness-snapshot.ts:60-63` | `max(progression counter, DB count)`. |

## 5. Applications and saved jobs

Models: `Application` (`prisma/schema.prisma:1134`) and `StudentSavedJob` (`:2295`). Application status values are `saved, applied, interviewing, offer, rejected, accepted` (`src/lib/constants.ts:20-27`), default `saved`. `verificationStatus` is `null`, `self_reported` or `verified`.

| Role | Location | Detail |
| --- | --- | --- |
| Writer | `src/app/api/applications/route.ts:119` | Student upsert. Every change is stamped `self_reported` and clears the verifier (lines 126-146). |
| Writer | `src/lib/connect/employer-actions.ts:503` | Staff placement. `accepted` and `verified`. |
| Writer | `src/app/api/teacher/outcomes/verify/route.ts:63` | Staff verify or unverify. |
| Writer | `src/app/api/jobs/save/route.ts:102`, `src/lib/sage/agent/write-tools.ts:443`, `:951`, `src/lib/nudges/replies.ts:362` | Saved-job writes. |
| Reader | `src/lib/dashboard/readers.ts:21`, `:38` | Student "Employment": "N applications recorded". All rows, including `saved` and `rejected`. |
| Reader | `src/lib/progression/student-next-step.ts:371-376` | Next step. All saved jobs, all applications. |
| Reader | `src/lib/grant-metrics.ts:113-115` | Grant "placements". `status = accepted`, by `updatedAt`. No verification filter. |
| Reader | `src/lib/placement-bridge.ts:173-177` | Placement queue item. Requires `accepted` and `verified`. |
| Reader | `src/lib/connect/funnel-shared.ts:447-449` | Funnel. Requires `accepted` and `verified`. |

## 6. Credly imports

There is no Credly record type. Badges are fetched from Credly's public profile and cached as JSON on `Student` (`credlyBadgesCache`, `credlyBadgesCachedAt`, `prisma/schema.prisma:22-24`).

| Role | Location | Detail |
| --- | --- | --- |
| Writer | `src/app/api/settings/credly/route.ts:54` | Sets `credlyUsername`. Leaves the badge cache in place. |
| Writer | `src/app/api/settings/credly/route.ts:66` | Clears `credlyUsername`. Leaves the badge cache in place. |
| Writer | `src/app/api/credly/badges/route.ts:109` | Writes the cache after a fetch that returned at least one badge. |
| Reader | `src/app/api/credly/badges/route.ts:70-75` | Serves the cache for 24 hours when it is non-empty, whatever the current username is. |
| Reader | `src/app/api/credly/badges/route.ts:87`, `:91`, `:102-104` | A non-OK response, a malformed body and a thrown error all return `[]`. |

No dashboard count reads Credly data. Nothing converts a badge into a certification, requirement or evidence row. The W3a defect lives in this table: the cache is not tied to the username, and a failed fetch looks the same as no badges.

## Mismatches

Each item states the two definitions and where they differ.

1. **Certifications: the student and staff counts measure different things.**
   - Student readiness counts `Certification.status = completed` (`fetch-readiness-data.ts:39`), then takes the larger of that and the XP counter (`readiness-snapshot.ts:56-59`).
   - The staff roster reads `certifications[0]` (`teacher/dashboard.ts:388`) and counts satisfied required templates for that one row (`:389-391`). The query at `:270-277` has no `certType` filter or order, and `@@unique([studentId, certType])` (`schema.prisma:528`) allows several rows per student.
   - Effect: a student with more than one certification row can show a different "done" figure to staff than to themselves. If staff later remove a verification, the status falls back to `in_progress`, but the XP counter does not fall, so the readiness figure keeps the credit.

2. **"Awaiting verification" has three definitions.**
   - `dashboard/readers.ts:34` counts `completed && !verifiedBy` and requires `template.needsVerify`.
   - `teacher/dashboard.ts:393` counts `completed && !verifiedBy` with no `needsVerify` check.
   - `teacher/certifications/route.ts:81` does the same as the roster.
   - Effect: for a template with `needsVerify = false`, staff screens show a pending review that the student screen does not.

3. **A portfolio attachment can complete a requirement without the self-reported stamp.**
   - `certifications/route.ts:229-240` and `sage/cert-actions.ts:158-169` set `Certification.verificationStatus = self_reported` and clear the verifier whenever a student marks a requirement complete.
   - `portfolio/route.ts:136-145` also sets `completed = true`, then recomputes status (`:151`), but does not stamp or clear.
   - Effect: a certification finished through the portfolio path can keep `verificationStatus = null` or an older `verified`. `grant-metrics.ts:154-170` and `dashboard/readers.ts:29-30` then classify it as legacy or verified when the latest claim is the student's.

4. **A reader that never matches.** `sage/coaching-arcs.ts:316` filters `status: "complete"`. The only writer produces `"completed"` (`certification-service.ts:64`). The week 6 coaching arc cannot see any finished certification.

5. **Form status vocabularies do not match what is written.**
   - `FormSubmission.status` is written as `pending`, `approved`, `rejected` (sections above).
   - `class-requirement-compliance.ts:87` and `:224`, and `evidence-gap-detection.ts:119`, accept `approved` or `submitted`. `submitted` is a `FormResponse` value and is never written to `FormSubmission`.
   - Effect: those readers behave as "approved only". A `pending` upload does not meet the requirement, which is a reasonable rule, but the code reads as if a submitted form counts.
   - The student intake banner (`dashboard/page.tsx:54-56`) clears on any row, including `pending` and `rejected`. Staff treat only `approved` as certified (`teacher/dashboard.ts:451`).
   - The signature guard (`orientation-completion.ts:46`) counts a rejected form as signed if `signatureFileId` is still set. Neither sign nor upload nor review clears it on `rejected` (`teacher/students/[id]/forms/route.ts:163-171`).

6. **Orientation total includes optional items; the completion gate does not.** `orientationItem.count()` is unfiltered (`fetch-readiness-data.ts:34`, `class-progress.ts:35`, `teacher/dashboard.ts:339`), and `readiness-snapshot.ts:44-47` compares against it. The completion gate (`orientation/complete/route.ts:29-41`) uses `required: true` only. If any item is optional, a student can pass the gate while readiness still says orientation is incomplete, and the class average can never reach 100 percent.

7. **Applications "recorded" counts saved and rejected rows.** The label at `dashboard/readers.ts:38` says "applications recorded". The count at `:21` has no status filter, and the default status is `saved` (`schema.prisma:1137`). The next-step engine does the same (`student-next-step.ts:374`).

8. **Placements: the grant figure ignores verification, the queue and funnel require it.** `grant-metrics.ts:113-115` counts `accepted` rows by `updatedAt`. `placement-bridge.ts:173-177` and `funnel-shared.ts:447-449` require `verified` as well. The grant code does split certifications by verification (`:154-170`) but has no equivalent for placements.

9. **Goals: three different "goal" counts.**
   - Student nav and dashboard use the five planning statuses (`layout.tsx:32`, `page.tsx:27`). A goal the student created directly as `active` or `completed` counts, with no `confirmedAt` (`goals/route.ts:56`, `:71-77`, `:89-94`).
   - `dashboard/readers.ts:24` counts only confirmed goals on an active pathway.
   - `fetch-readiness-data.ts:35-38` treats any `completed` BHAG as done, so a student-set `completed` BHAG moves readiness without staff confirmation.
   - Effect: three screens can give three counts for the same student, and a student can reach the BHAG readiness credit without review.

10. **Credly cache is not bound to the account** (W3a). `settings/credly/route.ts:54-56` and `:66-68` change the username only. `credly/badges/route.ts:70-75` serves the cache for 24 hours if it is non-empty. After a username change or removal, the old account's badges are still returned under the new name. Failure and empty both return `[]` (`:87-104`), so an outage looks like "no badges" for the 10-minute cache window.

11. **Portfolio has no review state.** Every portfolio reader counts all rows (section 4). A count labeled as evidence therefore includes unreviewed items. This is a gap in the model, not a disagreement between two readers.

## Proposed definitions (for Britt to agree, decision D1)

This section is a proposal. Nothing here is implemented. The wording is meant to be agreed as plain English first; the code follows.

| Record type | "Pending" means | "Verified" means | The one reader that should own the count |
| --- | --- | --- | --- |
| Goal | A goal with status `proposed`, or any goal with no `confirmedAt`. | A goal with `confirmedAt` set by staff, in status `confirmed`, `in_progress`, `blocked` or `completed`. "Completed" counts as done only if it was confirmed first. | One function next to `GOAL_PLANNING_STATUSES` in `src/lib/goals.ts`, returning `{ pending, verified }`. Student nav, the roster, readiness and the next-step engine call it. |
| Certification | A requirement the student marked complete, still missing a file or a staff verifier where the template asks for one. | A certification whose every required template is satisfied (file and verifier included) and whose `verificationStatus` is `verified`. | The reader behind `getCertificationProgress` plus `recomputeCertificationStatus` in `src/lib/certification-service.ts`. All screens use its "done", "pending review" and "verified" outputs, and the XP counter stops overriding it. |
| Orientation item | An item the student claimed, with `verificationStatus = pending` and `completed = false`. | An item with `completed = true`. For honor-system items that also means `verificationStatus = verified`. Totals use required items only. | One reader in `src/lib/orientation-completion.ts` that returns `{ done, pending, requiredTotal }`. |
| Form (`FormSubmission`) | Status `pending`: uploaded or signed, not yet reviewed. | Status `approved`. A `rejected` form is neither pending nor verified and must not count as signed. | One helper in `src/lib/spokes/` (or beside `orientation-completion.ts`) that all of the intake banner, roster, compliance and signature guard call. |
| Form (`FormResponse`) | Status `submitted`. | Status `reviewed`. `needs_changes` and `draft` do not count. | The existing `groupBy` in `src/lib/instructor-metrics.ts`, moved behind a shared helper that region rollup also uses. |
| Portfolio and evidence | An item exists but has no review. This needs a new review field first, or an agreement that portfolio items count as "submitted evidence" only. | Evidence attached to a requirement whose `verifiedBy` is set. A portfolio item alone is never verified. | The certification reader above, for verified evidence. Portfolio count stays labeled "items added". |
| Application and saved job | Application status `applied`, `interviewing` or `offer` with `verificationStatus` of `self_reported` or `null`. A `saved` row is a saved job, not an application. | Status `accepted` with `verificationStatus = verified`. | One function in `src/lib/outcome-verification.ts` used by grant metrics, the placement bridge and the funnel, which already agree on the verified case. |
| Credly import | A badge seen on the connected profile and not yet reviewed by staff. | A badge staff accepted for a named requirement. Nothing is verified automatically. | None exists. This is new work under W3a and later steps, and it should write to the certification reader's inputs instead of keeping a parallel count. |

Decisions this proposal asks Britt to make:

1. May a student-created goal count toward the plan before staff confirm it, or should only confirmed goals count (mismatch 9)?
2. Should "completed" certification status require a verified outcome, or stay a student-visible milestone with verification shown beside it (mismatches 1 and 3)?
3. Should the XP counter remain a floor for readiness, or should readiness read the database only (mismatch 1)?
4. Should a `rejected` form ever count as signed (mismatch 5)?
5. Is a portfolio item evidence, or only a record that the student added something (mismatch 11)?

W3a (the Credly cache binding and the failure-versus-empty fix) does not depend on these answers.
