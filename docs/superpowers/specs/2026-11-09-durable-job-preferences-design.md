# Durable saved and hidden jobs (W4) design

Status: approved for build by Britt on 2026-11-09 ("implement full plan"), within the bounds of W4 in `docs/plans/2026-11-09-consolidated-remaining-work.md`. Background: `docs/plans/2026-09-10-persistent-jobs-and-discovery.md`.

## Problem

- `StudentSavedJob.jobListingId` is required and its foreign key to `JobListing` cascades. When a listing row goes, the student's save goes with it: status, notes, applied date and all.
- `JobListing` rows are deleted today only through the `JobClassConfig` and `SpokesClass` cascades (a class or its job setup is removed). Scrapes mark rows `expired`; they do not delete them. So the loss is rare now, but any future prune would silently erase student history.
- `POST /api/jobs/save` rejects every browse-pool (`JobBrowseListing`) job with `not_your_class_board`. The browse pool has no relation to `StudentSavedJob` at all.
- The save route and `GET /api/jobs` take the student's class from `studentClassEnrollment.findFirst({ status: "active" })` with no `orderBy`. A student with two active enrollments gets an arbitrary class, and can be refused a save for a job that is on the other class's board.
- There is no "not interested" choice. The only negative signal is the `withdrawn` status, which means the student withdrew an application.

## Solution

Saves and hides attach to a stable vacancy key built from each posting's source and upstream id, carry a snapshot of the posting, and never cascade away with a listing row. Hides live in their own table so "not interested" never touches the application tracker. A single SystemConfig switch turns the hide feature off without losing anything.

### Vacancy identity

A vacancy is one upstream requisition. Its key is:

```
v1:<source>:<sourceId>
```

- `source` is trimmed and lowercased. `sourceId` is trimmed and kept as is, because upstream ids can be case sensitive.
- Every adapter already builds `sourceId` from the upstream requisition id, namespaced by source: `adzuna:<id>`, `usajobs:<MatchedObjectId>`, `careeronestop:<JvId>`, `greenhouse:<board>:<id>`, `lever:<board>:<id>`, `wvumedicine:<jobReqId>` and so on. Two rows with the same pair are the same posting.
- The key is the same for a class row (`JobListing`) and a browse row (`JobBrowseListing`). `GET /api/jobs` already treats `source:sourceId` as "the same job" when it drops browse rows that duplicate class rows, so this matches current behavior.
- The key does not include `classConfigId`. The same posting scraped into two classes is one vacancy, so a choice made in one class follows the student to the other.
- A reimport or a re-scrape that creates a fresh row with a new cuid keeps the same key, so the choice still applies.
- The `v1:` prefix lets a later scheme coexist with stored keys. The source and source id are also stored next to the key, so keys can be rebuilt.
- The function is pure: `vacancyKeyFor()` in `src/lib/job-board/vacancy-identity.ts`. It returns `null` when either part is blank, and callers refuse to save or hide such a row.

Why not the display key: `src/lib/job-board/duplicates.ts` groups rows by title, company, location and work mode so the board shows one card per look-alike group. Two different openings at the same employer with the same title (two shifts, two stores in one town) share that key. Hiding one with the display key would hide both. The vacancy key keeps them apart. Hidden rows are filtered out before display grouping, so when one of two look-alikes is hidden, the other one still shows.

### Snapshot

A save and a hide each store a snapshot of the posting, taken from the listing when the student acts and refreshed on every later save:

- `snapshotTitle`, `snapshotCompany`, `snapshotLocation`, `snapshotUrl`
- `snapshotSource`, `snapshotSourceId`
- `snapshotPostedAt` (browse rows only; class rows have none), `snapshotExpiresAt`
- `snapshotAt`, when it was taken

Nothing about the student goes into the snapshot. It is the posting's public facts only.

### Model changes (additive)

`StudentSavedJob` (existing rows keep working as they are):

- `jobListingId` becomes nullable. Its foreign key changes from `ON DELETE CASCADE` to `ON DELETE SET NULL`. Deleting a listing now leaves the save, its notes and its dates in place.
- New nullable `jobBrowseListingId`, with a foreign key to `JobBrowseListing` that is also `ON DELETE SET NULL`.
- New nullable `vacancyKey`, unique per student (`@@unique([studentId, vacancyKey])`). Postgres treats nulls as distinct, so legacy rows without a key never collide.
- New nullable `listingKind`: `class` or `browse`. It records where the save came from, and survives after the listing link is cleared.
- The snapshot columns above, all nullable.
- The existing `@@unique([studentId, jobListingId])` stays, so Sage's write tools, which upsert by that pair, keep working.

New `StudentHiddenJob`:

- `id`, `studentId` (cascade on `Student`, like every student-owned table), `vacancyKey`, the snapshot columns (title, company, location, url, source and source id required; dates nullable), `hiddenAt`, `restoredAt` (nullable), `updatedAt`.
- `@@unique([studentId, vacancyKey])`. One row per student per vacancy.
- No foreign key to either listing table. Matching is by key only, so listing deletion, expiry and reimport cannot touch it.

### Hide and restore

- "Not interested" writes or reopens the student's `StudentHiddenJob` row for that vacancy: `restoredAt = null`, `hiddenAt = now`.
- "Restore" sets `restoredAt = now`. The row stays as history; it is no longer counted as hidden. Hiding again reopens the same row.
- A vacancy is hidden while its row exists with `restoredAt` null.
- Hiding does not touch `StudentSavedJob` or `Application`. A student who applied and then hides the posting keeps the applied status. Withdrawing an application stays the `withdrawn` status on the tracker. The two never share a field.
- Hidden vacancies are left out of the class board and the browse pool in `GET /api/jobs`. They are filtered before display grouping and before counts.

### Authorization

- Only the student acts on their own rows. Every query filters `studentId: session.id`, and RLS enforces the same.
- Class job: allowed when the listing's `classConfig.classId` is any class in which the student has an `active` enrollment. This replaces the first-enrollment lookup in the save route.
- Browse job: allowed for any signed-in student while the row exists. The pool is program wide by design.
- Restore: by the hidden row's own id (a cuid), scoped to the student. No listing is needed, so a student can restore after a listing is gone or after a class transfer.
- Board choice in `GET /api/jobs`: the student's most recent active enrollment whose class has a job setup, by `enrolledAt` descending. This is deterministic, and after a transfer it picks the new class while the old enrollment is still being archived.
- After a class transfer, saves and hides stay. When the new class's board carries the same vacancy, the card shows the saved status and stays hidden if hidden. Changing a save made through a listing on the old class's board needs that listing to be visible again; the student's tracker rows themselves are never deleted.
- Not changed here (Sage paths, follow-up): `src/lib/sage/agent/job-search-tools.ts`, `career-tools.ts` and `write-tools.ts` still use a first active enrollment. They are Sage behavior and need the eval gates, which this branch cannot run.

### Backfill

`scripts/job-preferences-backfill.mjs`, dry run by default, `--apply` to write. Never run in this session.

- For each `StudentSavedJob` with a `jobListingId` and no `vacancyKey`, it computes the key and snapshot from the linked listing.
- When two of one student's saves map to the same key (the same posting saved in two classes), it keys the most recently updated row and leaves the others unkeyed. It prints those pairs for review. Unkeyed rows still work through `jobListingId`.
- It skips rows that already have a key, so a second run changes nothing.
- Order at deploy: `prisma migrate deploy`, then the dry run, then `--apply`. Until the apply runs, a deleted listing leaves a legacy save with no snapshot; it shows as "This job is no longer listed." No listing is deleted on a schedule today, so that window carries little risk.

### Rollback

SystemConfig key `job_hide_enabled`. Unset, or any value but `off`, leaves hiding on. `off` does this:

- The Not interested and Restore buttons and the hidden-jobs panel are not shown (`GET /api/jobs` returns `hideEnabled: false`).
- `POST /api/jobs/hidden` and `GET /api/jobs/hidden` answer 404 `job_hide_disabled`.
- The board stops filtering hidden vacancies, so nothing stays hidden with no way back.
- Stored `StudentHiddenJob` rows stay untouched. Turning the key back on restores every choice.

Saves of browse jobs and the save snapshot are not behind the flag. They fix data loss rather than add a discovery feature.

## Variables

| Name | Where | Meaning |
| --- | --- | --- |
| `job_hide_enabled` | SystemConfig (plain value) | `off` turns hiding off; anything else, or unset, leaves it on |
| `VACANCY_KEY_VERSION` | `src/lib/job-board/vacancy-identity.ts` | The `v1` prefix on every stored key |
| `--apply` | `scripts/job-preferences-backfill.mjs` | Writes the backfill; without it the script only reports |

## Workflow

1. Commit this note.
2. Write failing tests: the identity function, the schema's `onDelete` rule, the save, hide and restore routes, and the board's hidden filter.
3. Change the schema, write the migration by hand from `prisma migrate diff`, add RLS, and regenerate the client.
4. Build the lib helpers, then the routes, then the job card buttons.
5. Run the tests, `tsc`, `eslint` and `prisma validate`.
6. At deploy (Britt): `prisma migrate deploy`, then the backfill dry run, then `--apply`.

## Deliverables

- `prisma/schema.prisma` and `prisma/migrations/20261109120000_durable_job_preferences/migration.sql`
- `src/lib/job-board/vacancy-identity.ts` (pure), `src/lib/job-board/job-preferences.ts` (queries)
- `src/app/api/jobs/save/route.ts` (browse saves), `src/app/api/jobs/hidden/route.ts` (hide, restore, list), `src/app/api/jobs/route.ts` (filter and saved status by key)
- Not interested and Restore buttons in `src/components/jobs/JobCard.tsx` and a hidden-jobs panel in the Career hub
- `scripts/job-preferences-backfill.mjs`
- The `hidden-jobs.json` section in `src/lib/student-archive.ts`

## Definition of done

- Saves no longer cascade with a listing.
  - Check: `grep -c 'ON DELETE SET NULL' prisma/migrations/20261109120000_durable_job_preferences/migration.sql`
    Expected: `2`.
- The new table has RLS.
  - Check: `grep -c 'ENABLE ROW LEVEL SECURITY' prisma/migrations/20261109120000_durable_job_preferences/migration.sql`
    Expected: `1`.
- The migration drops no column or table.
  - Check: `grep -cE 'DROP (COLUMN|TABLE)' prisma/migrations/20261109120000_durable_job_preferences/migration.sql`
    Expected: `0`.
- The feature tests pass.
  - Check: `node --import tsx --test --experimental-test-module-mocks src/lib/job-board/vacancy-identity.test.ts src/app/api/jobs/hidden/route.test.ts`
    Expected: exit code 0.

## Decisions

| Decision | Chosen | Alternative | Why |
| --- | --- | --- | --- |
| Where saves live | Extend `StudentSavedJob` | A new preference table holding saves and hides together | Existing rows, Sage tools, nudges and the archive keep working with no data move. |
| Where hides live | New `StudentHiddenJob` | A `hidden` status on `StudentSavedJob` | A hide is not an application step. Keeping it out of the tracker's status field is what keeps "not interested" apart from "withdrawn". |
| Restore | Set `restoredAt`, keep the row | Delete the row | Keeps history for rollback and review, at the cost of one row per vacancy. |
| Backfill | Script, run after deploy | An `UPDATE` inside the migration | The brief asks for a script; collision reporting needs a human to read it. The cost is the short window above. |
| Collisions in backfill | Key the most recent row, report the rest | Merge rows | Merging notes and dates is a judgment call; reporting keeps it with a person. |
| Request shape | Keep `jobListingId`; resolve class first, then browse | A `listingKind` field in the body | Current clients keep working, and cuids do not collide across tables. |
| Response shape | Plain objects (`{ savedJob }`, `{ hiddenJob }`, `{ hiddenJobs }`) | The `{ success, data }` envelope from `.claude/rules/api-conventions.md` | The jobs family already returns plain objects, and the brief says to match it. |
| RLS for `StudentHiddenJob` | Admin or own row for all commands; managed teachers read only | Copy `StudentSavedJob`'s teacher write branch | No staff code writes hides. A read-only teacher branch needs no tree-reader write blocks. |
| Hidden filtering | In memory, after the query | A SQL `NOT IN` on source and source id | A student hides few jobs, and in-memory matching uses the exact same key function as the write path. The board's 500-row cap applies before the filter. |
| Rollback switch | One SystemConfig key, default on | An env var | Britt can flip it in Program Setup without a deploy. |
| Board class for multi-class students | Most recent active enrollment with a job setup | A merged board across classes | A merged board changes ranking, region and counts; that is a product change beyond W4. |
