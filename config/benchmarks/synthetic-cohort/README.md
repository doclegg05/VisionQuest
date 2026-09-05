# The synthetic benchmark cohort

One committed, fictional cohort that every Connect-, nudge-, performance- and
journey-facing benchmark measures against. It exists so those numbers are
**comparable with each other**: a matching score, a sweep duration and a funnel
count that describe different populations cannot be read side by side.

**Nothing here is real.** Names are invented; the towns and counties are real
West Virginia places, because the location scorer needs a real class region to
work against; phone numbers are all in the reserved fiction range
`(304) 555-01xx`; emails end in `.local` or `.invalid`, both undeliverable by
RFC 2606. No student, employer, contact or address corresponds to a person.

## Reading it

```js
import { loadCohort, visibleLeadsFor, toMatchStudent, toMatchLead }
  from "scripts/bench/lib/cohort.mjs";

const cohort = loadCohort();
```

`loadCohort()` returns **plain frozen objects** — no Prisma, no classes. Dates
are ISO strings; `@db.Date` columns are plain `YYYY-MM-DD`. It caches, so two
calls return the identical object and a 50 × 40 scorer does not re-parse 250 KB
per student. Because it is deep-frozen, a suite that tries to mutate its copy
gets a `TypeError` at the point of the mistake rather than corrupting the next
suite in the same process.

## What is in it

| Collection | File | Count | Notes |
|---|---|---|---|
| `meta` | `meta.json` | — | `epoch`, `idPrefix`, generator path |
| `instructors` | `instructors.json` | 3 | staff `Student` rows, role `teacher` |
| `classes` | `classes.json` | 3 | one instructor each; `region` feeds the location scorer |
| `students` | `students.json` | 50 | clusters, RIASEC code, résumé skills, **verified** cert ids |
| `workProfiles` | `work-profiles.json` | 50 | one per student; six availability shapes, all five transport modes, nine pay floors |
| `employers` | `employers.json` | 12 | one `do_not_contact`, one `paused`, four have hired a grad before |
| `contacts` | `contacts.json` | 12 | one per employer; one carries `doNotContactAt` |
| `leads` | `leads.json` | 40 | 36 open + one each filled/paused/closed/filled; 10 program-wide, 30 class-scoped |
| `connections` | `connections.json` | 20 | each carries its own `events` array |
| `spokesRecords` | `spokes-records.json` | 50 | 6 placed, with 1/3/6-month follow-ups |
| `applications` | `applications.json` | 9 | 6 back the placements; 3 self-directed, none of which qualifies |
| `jobListings` | `job-listings.json` | 12 | scraped-posting side, for saved jobs |
| `savedJobs` | `saved-jobs.json` | 35 | across the first 18 students |
| `appointments` | `appointments.json` | 5 | one is the interview the `interview_scheduled` connection points at |

Convenience indexes hang off the returned object as non-enumerable properties:
`studentById`, `leadById`, `employerById`, `contactByEmployerId`, `classById`,
`workProfileByStudentId`, `connectionById`, `connectionByKey`,
`spokesRecordByStudentId`.

## Properties suites may rely on

1. **Every id starts with `cbench`** (`cbenchstu01`, `cbenchlead02`). That
   prefix is how `seed-cohort.ts --reset` finds its own rows, and how a stray
   row is identifiable in any database. The shape is load-bearing, not
   cosmetic: several API routes validate ids with `z.string().cuid()`, and zod 4
   accepts neither a missing leading `c` (`bench_stu_01`) nor an underscore
   (`cbench_stu_01`). Either would be a 400 before any handler ran, and the
   Connect journey spec could not drive a single real request.
2. **Time is fixed.** `meta.epoch` is `2026-09-01T12:00:00Z` and every instant
   in the fixture is an offset from it. Nothing is relative to "today", so
   retention checkpoints, funnel medians and follow-up dates do not drift.
3. **Report parity holds by construction.** Exactly the six students whose
   connection reached `hired` or beyond carry `unsubsidizedEmploymentAt` on
   their SPOKES record, each backed by an accepted **and** verified
   `Application`. The three self-directed applications deliberately fail that
   bar (one is accepted but only self-reported), so the funnel's comparison
   line is non-zero while the three placement counts still agree.
4. **The awkward walks exist.** `connectionByKey` has `hired-skip`
   (sent → viewed → hired), `hired-direct` (sent → hired, never viewed) and
   `rolled-back-send` (a `sent` event with `sentAt` nulled and the row back at
   `student_approved`). Anything that counts sends or stages has to handle all
   three.
5. **Every hard block has something to fire on** — a non-open lead, a
   `do_not_contact` employer, weekend-only students against weekday shifts,
   must-have certs nobody holds, pay under a stated floor, and `walk`/`none`
   transport with no transit route. The one exception is
   `student_withdrew_from_employer`, which the cohort cannot model; the
   `hard-blocks` fixture supplies it.
6. **Every student can support precision@3** — at least three visible,
   unblocked leads and at least one labelled `fit`.

Properties 3 and 4 are asserted by the generator before it writes; property 6
is asserted by `scripts/bench/generate-matching-labels.mjs`. Breaking one is a
generator failure, not a silently weaker fixture.

## Changing it

```
node scripts/bench/generate-cohort.mjs          # rewrite the files
node scripts/bench/generate-cohort.mjs --check  # fail if they would change
node scripts/bench/generate-matching-labels.mjs # relabel (2,000 pairs)
```

Edit the generator, never the JSON. Then re-run the labels, re-run
`npx tsx --test src/lib/benchmarks/synthetic-cohort.test.ts` and update the
committed checksum it pins. **Every baseline measured against the old cohort
becomes incomparable** — record that in the baseline's `reason` when you update
it, because a metric that moved because the corpus moved is not a regression
and must not be read as one.

## Putting it in a database

```
DATABASE_URL=postgres://…/visionquest_local npx tsx scripts/bench/seed-cohort.ts
DATABASE_URL=…                              npx tsx scripts/bench/seed-cohort.ts --reset
```

Idempotent upserts. It refuses any host that does not look local or CI-scoped,
and refuses production-shaped hosts outright — `--allow-remote` does not
override that second check.
