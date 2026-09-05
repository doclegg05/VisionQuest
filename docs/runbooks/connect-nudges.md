# Runbook — Match & Connect nudges (SMS + instructor alerts)

Phase 5 of `docs/superpowers/plans/2026-09-05-match-and-connect.md`. It ships
**dark**: the cron job registers on deploy and does nothing until an operator
opens two flags and provisions Twilio. Nobody is ever texted without a consent
row they created themselves on the settings page.

Related: `docs/plans/pg-cron-setup-runbook.md` (the scheduled layer as a whole —
`app.base_url`, the Vault `CRON_SECRET`, and how to verify a job actually ran).

---

## What runs

| Job | Schedule | Endpoint |
|-----|----------|----------|
| `connect-nudges` | `30 * * * *` (hourly, :30) | `POST /api/internal/nudges/run` |

Hourly is safe because the **runner** decides what is due, not the schedule:
quiet hours and the per-recipient cap live in `src/lib/nudges/sms-policy.ts`,
and the weekly nudge gates on its own Monday-10:00 ET slot.

## The rules

| Trigger | Who hears about it | Message / alert | Reply handling |
|---|---|---|---|
| `sent` with no `employer_viewed` event for 3 days | Instructor (`connect_employer_no_view`) | "…has not opened the packet. A phone call usually settles it faster." | — |
| Awaiting the employer for 7 days | Instructor (`connect_employer_no_response`) | "…you may want to consider re-sending it or calling." **Never re-sent automatically.** | — |
| `interview_scheduled` with an appointment inside 24 h | Student, SMS | "Interview with X, Tue 10:00 AM. Ask your teacher for the address. Reply Y to confirm." (points at the appointments page instead when the appointment has a location) | `Y` records the confirmation. `N` raises `connect_interview_unconfirmed` for the instructor and sends one ack ("Got it. Your teacher will call you.") — nothing is cancelled by machine. Keyed on the APPOINTMENT, so a rescheduled interview gets a fresh reminder. |
| `StudentSavedJob` applied 7 days ago, still `applied` | Student, SMS | "Got an interview for the X job? Reply Y or N." | `Y` → saved job becomes `interviewing`. `N` → nothing. |
| 30 / 60 / 90 days after the `started` event | Student, SMS | "Still working at X? Reply Y or N. If no, your coach will reach out." | `Y` → connection advances to `retained_30/60/90` **and** `connect_retention_confirm` asks staff to record the SPOKES follow-up. `N` → connection `closed` (`retention_lost`) + `connect_retention_lost`. **Neither answer writes `SpokesEmploymentFollowUp`** — see "Two clocks" below. Unanswered: re-asked after 7 days, then `connect_retention_unanswered` and no more texts for that checkpoint. |
| Monday from 10:00 ET, leads created in the last 7 days above the fit floor | Student, SMS | "N new jobs near you this week. Reply Y to see them on your Career page." | `Y` → `connect_weekly_jobs_ready` (student-visible; Home next-step opens `/career`; resolved when they open Career, and expired after 7 days). `N` → nothing. Skipped entirely when N is 0. One per student per week. |

Every body starts `SPOKES:`, ends `Reply STOP to stop.`, is plain ASCII (a
single non-GSM-7 character halves the segment to 70 chars), and fits one
160-character segment. Employer names and job titles arrive from third-party
feeds and are sanitised before they go in a body — control characters, bidi
overrides, zero-width characters and our own "SPOKES:"/"Reply STOP" phrases are
stripped. Every send writes an `OutboundMessage` row with links replaced by
`[link]`; the phone number is never in the row or the logs.

### Two clocks, and why the texts never write the grant record

`SpokesEmploymentFollowUp` is the DoHS/WIOA retention record. Its checkpoints
are **1, 3 and 6 MONTHS** from `SpokesRecord.unsubsidizedEmploymentAt`, and
`grant-kpi.ts` reports months 3 and 6. The Connect funnel counts **30/60/90
DAYS** from `Connection.startedAt` — a different anchor on a different scale.

A one-character text therefore never writes that record. Mapping day 30 onto
month 1 would overwrite a teacher's verified row on the shared
`(recordId, checkpointMonths)` unique key with no provenance to tell them
apart, and would park the day-60 answer at a `checkpointMonths` nothing reads.
Instead the answer moves the funnel and raises `connect_retention_confirm`,
which is the reconciliation point: a person confirms the employment and records
the SPOKES follow-up themselves.

### Replies

`Y`/`N` (and `YES`/`NO`) answer the most recent unanswered question sent to
that number in the last 72 hours. `YES` is ambiguous — Twilio treats it as an
opt-in keyword — so it is read as an ANSWER when a question is open and as
`START` when none is. `START` on its own only ever resumes a channel someone
already consented to; it cannot create consent. The runner never sends a second
question to a student who has one open.

A number on file for two students (a shared family phone) is handled
asymmetrically on purpose: a **STOP applies to all of them**, and everything
else applies to none, because there is no way to tell whose reply it is.

## Enable steps

1. **Twilio.** Set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and
   `TWILIO_FROM_NUMBER` in Render. Without all three, `sendSms` is a no-op and
   the runner logs `failed` outcomes; without `TWILIO_AUTH_TOKEN` the inbound
   webhook rejects every request, which is the correct default.
2. **Twilio inbound webhook.** In the Twilio console, set the number's
   "A message comes in" webhook to
   `https://visionquest.onrender.com/api/sms/inbound`, method **POST**. The
   route verifies `X-Twilio-Signature` against `TWILIO_AUTH_TOKEN` over that
   exact URL, so the URL configured here and `APP_BASE_URL` must agree
   (scheme and host included).
3. **Dry run first.**
   ```
   curl -s -X POST "https://visionquest.onrender.com/api/internal/nudges/run?dryRun=1" \
     -H "Authorization: Bearer $CRON_SECRET" | jq
   ```
   It writes nothing and sends nothing. `plan` names students only by a one-way
   correlation key. Expect `connectScope: "off"` until step 4.
4. **Flags** (SystemConfig rows, no deploy needed). Both must admit the class:
   - `connect_enabled_classes` — the Phase 4 flag, unset = off.
   - `sms_nudges_enabled_classes` — same vocabulary: unset/empty = off,
     `all` = every class, otherwise a comma-separated list of `SpokesClass` ids.
   Turning `connect_enabled_classes` off also stops the texts; there is no
   second switch to remember.
5. **Consent — and note that it is NOT backfilled.** Each student opts in on
   **Settings → Text Messages**: the consent block names SPOKES, the frequency
   ("up to 2 a day, usually 1 a week"), quiet hours, STOP, and that texts are
   not required for the program. They tick the box, we text a 6-digit code to
   the number, and consent is stamped only when that code comes back — so a
   typo cannot sign a stranger up for texts about a student's job search.
   There is no way to turn texts on for someone administratively.

   **Existing opted-in students stop receiving texts until they confirm.**
   Nobody's `smsConsentAt` was backfilled — a checkbox nobody ticked is not
   consent — so anyone who had SMS enabled before this shipped sees a
   "Confirm to keep getting texts" panel and gets nothing until they complete
   it. That includes the daily coaching prompt, which also runs through this
   policy now.

## Verify

- `SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'connect-nudges';`
- The run's own outcome: `cron.job_run_details` shows `succeeded` as soon as
  pg_net accepts the request, so check the **response**:
  `SELECT status_code FROM net._http_response ORDER BY created DESC LIMIT 5;`
  (401 = the Vault `CRON_SECRET` row is missing or stale.)
- What actually went out:
  ```sql
  SELECT "templateKey", status, count(*)
  FROM visionquest."OutboundMessage"
  WHERE channel = 'sms' AND "sentAt" > now() - interval '7 days'
  GROUP BY 1, 2 ORDER BY 1;
  ```
  This is the log to reconcile against Twilio's own message list.
- Consent state: `SELECT count(*) FILTER (WHERE "smsConsentAt" IS NOT NULL AND "smsRevokedAt" IS NULL) FROM visionquest."NotificationPreference" WHERE channel = 'sms';`

## Turning it off

- **One class:** remove its id from `sms_nudges_enabled_classes`.
- **All texts, immediately:** set `sms_nudges_enabled_classes` to empty. The
  next hourly run sends nothing; nothing is queued anywhere to catch up on.
- **The whole feature:** empty `connect_enabled_classes`.
- **One person:** they text STOP, or turn the toggle off in settings. Both set
  `smsRevokedAt`, and the send policy refuses on that column even if `enabled`
  is later flipped back on by some other path.
- **The job itself:** `SELECT cron.unschedule('connect-nudges');`

## When something looks stuck

- **Every run reports `already running`.** One sweep at a time is enforced by
  a SESSION-level advisory lock (`pg_try_advisory_lock(hashtext('connect-nudges'))`).
  A session lock is bound to the pooled backend that took it, so an unlock that
  lands on a different backend leaves it held — the runner logs
  `nudges_run_lock_not_released` when that happens. To inspect and clear:
  ```sql
  SELECT pid, objid, granted FROM pg_locks
   WHERE locktype = 'advisory' AND objid = hashtext('connect-nudges');
  -- then, having identified the holder:
  SELECT pg_terminate_backend(<pid>);
  ```
- **`nudges_admin_client_missing` in the logs, and nothing sends.** The admin
  Prisma client is not RLS-bypassing — `ADMIN_DATABASE_URL` is unset or points
  at `vq_app`. Both the runner and the inbound webhook refuse to act rather
  than sweeping over rows they cannot see (review finding F63). Fix the env
  var and redeploy; the probe is cached per process.
- **`net._http_response` shows a timeout but texts went out.** pg_net's default
  timeout is 5 seconds; the job sets `timeout_milliseconds := 240000`. If a
  timeout still appears, the run took over four minutes — check
  `MAX_WEEKLY_STUDENTS` and the ranking concurrency in `schedule.ts`.

## Known limits

- The retention question is keyed off the connection's **current status**, so a
  student who never answers the 30-day text is asked it again a week later, and
  then stops. The connection does NOT advance on silence: an unanswered
  checkpoint is not a recorded outcome, and `retained_30` has to mean somebody
  said so.
- A phone number shared by two students matches two preference rows. STOP
  applies to all of them; nothing else applies to any of them, and the run logs
  a warning. Those students cannot use the reply-based nudges until one of them
  uses a different number.
- Twilio's request signature carries no nonce and no timestamp, so a captured
  webhook request verifies forever. Every handler behind `/api/sms/inbound` is
  therefore idempotent (STOP/START are settings writes; a reply claims its
  question with a conditional UPDATE that a replay loses). Keep it that way.
