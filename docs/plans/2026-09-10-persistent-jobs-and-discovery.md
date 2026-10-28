# Persistent jobs and responsive discovery

Status: proposed implementation plan, September 10, 2026. Planning only. Companion to [dashboard data and live updates](2026-09-10-dashboard-data-and-live-updates.md).

## Outcome

A student can save an interesting job, permanently dismiss an unwanted listing from their discovery results, and return on another device without losing either choice. Mobile offers optional left/right swiping with clear buttons. Desktop offers searchable results, filters, details, and a persistent saved workspace.

This is one Career workflow with two responsive presentations. Proposed accountable owner: Britt until delegated. The first deliverable is persistence; gesture polish follows it. A separate implementation task is useful once the record/API contract is agreed, but no new task is created by this plan.

## Existing implementation and concrete gaps

| Source | Finding |
| --- | --- |
| `prisma/schema.prisma`, StudentSavedJob | Saves, notes, and appliedAt are durable, with a unique student/listing pair. The listing relation cascades deletion into the student's saved record |
| `src/app/api/jobs/save/route.ts` | Accepts saved, applied, interviewing, offered, withdrawn; no dismissed state. Saves require a listing in the student's first active class enrollment |
| `src/app/api/jobs/route.ts` | Returns active class jobs plus a program-wide browse pool. Browse entries always get null saved metadata, and browse-only responses report zero saves |
| JobBrowseListing | Separate feed table with no StudentSavedJob relation; its entries cannot use the class-listing save endpoint |
| `src/components/career/CareerHub.tsx` | Refetches the current job results after saving. A failed HTTP response is not thrown by the save callback, so callers cannot reliably distinguish failure |
| `src/lib/job-board/job-filters.ts` and JobFilters | Keyword, recency, minimum pay, and employment type filters already exist; retain and improve them |
| `src/lib/job-board/duplicates.ts` | Display grouping uses title/company/location/work mode and chooses a representative row. That display key is too broad to become a permanent suppression identity |
| `src/lib/job-board/recommendation.ts` | Saved/application interactions influence ranking; withdrawn is already a negative signal. Withdrawal and lack of interest need separate meanings |
| Application/Opportunity | Another application pathway already has verification and placement provenance. Integrate with this contract instead of creating a third application tracker |

These are source findings. Current production records, feed availability, and migration state were not inspected.

## User-visible behavior

| Action | Immediate result | Durable meaning |
| --- | --- | --- |
| Interested / swipe right | Job enters Saved; brief confirmation with Undo | Preference is interested; no application is submitted or claimed |
| Not interested / swipe left | Job leaves discovery; brief confirmation with Undo | Dismiss this listing for this student indefinitely, including future refreshes/imports of the same vacancy |
| Open details | Read description, requirements, pay, location, source and freshness | No interest decision is inferred |
| Remove from Saved | Leaves Saved without being permanently hidden | Preference returns to neutral; explicit Not interested is the permanent dismissal action |
| Restore hidden job | Becomes discoverable again if still available | Explicitly reverses dismissal; never happens because a cache expires |
| Mark applied/interviewing/offered/withdrawn | Application tracker updates | Separate from interest; self-reported until verified where reporting requires it |
| Listing expires/closes | Saved item remains with Closed/Expired label | Preserve snapshot, notes, dates, attached preparation, and application history |

“Permanently remove” means suppress the vacancy for that student until they explicitly undo/restore it. The shared listing remains available to other students. Retain the minimal suppression record through normal feed cleanup; physical deletion would allow the next import to show it again. Account deletion and institutional retention rules remain separate operations.

Do not hide an employer, career field, or all similar jobs based on one dismissal. Explicit reasons may be optional future input; do not force students to explain each choice. A new requisition can be shown; a refreshed copy of the same requisition stays hidden.

## Durable record contract

Recommended additive design:

- **CanonicalJob**: stable vacancy identity and the latest supported public metadata. Both class and browse feed rows resolve to it. Preserve each feed's eligibility and class visibility; a shared identity does not grant universal feed access.
- **JobSourceAlias**: provider, source record ID, trusted canonical application URL/requisition identity, and canonical job ID. Record aliases for class and browse copies and high-confidence cross-source duplicates. Same provider/source ID is exact; matching trusted employer requisition URLs may bridge providers. Title/company/location alone is only a display hint, not proof of identical vacancies.
- **StudentJobPreference**: unique student/canonical-job pair, preference neutral/interested/dismissed, first interested time, dismissed time, revision, and update time. Ingest never resets this row. Mutations use desired state and expected revision, not a retry-sensitive toggle.
- **Saved snapshot**: retain title, employer, location/work mode, pay text and normalized unit when known, source URL, source timestamp, and the relevant job details as permitted by source terms. Keep a snapshot and minimal identity when feed rows expire or are pruned. Feed deletion must not cascade into student history.
- **Application linkage**: keep existing StudentSavedJob status/notes/appliedAt through migration and map tracked applications into the existing Application/provenance model through an explicit canonical-job link. Preserve the existing Opportunity link for opportunity-based applications. Enforce one applicable subject and a unique student/subject pairing; do not duplicate the same application across both trackers.
- **StudentJobSearchPreference**: durable named/default filters when the student chooses Save search. Keep ordinary search state in the URL for back navigation and sharing within the authorized app. Never put private notes in URLs.

Inventory resume-version, cover-letter, teacher reporting, recommendation, Sage job-tool, and placement consumers before choosing the final migration shape. A bounded alternative can extend existing tables if it provides the same guarantees; a rewrite of every feed adapter is not required for the first slice.

Backfill existing saves and source aliases before switching readers. Carry original savedAt, appliedAt, notes, tracking status, and provenance forward. A withdrawn application stays withdrawn; do not migrate it to dismissed. Existing verified outcomes remain verified; unknown legacy provenance remains unknown. Reconcile row counts and duplicates, keep a compatibility adapter for the old save endpoint during rollout, then remove the old write path after all callers move.

## Server reads and writes

1. Use one authenticated preference service for forms, swipe actions, desktop buttons, and Sage-confirmed job actions. Resolve the student's identity from the session and verify the requested listing is visible or already in that student's saved history.
2. Support both class listings and program browse listings. Check all applicable active enrollments rather than whichever findFirst returns; saved history survives a class transfer. Private class eligibility still applies to new discovery results.
3. Add dedicated authenticated reads for discovery, saved jobs, hidden jobs, and applications. Saved jobs load from student records, not the active feed; otherwise closed jobs disappear. Hidden jobs are accessible only through an explicit management view.
4. Resolve canonical identities and exclude dismissed jobs on the server before ranking, limits, pagination, and response counts. Apply the rule to dashboard suggestions, Career lists, search, recommendations, and Sage's job lookup. A source feed refresh cannot resurrect them.
5. Make preference writes idempotent and versioned. Serialize rapid actions per job; reject stale mutations rather than letting a late save overwrite a newer dismissal. Undo is a new explicit versioned write.
6. Return saved state and the data revision from the shared live-update contract. Optimistically remove/save cards with pending feedback, then confirm or roll back on failure. A failed request must leave a visible retry path and must never silently discard the job.
7. Separate visibility and application stage. Dismissing an already-applied role may remove it from discovery but must not delete its application history. Opening an employer link does not mark the job applied.
8. Retain parameterized search, bounded page sizes, stable cursor pagination, accurate counts, and deterministic ordering. Label missing salaries as unknown and compare pay only after unit normalization. Remote labels must not imply unrestricted geographic eligibility.

## Responsive interaction brief

Audience: adults seeking work, including users with limited digital confidence. The mode is Operate: compare a role, make a decision, and keep useful opportunities accessible. Use the incumbent VisionQuest theme and typography; this plan does not select a replacement visual style.

### Mobile

- One readable job card at a time, with title, employer, location/remote eligibility, pay or unknown, schedule, posting freshness, and a short reason it may fit.
- Persistent text-labeled Interested and Not interested buttons. Right swipe saves, left swipe dismisses; gestures are optional shortcuts. A details action is distinct.
- Vertical scrolling must not trigger a decision. Commit only after a deliberate horizontal gesture; cancel incomplete drags. Provide reduced-motion behavior and semantic status announcements.
- Undo preserves focus and restores the prior card/state. Fast swipes cannot skip unsaved jobs or send stale decisions out of order.
- Saved and Search remain directly reachable. Exhaustion says No more jobs match these filters and offers filter changes; it never recycles dismissed listings.

### Desktop

- Search/filter region, a readable results list, and a details pane. Selection and back navigation preserve filters and scroll position.
- Start with current keyword, career cluster, local/remote, recency, minimum pay, and job-type capabilities. Add location/radius, schedule, and relevant qualification filters only when the feed data supports them.
- Sort by relevance, newest, or comparable pay. Explain matches with evidence such as skill overlap and location; avoid unsupported precision scores.
- Saved workspace includes open and closed jobs, notes, application stage, and next follow-up. Keep Hidden jobs as a secondary management action.
- Both layouts use the same records and actions. A desktop dismissal disappears from mobile; a mobile save is available on desktop.

Keyboard, screen-reader, touch, and pointer users must be able to perform every action without swiping. Use at least 44px targets, text plus icons, visible focus, accessible status messages, and an equivalent list view. Test 390px, 768px, 1440px, 200% zoom, both themes, and reduced motion.

## Dashboard and coaching changes

Show a small Saved jobs count and a useful next action: review saved roles, prepare an application, or follow up on a recorded application. Counts and next steps come from the same saved/application queries as Career.

Saved and dismissed choices can inform recommendations, but explicit qualifications, geography, schedule, and preferences remain primary. Keep negative signals modest and interpretable; do not infer personal circumstances from swipes. A save is not employment progress, and an offer claim is not a verified placement. Instructor access follows existing managed-student scope and reporting provenance rules.

## Delivery order and tests

| Slice | Deliverable | Required proof |
| --- | --- | --- |
| 1 | Canonical identity, student preferences, migration, and compatibility APIs | Both feeds save; duplicates map correctly; withdrawn statuses and legacy dates/notes survive |
| 2 | Durable Saved and Hidden views, server exclusions, error feedback | Refresh/logout/restart/second-device tests; feed expiration/pruning/reimport cannot erase saves or revive dismissals; other students are unaffected |
| 3 | Mobile cards with buttons, swipes, Undo, and desktop list/details | Keyboard and pointer equivalence; vertical-scroll safety; rapid swipes and late responses; focus and draft preservation; responsive accessibility |
| 4 | Shared live updates, dashboard summary, Sage lookup, and reporting linkage | Two-device convergence; no dismissed suggestions from any entry point; no duplicate applications or false verified outcomes |
| 5 | Saved searches and better filters | Search state survives navigation; stored searches persist across devices; counts/pagination remain correct after exclusions |

Use a synthetic fixture with class-only jobs, browse-only jobs, cross-source aliases, ambiguous similar jobs, expired jobs, and transferred students. Test restricted-role database access, denied foreign student IDs, forged listing IDs, duplicate/reordered requests, save failure, offline interruption, and Undo racing a second device. Verify that a genuinely new requisition is not accidentally suppressed by a broad duplicate heuristic.

Pilot success: students recover every saved job and never see an unchanged dismissed vacancy in ordinary discovery; both layouts offer a clear next action. Do not use number of swipes as the success metric. If suppression is unreliable or saves are lost, pause gesture rollout and fix the record layer.

## Suggested separate-task handoff

After implementation scope is accepted, this can be a dedicated task with the following brief:

> Implement the approved persistent-jobs plan in docs/plans/2026-09-10-persistent-jobs-and-discovery.md, beginning with persistence and both-feed API support. Coordinate the event/revision contract with docs/plans/2026-09-10-dashboard-data-and-live-updates.md. Preserve existing applications, notes, dates, verification, source eligibility, and placement provenance. Demonstrate permanent per-student dismissal across refresh and reimport, saved history after expiration, and mobile/desktop parity using synthetic data and a verified nonproduction database. Do not modify the isolated prototype, unrelated working-tree changes, production services, or deploy without separate authorization.

Open product inputs: first release targets, actual job sources and their retention terms, official application/outcome reporting expectations, and desired saved-search filters beyond those already supported. Defaults in this plan are proposals, not completed features.
