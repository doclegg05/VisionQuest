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
| `interview_scheduled` with an appointment inside 24 h | Student, SMS | "Your interview with X is Tue 10:00 AM. Reply Y to confirm." | `Y` records the confirmation. `N` raises `connect_interview_unconfirmed` for the instructor — nothing is cancelled by machine. |
| `StudentSavedJob` applied 7 days ago, still `applied` | Student, SMS | "Did you hear back about the X job? Reply Y or N." | `Y` → saved job becomes `interviewing`. `N` → nothing. |
| 30 / 60 / 90 days after the `started` event | Student, SMS | "Still working at X? Reply Y or N." | `Y` → `SpokesEmploymentFollowUp` (1/2/3-month checkpoint, `employed`) **and** the connection advances to `retained_30/60/90`. `N` → follow-up `not_employed`, connection `closed` (`retention_lost`), `connect_retention_lost` alert. |
| Monday 10:00 ET, leads created in the last 7 days above the fit floor | Student, SMS | "N new jobs near you this week. Reply Y and Sage will show them." | `Y` → `connect_weekly_jobs_ready` (student-visible; Home next-step opens `/career`). `N` → nothing. Skipped entirely when N is 0. |

Every body starts `SPOKES:`, ends `Reply STOP to stop.`, and fits one
160-character segment. Every send writes an `OutboundMessage` row with links
replaced by `[link]`; the phone number is never in the row or the logs.

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
5. **Consent.** Each student opts in on **Settings → Text Messages**: the
   consent block names SPOKES, the frequency ("up to 2 a day, usually 1 a
   week"), quiet hours, STOP, and that texts are not required for the program.
   The API refuses to enable the channel without it, so there is no way to
   turn texts on for someone administratively.

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

## Known limits

- The retention question is keyed off the connection's **current status**, so a
  student who never answers the 30-day text is asked it again on the next
  eligible slot rather than skipping to 60. That is deliberate: an unanswered
  checkpoint is not a recorded outcome.
- A phone number shared by two students matches two preference rows; the
  inbound handler applies nothing and logs a warning, because there is no way
  to tell whose reply it is.
