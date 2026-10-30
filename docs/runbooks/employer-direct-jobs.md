# Employer-direct job data

CareerOneStop Jobs access was not supplied (Britt, 2026-10-30). New class-board
configurations now default to keyless WVU Medicine and local-employer sources.
The second connector reads Domino's and Pilot Company public Posting API boards.
These employer connectors do not provide exhaustive statewide coverage.

## Data flow

The adapter reads the public [WVU Medicine career board](https://wvumedicine.wd1.myworkdayjobs.com/WVUH)
search and detail services, retains open/applyable jobs whose primary facility
location names the requested city, and returns the existing `NormalizedJob`
shape. The existing class refresh writes these into `JobListing`, so normal
class-scoped Save and application-status updates apply. No browse-pool save
workaround, new credentials, new database tables, or AI calls are needed.

The public website service was exercised on 2026-10-30. It is not a versioned
partner API. Unexpected responses and total detail failures raise a source
error rather than reporting a successful empty refresh. Requests use the existing
30-second timeout. Each refresh reads at most three 20-row search pages and
30 details, two details concurrently. This is a bounded subset, not an exhaustive
download. Facility matches are prioritized before the detail cap.

Live verification for `Summersville, WV` returned 24 matching open jobs, of which
23 passed the existing quality/deduplication filter, in 14.2 seconds. One detail
request returned 403 and was skipped without bypassing the denial. This is
source-read evidence, not a production database import or student-browser test.
Both search and detail requests explicitly request the `en-US` language;
Workday returned HTTP 500 when Node supplied its default wildcard language.
When a refresh keeps successful jobs but some requests or details fail, its
completed source row retains a `Partial results` warning with failure counts.
The teacher's existing source-status display shows that warning.

## Enable for an existing class

1. Open the teacher Job Board / Job Scout settings and choose the class.
2. Use a city region, for example `Summersville, WV`. ZIP-code-only and non-WV
   regions are unsupported by this connector.
3. Select **WVU Medicine (no key, city search)** and **Domino's & Pilot (no key, city search)**. Deselect CareerOneStop if
   access remains unavailable. Other sources remain independently selectable.
4. Save, then select **Refresh Now**. Check the `wvumedicine` source result
   and saved listing count.
5. As a student in that class, open Career, find a returned job, save it,
   and reopen the page to verify the saved status.

Existing stored source selections are not automatically rewritten. The new
default applies when the teacher creates a configuration through the API/UI.
The database schema's legacy source default is unchanged; direct database
provisioning must explicitly supply `sources: ["wvumedicine"]`.

## Read-only live check

```sh
npm run jobs:wvu:smoke -- "Summersville, WV"
npm run jobs:local:smoke -- "Charleston, WV"
```

The command reads public employer data, reports accepted counts and five sample
links, and writes nothing to the application database. An empty result exits
nonzero for manual investigation; it does not prove a source outage.

## Coverage and limits

- Covers WVU Medicine, Domino's and Pilot Company. Results include credentialed clinical roles as well
  as support roles. A returned job is not automatically an entry-level match.
- Uses facility city text, not geographic distance. It does not implement the
  class's mile radius. Facilities without the city in their location name are
  conservatively excluded, as are multi-location postings without a primary
  city match. The teacher settings explain the city-search limitation.
- Preserves requirements from the employer description, but does not invent
  wages or schedules. Unknown salary stays null.
- Preserves the employer's current open/applyable flags and application URL.
  Existing class-board expiration and weekly-refresh behavior still apply.
- The program-wide remote browse pool is unchanged. This source deliberately
  feeds class boards, where job saving already works.

The local-employer connector uses SmartRecruiters' documented public
[Posting API](https://developers.smartrecruiters.com/docs/endpoints), not its
authenticated applicant API. It requests each employer's city-filtered WV
postings and at most 20 details per employer, two concurrently. It checks city,
state and country again on the detail and skips inactive postings. Full job
sections supply requirements; only an explicitly stated hourly wage range is
used as salary. The live Charleston check accepted eight listings on 2026-10-30.
An empty city result is possible and does not imply the connector is broken.

## Workflow verification

On 2026-10-30 an isolated PostgreSQL 17 database with production migrations,
synthetic accounts and the restricted `vq_app` role verified the following:

- A teacher saved the class region/source configuration and triggered refresh
  through the real API. The completed refresh upserted 23 WVU Medicine jobs.
- The enrolled student retrieved those local jobs, marked an actual
  Housekeeping Aide listing applied, and retrieved its persisted status/notes.
- The Playwright journey tests exercise keyword search, Save, applied status,
  notes and page reload, plus HTTP-failure and network-failure recovery.

Reproduce the live refresh check only against a disposable local fixture DB:

```sh
node --import tsx scripts/verify-local-job-refresh.mjs
```

It requires the accounts from `scripts/seed-e2e-users.ts`, an explicit local
`DATABASE_URL` and `APP_BASE_URL`, and a running app. It refuses remote targets.
The browser regression test is `e2e/jobs-journey.spec.ts` and runs in CI.
The live check requires its exact requested run to report a positive WVU
upsert count before checking save/apply; old listings cannot establish success.
These checks are local evidence. A hosted pilot still requires selecting one
class, enabling its sources, and checking a real deployed student session.

For broader coverage, JSearch already has an adapter. Its provider currently
offers a [200-request free monthly tier](https://www.openwebninja.com/api/jsearch),
but a key and real regional coverage checks are still required. The existing
adapter uses RapidAPI credentials; direct-provider credentials are a different
integration. Choose any paid plan only after the owner approves its budget.
