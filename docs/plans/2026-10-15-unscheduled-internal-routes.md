# Four unscheduled internal routes: schedule, delete, or keep manual

Review finding F6 (`docs/audits/2026-09-01-full-review.md`) named six
bearer-authenticated routes that no pg_cron job calls. PR #240 scheduled two
of them (`evidence-gap-detection`, `goal-stale-detection`). This report
covers the other four and asks Britt to approve or reject one recommendation
for each. Nothing here is applied.

Read against `main` at `bdfe50ec` and PR #240's branch
(`fix/schedule-stall-detectors`). I could not query production from this
session, so costs are counted from the code, not measured. Each route returns
`durationMs`, so one manual call with the Vault secret measures it.

| Route | Recommendation | Schedule |
|-------|----------------|----------|
| `POST /api/internal/alerts/sync` | Schedule daily, alerts only (no nudges) | `25 10 * * *` |
| `POST /api/internal/jobs/scrape` | Schedule weekly after two small fixes | `5 10 * * 1` |
| `POST /api/internal/jobs/browse-refresh` | Keep manual until VQ-R-015 is decided | none now; `5 9 * * *` if the pool stays |
| `POST /api/internal/reports` | Delete | none |

Minutes already taken, all UTC: `:00` hourly (appointment-reminders), every
ten minutes from `:00` (job-processor), `:15` (cron-health-monitor), `:30`
(connect-nudges), 10:35 and 10:45 (the stall detectors in #240), 11:00
(sage-daily-briefing), 13:00 (daily-coaching), 06:10 Sunday and 06:20 daily
(the other Sage jobs). `:05` and `:25` are free.

## alerts/sync: schedule daily, without the nudges

The route reads every active student account through `prismaAdmin` and runs
`syncStudentAlerts` for each one, four at a time, inside that student's RLS
context (`src/lib/advising.ts:203`). The sync rebuilds the student's
`StudentAlert` rows, then sends intervention nudges.

About twenty routes plus the Sage write tools already call
`syncStudentAlerts` after a write: orientation, forms, tasks, appointments,
goal links, certifications, portfolio, résumé. So a student's alerts are
current whenever the student does something, or whenever a teacher changes
their record. The `sync_student_alerts` job handler in
`src/lib/jobs-registry.ts:69` looks like a second path, but nothing enqueues
it.

The gap is alerts that turn on because days pass with nothing happening. The
inactivity ladder in `src/lib/inactivity.ts` (14, 30, 60 and 90 days) is the
plainest case. A student who stops coming never triggers a sync, so their
inactivity alert is never written. The teacher dashboard's inactivity panel
reads only stored rows (`src/lib/teacher/dashboard.ts:626`), so it can only
list students who went quiet after a teacher happened to touch their record.
The same holds for `overdue_task`, `missed_appointment`,
`orientation_not_started`, `orientation_overdue`, `certification_stalled`,
`goal_review_stale`, `goal_unconfirmed` and `career_inactive`. The brief's
guess was right: the route matters only for students who aren't active. Those
are the students the queue exists for.

The intervention queue's ranking is not blind. It scores days since activity,
overdue tasks and stalled goals live (`src/lib/teacher/intervention-queue.ts`,
`buildInterventionQueueEntry`). What it misses is the 20 points per open
high-severity alert and the alert-specific action button.

Cost per student is one batched read of six queries (the student read has
about fifteen nested relation loads), about six compliance reads, one
transaction with an upsert per alert and one resolve, then a cooldown read
and an insert for each nudge, plus an email job when SMTP is set. Every
app-client statement runs inside an RLS transaction. That's roughly 30 to 50
statements per student. I don't know how many active students production
has; the route's `synced` and `durationMs` fields answer it.

The risk is the nudges. `syncStudentAlerts` always calls
`syncInterventionNotifications`, with cooldowns of 12 to 48 hours and no
stop condition (`src/lib/intervention-notifications.ts`). On a daily sweep, a
student missing an orientation form gets an in-app nudge and an email every
morning until the form arrives. Each of their instructors gets an in-app note
and an email for that student every morning too. A teacher with twenty
students missing forms gets twenty emails a day. Today those nudges fire only
when the student acts, which is when they're useful.

A smaller side effect: the upsert sets `detectedAt: now` on every alert it
keeps open (`src/lib/advising-sync.ts:281`). After a daily sweep, every open
alert reads as detected that morning, and the dashboard's newest-first order
stops meaning much. Activity syncs already do this, less often.

**Recommendation.** Schedule daily at 10:25 UTC (`25 10 * * *`) with alerts
only. Add a `notify: false` option to `syncStudentAlerts`, pass it from
`syncAlertsForStudents`, and leave the activity-triggered syncs alone. Daily,
because every threshold counts days and the activity syncs already cover
same-day changes; the route's own comment suggests every 15 minutes, which
would cost about 96 times as much for no gain. 10:25 UTC is 6:25 a.m. Eastern
in summer and 5:25 in winter, before classrooms open, ahead of the stall
detectors at 10:35 and 10:45, and ahead of the Sage briefing at 11:00, which
reads alerts. Set `timeout_milliseconds := 300000` and time one manual run
first. If it takes more than about four minutes, it needs a deadline like the
one connect-nudges has.

If Britt wants the daily nudges as well, schedule the same job without the
code change.

## jobs/scrape: schedule weekly, after two fixes

For every `JobClassConfig` with `autoRefresh` true (the schema default), the
route runs `runScrapeForConfig` inline. That calls each configured job source
for the class's region, filters the results, upserts `JobListing` rows one at
a time, expires listings not refreshed in 14 days and duplicates, and records
a `JobScrapeRun`. The student Career board (`/api/jobs`) shows these
listings first.

The only other way this runs is the teacher's Refresh button
(`/api/teacher/jobs/refresh`), which queues a `scrape_jobs` background job
for one class.

Two promises are broken without it. The teacher's job settings say
"Auto-refresh every Monday at 6 AM" (`src/components/teacher/JobConfigSection.tsx:603`),
checked by default, and the student empty state says "new listings are added
weekly" (`src/components/jobs/JobList.tsx:83`). Neither happens. Expiry also
runs only inside a scrape, so a class whose teacher stops pressing Refresh
keeps every listing `active` indefinitely, dead links included.

One caveat for today. `render.yaml` declares none of the job-source keys,
and project memory has the CareerOneStop and Talroo credentials still
pending. A class on the default sources (CareerOneStop, Talroo, USAJOBS)
has no source that can run, so each weekly run records a failed
`JobScrapeRun` ("No active job sources are configured for this class.") and
changes nothing. Classes on keyless sources refresh now. The rest start
working the week the keys land, with no second change.

Cost per class is one set of HTTP calls per configured source (each adapter
has a fetch timeout), one upsert per accepted listing through `prismaAdmin`,
and three or four updates. Weekly, that is small for the database and far
inside any source's quota; Adzuna's trial cap, the tightest, is 250 calls a
day.

Two fixes come first. Both are small and testable.

1. `runAllAutoRefreshScrapes` has no per-class catch, and `runScrapeForConfig`
   rethrows database errors (`src/lib/job-board/scrape-engine.ts:404`). One
   class's error stops every class after it. Catch per class and continue.
2. The cron path doesn't skip a class whose run is already queued or
   processing. The manual path does (`existingRun` in
   `src/app/api/teacher/jobs/refresh/route.ts:62`). Add the same check.

I considered having the route queue one `scrape_jobs` job per class instead,
which would bring retries for free. The catch is that `job-processor` runs on
pg_net's 5-second default timeout, so a long scrape inside its slot would
show in `cron:health` as a timed-out job-processor call. Running inline with
its own 5-minute timeout is simpler.

**Recommendation.** After the two fixes, schedule weekly on Monday at 10:05
UTC (`5 10 * * 1`) with `timeout_milliseconds := 300000`. pg_cron runs in
UTC, so that is 6:05 a.m. Eastern from March to November and 5:05 a.m. in
winter. Accept the winter hour or change the label to "every Monday morning".

## jobs/browse-refresh: keep manual until VQ-R-015 is decided

The route fetches eight keyless sources (four remote job boards, plus
Greenhouse, Lever, Ashby and SmartRecruiters company boards) into the
program-wide `JobBrowseListing` pool, sets each listing to expire 45 days
after its posting date, and expires anything past that.

`/api/jobs` serves this pool as the whole board for a student whose class
has no job config (`browseOnlyResponse`, `src/app/api/jobs/route.ts:71`) and
appends it to everyone's Remote and All tabs (`:244`). The Local tab never
shows it.

Nothing schedules it. `scripts/run-browse-refresh.mjs` says a pg_cron
`browse-refresh` job does; no migration has ever registered one.

Without refreshes the pool doesn't go stale. It drains. Reads filter on
`expiresAt > now` (`src/lib/job-board/browse-jobs.ts:19-20`), so every
listing disappears within 45 days of its posting date.

I would not schedule it as it is, because the pool holds the wrong jobs for
this program. `browseAdapters()` always includes the four company-board
sources, which hardcode 27 boards such as Airbnb, Anthropic and Coinbase,
with no seniority filter (`src/lib/job-board/adapters/ats.ts:6-35`). The
career-search memo (`docs/plans/2026-09-07-career-job-search-fluidity.md`,
section 5) records VQ-R-015 as half fixed. Those boards left the class
defaults, and whether to remove them is an open owner decision. The browse
pool ignores class settings, so a daily refresh would put the same boards in
front of every student.

A run would make about 35 HTTP calls and one serial upsert per listing; the
remote boards return hundreds each. I'd expect minutes per run. Not measured.

**Recommendation.** Keep it as a manual one-off and decide it with VQ-R-015.

- If the company boards go, remove `greenhouse`, `lever`, `ashby` and
  `smartrecruiters` from `BROWSE_SOURCES` (`src/lib/job-board/browse-sources.ts:5`),
  then schedule daily at 09:05 UTC (`5 9 * * *`) with a 5-minute timeout.
  Daily, because remote boards turn over in days.
- If the pool doesn't fit SPOKES students at all (what's left is remote tech
  work, and Arbeitnow is mostly European), delete the route,
  `browse-scrape.ts`, the fallback in `/api/jobs`, and the `JobBrowseListing`
  table, which also has no RLS (F8).

Either way, correct the header of `scripts/run-browse-refresh.mjs`.

This pool is not what's keeping the Career tab empty. Most classes have no
runnable source until the CareerOneStop and Talroo keys exist.

## reports: delete

For each active class, the route computes every enrolled student's readiness
(four at a time, each under that student's RLS), buckets the scores, and
writes one in-app `Notification` per instructor: "Monthly Report: <class>",
followed by a one-line summary. No email.

Nothing reads the `monthly_readiness_report` type. It appears as one more
item in the instructor's notification bell.

The KPI dashboard already fetches `/api/teacher/reports/readiness-monthly`
(`src/components/teacher/MonthlyKpiDashboard.tsx:245`). That route computes
the same score with the same `fetchStudentReadinessData`, live, with the
average, the median and counts above 50 and 75. The notification is a
one-line copy that is out of date the next day and keeps no history.

It also has three defects that only matter if it runs. Nothing stops a second
report in the same month. A failure partway through throws after earlier
classes' notifications are written, so a retry duplicates them. The
`reportRunning` flag guards one server process, not two.

Cost is one readiness computation per enrolled student plus one insert per
instructor, monthly. Small, but it buys nothing.

**Recommendation.** Delete the route and `route.test.ts`. No reader breaks,
and the dashboard shows the same numbers live. If Britt wants a
month-over-month readiness trend, the grant KPI snapshot below is the place
for it, not a notification.

## If Britt approves

- Land after #240, which carries `src/lib/cron-schedule-coverage.test.ts`.
- Code first, test-first: the `notify: false` option for the alert sweep and
  the two scrape fixes.
- One migration whose folder name contains `cron`, for example
  `<timestamp>_add_alert_sync_and_job_scrape_cron`, so the
  `scheduled-layer-drift` benchmark reads it. Copy
  `20261015120000_add_stall_detector_cron`: the pg_cron and pg_net guards,
  `cron.schedule()` only, an `insufficient_privilege` handler per job, the
  base-URL fallback, the Vault `CRON_SECRET`, and
  `timeout_milliseconds := 300000`.
- Jobs: `alert-sync` (`25 10 * * *`, `/api/internal/alerts/sync`) and
  `job-board-scrape` (`5 10 * * 1`, `/api/internal/jobs/scrape`). Add both
  to `EXPECTED_CRON_JOBS` in `scripts/lib/cron-health.mjs`; the coverage test
  checks that route, migration and list agree. Update the runbook's job
  lists from ten to twelve.
- All four routes compare `CRON_SECRET` with `===` rather than the shared
  `isAuthorizedInternalRequest`. A sibling session is hardening the internal
  cron routes; schedule after that lands.
- Deleting `reports` needs no migration, since no job ever pointed at it.
- The Vault `CRON_SECRET` prerequisite from the runbook is unchanged.

## Found on the way

- `snapshot_grant_kpis` has a handler (`src/lib/jobs-registry.ts:75`) and a
  reader (`GrantKpiReport` on the Program Setup page calls
  `/api/teacher/reports/grant-kpi/history`), but nothing enqueues it. The
  grant KPI history chart has no writer. Same class of gap as F6.
- The `sync_student_alerts` handler is never enqueued. Delete it or use it.
- `scripts/run-browse-refresh.mjs` claims a pg_cron job that doesn't exist.
