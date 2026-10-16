# Grant KPI trend: compute it instead of scheduling a snapshot

The Grant KPI Report on Program Setup has a trend line under each metric
card, fed by `GrantKpiSnapshot`. Nothing has ever written that table. This is
the same class of gap as review finding F6, found while tracing the reports
route for `docs/plans/2026-10-15-unscheduled-internal-routes.md`.

This note asks Britt to approve or reject one recommendation. Nothing here is
applied. I read the code at `main` `bdfe50ec` plus PR #240's branch. I could
not query production from this session.

| Option | Verdict |
|--------|---------|
| Compute the trend from dates already on `SpokesRecord`, drop the snapshot | **Recommended** |
| Schedule the snapshot with pg_cron and an `/api/internal` route | Fallback, if Britt wants frozen history |
| Enqueue the snapshot from an existing daily job | Rejected |
| Delete the chart | Rejected, but harmless |

## What I found

**Nothing writes the table.** Outside the RLS test suite, `takeGrantKpiSnapshot`
in `src/lib/grant-kpi-history.ts` is the only code that creates or updates a
`GrantKpiSnapshot` row. Its only caller is the `snapshot_grant_kpis` handler
in `src/lib/jobs-registry.ts:75`. No code enqueues that job type. I checked
all ten `enqueueJob` and `enqueueJobWithCooldown` call sites and both raw
`backgroundJob.create` calls. No migration or pg_cron job touches the table.
The feature shipped in one change on 2026-03-30 (`4c2ed9ae`, "Wave 3B") with
a handler, a reader and no scheduler, and never got one. Unless someone
inserted a `BackgroundJob` row by hand, the table is empty. This query settles
it:

```sql
SELECT count(*) FROM visionquest."GrantKpiSnapshot";
```

**With zero rows the page shows nothing, and nothing breaks.** The "chart" is
six 120-pixel sparklines under the metric cards in
`src/components/teacher/GrantKpiReport.tsx`. They render only when the history
has at least two snapshots (`trendData.length >= 2`, line 345). With zero or
one row there is no line, no snapshot count, and no empty message. A failed
fetch is swallowed (line 284). No teacher has ever seen the trend in
production. The cards, counts, drill-down and CSV export are computed live and
work today.

**A snapshot would disagree with the card above it.** The cards come from
`GET /api/teacher/reports/grant-kpi`. That route counts `SpokesRecord` rows
linked to students the viewer manages (`studentId: { in:
listManagedStudentIds(...) }`, `route.ts:19-32`), read through the app client
under RLS. Under the `student_self_access` policy, an admin's cards cover every
linked student and a teacher's cover only their own. The snapshot counts every
record referred in the program year (`grant-kpi-history.ts:23-40`), through
the admin client, including records with no linked student.
`SpokesRecord.studentId` is nullable because intake creates the record before
the student has an account. A referral who never registers is in the
snapshot's enrollment-rate denominator and not in the card's. So for an admin,
the end of the enrollment line would sit below the number printed above it.
For a teacher, the line would show the whole program under a card about their
own students.

The history route also hands program-wide rows to any teacher
(`history/route.ts:15-20`). These are aggregates with no names, but the rule
differs from the one the cards use.

## If it stays a snapshot: scope and cadence

**One program-wide row, not one per class.** The only reader asks for
`classId: null`, and `GrantKpiReport` never sends a class. Per-class rows
would have no reader. They also can't be combined into a teacher's view of
several classes, because rates don't add and a student in two classes would
count twice. The grant targets (60% enrollment, 30% placement, 5%
post-secondary) are program targets. The `classId` branch of
`takeGrantKpiSnapshot` should go.

**Daily.** A run is about four statements (the record read, the follow-up
read, a lookup and one write) and adds one row a day. Running it twice in a day
updates that day's row instead of adding a second. The line appears after the
second run, so day two instead of week two, and a missed run costs one point.
Weekly would read the same, since the sparkline spaces points evenly and has no
date axis.

**At 10:55 UTC.** The writer stamps the UTC date but picks the program year in
Eastern time. The two agree only from 04:00 UTC (05:00 in winter) to midnight
UTC, so the run has to fall in that window. 10:55 UTC is 6:55 a.m. EDT and
5:55 a.m. EST. No job uses that minute: job-processor runs on the tens, the
stall detectors take 10:35 and 10:45, the 2026-10-15 report proposes 10:05 and
10:25, and the briefing runs at 11:00. cron-health-monitor's 11:15 run would
report a failure the same morning.

## Recommendation: compute the trend, drop the snapshot

Almost every input to `computeGrantKpis` has a date. `SpokesRecord` has
`referralDate`, `enrolledAt`, `unsubsidizedEmploymentAt` and
`postSecondaryEnteredAt`, and `SpokesEmploymentFollowUp` has `checkedAt`. Only
`status` and `hourlyWage` are current values. So the metrics as of any day D
can be rebuilt from today's records:

1. Keep records referred on or before D.
2. Treat `enrolledAt`, `unsubsidizedEmploymentAt` and `postSecondaryEnteredAt`
   after D as not yet set.
3. Keep follow-ups checked on or before D.
4. Run the existing `computeGrantKpis` on the result, unchanged.

The change is in the history route. It fetches the same records the cards
use, through one fetch helper pulled out of `grant-kpi/route.ts`, and adds
`checkedAt` to the follow-up select. It returns one point per Monday since
July 1 plus one for today, in the response shape it has now (`{ programYear,
snapshots: [{ date, metrics, counts }] }`). `GrantKpiReport` doesn't change.
Then delete `takeGrantKpiSnapshot`, `getGrantKpiHistory`, the
`snapshot_grant_kpis` handler and their test, and drop the table in a later
migration once the count query returns 0.

Why I prefer this to scheduling:

- The line matches the card above it for every viewer, because both come from
  the same records, scope and population.
- The whole program year appears on the first page load. A schedule starts
  empty on deploy day and needs two runs before anything shows.
- It removes a table, a writer, a job handler and an admin-client read, and
  adds no cron job, route, Vault dependency or health-check entry.
- The route's `classId` and `programYear` parameters work for any class or any
  past year. A snapshot table can't fill in days it never recorded.

It does give something up. A snapshot keeps what the system showed on a day,
while the computed line shows what today's records say about that day. If staff enter an
enrollment late with its real date, the earlier points move. A corrected wage
changes the high-wage line back to the placement date. A deleted record drops
out of every point. For a trend on a setup page I think that's fine, and
closer to what actually happened. If Britt needs a record of "what we reported on date
X", that is a snapshot, and the fallback below provides it. Nothing in the app
reads history that way today.

Cost is one more scoped `SpokesRecord` read per visit to the Reports tab (the
same read the cards already make) and at most 54 in-memory passes over those
rows. I'd expect a few hundred rows; I didn't measure it.

## Fallback: schedule the snapshot

If Britt wants frozen history instead:

- A new route, `POST /api/internal/grant-kpi/snapshot`, authorized with
  `isAuthorizedInternalRequest` once the sibling session hardening internal
  routes lands. It calls `takeGrantKpiSnapshot()` inline and returns
  `programYear`, `snapshotDate` and `durationMs`. Inline rather than through
  the job queue, because one small read and one write need no retries.
- Delete the `snapshot_grant_kpis` handler and the `classId` branch, which
  have no callers.
- One migration, `<timestamp>_add_grant_kpi_snapshot_cron`, copied from
  `20261015120000_add_stall_detector_cron`: the pg_cron and pg_net guards,
  `cron.schedule()` only, an `insufficient_privilege` handler, the base-URL
  fallback and the Vault `CRON_SECRET`. Job `grant-kpi-snapshot`,
  `'55 10 * * *'`, `timeout_milliseconds := 60000`.
- Add `grant-kpi-snapshot` to `EXPECTED_CRON_JOBS` in
  `scripts/lib/cron-health.mjs`. PR #240's `cron-schedule-coverage` test
  checks that the route, the migration and that list agree. Update the
  runbook's job count.
- Fix the population first, or the line contradicts the card. Count only
  linked records in the snapshot, so it matches an admin's cards. Have the
  history route return no rows to teachers, whose cards cover only their own
  students.
- Optional: the unique index on `(programYear, snapshotDate, classId)` doesn't
  stop duplicate program-wide rows, because Postgres treats nulls as distinct.
  The writer's lookup-then-write covers one run a day. A partial unique index
  `WHERE "classId" IS NULL` closes the race with a manual run.

## Rejected

**Enqueue from an existing daily job.** Each daily route belongs to another
feature. The obvious host, the 11:00 briefing route, returns early unless
`SAGE_AUTOPILOT_ENABLED` is `true`. That variable is not in `render.yaml`,
and project memory records the briefing as off, so the snapshot would never
run. Tying the snapshot to another feature means it stops whenever that
feature is switched off, and `cron:health` couldn't report it as a job of its
own.

**Delete the chart.** This is the smallest change, and nobody would notice,
since nobody has seen the chart. But both options delete the same snapshot
code, the computed line adds one small pure function on top, and it shows the
program's progress toward the three Program of the Year targets.

## One question for Britt either way

Which records should the grant rates count? Today the cards count only records
linked to a student account. A referral who never registers isn't in the
enrollment-rate denominator. If WVDE counts every referral, the cards overstate
the enrollment rate now, chart or no chart. Fixing that is a change to the
live route, separate from this proposal.

## Found on the way

- `GET /api/teacher/reports/grant-kpi` drops its student filter when the
  viewer manages no students (`studentIds.length > 0 ? ... : {}`, line 32).
  RLS then admits every unlinked referral in the program, so a teacher with an
  empty roster sees program-wide referral counts. The drill-down route has the
  same guard.
