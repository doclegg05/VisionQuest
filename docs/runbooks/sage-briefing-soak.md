# Runbook: Sage Daily-Briefing Soak

**Goal:** Prove the autonomous per-student daily briefing loop
(`src/lib/sage/briefing.ts`) is safe to leave running unsupervised, before
promoting it out of the held-off state it has been in since 2026-07-08 (see
`docs/journals/2026-07-08-sage-autopilot-briefing-worktree-journal.md`).

**Promotion criterion** (charter target,
`docs/plans/2026-08-19-what-better-means-charter.md`): over a **trailing
14-day window**, **>= 95% of active students briefed daily**, **zero
`tool_violation` failures**. Both bars are read directly off `SagePanel` by
`scripts/sage-briefing-report.mjs` — see "How to watch" below.

Turning the flag on is an **owner decision** — this runbook does not flip it.
It only makes the soak measurable and describes the single env var that
starts/stops it.

## The control: `SAGE_AUTOPILOT_ENABLED`

One flag gates the whole loop, re-checked in two places so a flip takes
effect fast even mid-run:

- `src/app/api/internal/sage/briefing/route.ts` — the cron entry point checks
  it before enqueueing any `sage_briefing` jobs for the day.
- `src/lib/sage/briefing.ts` (`isAutopilotEnabled()`, called at the top of
  `runDailyBriefing`) — checked again inside every individual job, "because a
  queued job can outlive a flag flip." Turning the flag off mid-batch stops
  jobs that haven't started yet from doing anything, even if some jobs for
  that day already enqueued.

`isAutopilotEnabled()` is `SAGE_AUTOPILOT_ENABLED === "true" && agentMode() !==
"off"` — the global Sage agent kill switch (`SAGE_AGENT_MODE`) also has to be
non-`"off"`. Production currently runs `SAGE_AGENT_MODE=readonly` (per
`docs/runbooks/sage-agent-enablement.md` Stage 6a), so that half of the gate
is already satisfied; only `SAGE_AUTOPILOT_ENABLED` needs to move.

### Where to flip it

- **Production (Render):** web service → **Environment** → add
  `SAGE_AUTOPILOT_ENABLED=true`. Not currently listed in `render.yaml`
  (verify against that file, not this doc, before relying on it — env vars
  not listed there are dashboard-only). Save → Render restarts → effective on
  the next `/api/internal/sage/briefing` cron fire (or immediately for jobs
  not yet started, per the re-check above).
- **Local dev:** `.env.local` → `SAGE_AUTOPILOT_ENABLED="true"` (see
  `.env.example:48` for the documented default-false line to copy). Trigger a
  run manually with `GET /api/internal/sage/briefing` using the
  `CRON_SECRET` bearer token — the route accepts GET specifically "for manual
  operator runs (curl)."

### Abort switch

Set `SAGE_AUTOPILOT_ENABLED=false` (or unset it) and save. Same effective
timing as turning it on: the cron route stops enqueueing new jobs, and any
job still in flight self-checks the flag again before doing model work. This
does not roll back panels already generated — `SagePanel` rows already
written stay as they are; a dashboard-visible panel from before the abort
just won't be regenerated tomorrow. For a harder stop that also disables the
rest of the Sage tool loop, use `SAGE_AGENT_MODE=off` per
`docs/runbooks/sage-agent-rollback.md` — that also satisfies
`isAutopilotEnabled()`'s second condition and is the faster kill if the
concern is broader than just briefings.

## Schedule

- **Enqueue:** pg_cron job `sage-daily-briefing`, `0 11 * * *` (11:00 UTC / 7
  AM ET) — set in
  `prisma/migrations/20260708121000_add_sage_briefing_cron/migration.sql`.
  Chosen to land "well before daily-coaching (13:00) so the panel is ready
  when students log in." The route selects `{ role: "student", isActive:
  true }` (capped at 50 students per run — `MAX_STUDENTS_PER_RUN` in
  `route.ts`; a cap breach logs a warning, never fails silently) and enqueues
  one `sage_briefing` background job per student.
- **Processing:** the generic `job-processor` pg_cron job runs every 10
  minutes (`*/10 * * * *`, in the baseline migration), draining
  `sage_briefing` jobs from the queue. So panels should be `status: "ready"`
  (or `"failed"`) by roughly **11:10 UTC**, not exactly 11:00 — don't run the
  report at 11:01 and read a low "generating" count as a coverage problem.
- Jobs retry up to 3 attempts on throw (`src/lib/jobs.ts`) — only the
  `agent_turn_failed` failure path throws (job retries); `tool_violation` and
  `invalid_spec` mark the panel `"failed"` and return without retrying (see
  the source comments in `briefing.ts` next to each `markFailed` call).
  Because `SagePanel` is unique on `(studentId, panelDate)`, a retry
  overwrites the same row — the report only ever sees the latest outcome per
  student per day, never a duplicate.

## How to watch

Run the new report script daily (or whenever checking in on the soak):

```
node scripts/sage-briefing-report.mjs
```

This defaults to a 14-day window and prints a per-day breakdown (status
counts, coverage %, `tool_violation` count) plus a **SOAK VERDICT** line
judged against the 95%/zero-violation bars over the trailing 14 UTC days —
independent of whatever `--since` window you pass for the table itself. Other
useful invocations:

```
node scripts/sage-briefing-report.mjs --since=24h       # quick "did today run" check
node scripts/sage-briefing-report.mjs --json             # machine-readable, for scripting
node scripts/sage-briefing-report.mjs --out=path.json     # write the JSON report to a file
```

`node scripts/sage-briefing-report.mjs` is not wired into `package.json` —
run it directly with `node`, or add an `sage:briefing:report` script
alongside the existing `sage:*` entries when someone next touches
`package.json` (out of scope for this change; see project rules on avoiding
unrelated `package.json` edits).

Verdict values:

| Verdict | Meaning |
|---|---|
| `NOT_STARTED` | No `SagePanel` rows in the queried window at all — autopilot has never run in it. Check `SAGE_AUTOPILOT_ENABLED`. |
| `IN_PROGRESS` | No violations found yet, but fewer than 14 trailing days have any panel activity. Keep soaking. |
| `FAIL` | At least one evaluable day fell below 95% coverage, and/or at least one `tool_violation` failure occurred in the trailing 14 days. A `tool_violation` cannot be "soaked away" by finishing the remaining days clean — the 14-day window has to restart clean after investigating. |
| `PASS` | 14/14 trailing days >= 95% coverage, zero `tool_violation` failures. Ready to bring to Britt for the promotion call. |

Two caveats baked into the report, spelled out here so a `FAIL`/`PASS` isn't
misread:

1. **Active-student count is a current snapshot**, not a historical
   per-day count (there is no table tracking daily active-roster size).
   Coverage % for every day in the window uses today's active count as the
   denominator. If the active roster changed size mid-soak, older days'
   percentages are approximate — re-run near the end of the window for the
   most accurate read.
2. **"Briefed" means `status: "ready"`.** A panel still `"generating"` when
   the report runs (e.g., checked before the 11:10 UTC job-processor window
   closes) does not count as covered yet — that's a stale-check artifact,
   not a soak failure. Re-run later in the day if you see a lot of
   `generating` and low coverage on today's row specifically (today is
   deliberately excluded from the SOAK VERDICT window for this reason — only
   `--since`-scoped table rows show today's in-progress state).

### Secondary sources (spot-checks, not required for the verdict)

- **Audit trail** — `logSageAction` writes `sage.briefing.generated` and
  `sage.briefing.blocked` (the `tool_violation` path) rows, attributed to the
  `system:sage-autopilot` sentinel actor (never a real student, per the
  comment on `AUTOPILOT_ACTOR` in `briefing.ts`):
  ```sql
  SELECT "createdAt", action, summary, metadata
  FROM visionquest."AuditLog"
  WHERE "actorId" = 'system:sage-autopilot'
  ORDER BY "createdAt" DESC
  LIMIT 50;
  ```
- **Stuck jobs** — if coverage looks low well after 11:10 UTC, check the job
  queue directly (`BackgroundJob`, the table backing `src/lib/jobs.ts`) for
  anything still `pending`/`processing` or maxed out at 3 `attempts`:
  ```sql
  SELECT id, status, attempts, error, "createdAt"
  FROM visionquest."BackgroundJob"
  WHERE type = 'sage_briefing'
  ORDER BY "createdAt" DESC
  LIMIT 50;
  ```

## Promotion

When `node scripts/sage-briefing-report.mjs` reports `SOAK VERDICT: PASS`,
bring the report (or `--json`/`--out` output) to Britt for the promotion
call — this runbook does not define what "promoted" unlocks next (e.g.,
raising `MAX_STUDENTS_PER_RUN`, widening beyond the current active roster,
wiring briefing output into `SageInsight` per the deferred item in the
2026-07-08 journal). That is a follow-on scope decision, not implied by a
clean soak.
