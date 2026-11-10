# Deployment Runbook for VisionQuest

This runbook covers the supported production path: Render for app hosting plus Supabase for PostgreSQL and file storage.

## Prerequisites

- GitHub repo: `https://github.com/doclegg05/VisionQuest.git`
- Supabase project
- Render account
- A Mac or other host that runs the local Sage model through the relay. See the [Mac Sage connection runbook](docs/runbooks/mac-sage-connection.md)
- Optional Google AI Studio account for Gemini, only if Sage uses the cloud model
- Optional Google Cloud project for OAuth
- Optional SMTP provider for password reset mail
- Optional Sentry project

## Production Topology

[`render.yaml`](./render.yaml) declares one Starter web service. Scheduled work runs in Supabase `pg_cron`/`pg_net`; use the [cron runbook](./docs/plans/pg-cron-setup-runbook.md) to verify registrations and HTTP outcomes. The scripts in `scripts/run-*-*.mjs` are diagnostic helpers, not separate Render cron services.

The existing service was inspected on September 10, 2026:

| Setting | Render dashboard | Tracked blueprint |
| --- | --- | --- |
| Branch | `main` | Repository selected at creation |
| Build | `npm install; npm run build` | `npm ci && npx prisma generate && npm run build` |
| Start | `npm run prisma:migrate:deploy && npm start` | `npm run prisma:migrate:deploy && node .next/standalone/server.js` |
| Health check | Unset | `/api/health` |
| Retrieval abstention | Environment override absent; code defaults to 1 | `SAGE_RAG_ABSTAIN_DISTANCE=0.40` |
| Agent mode | Both mode/legacy overrides absent; current code resolves to `full` | `readonly` |

These are observed differences, not instructions to change agent permissions. A repository YAML value is not proof that the existing service uses it. Record actual values during release verification and update this snapshot after applying reviewed configuration changes. `npm start` uses `scripts/start-production.mjs`, which selects the standalone server when present.

## 1. Provision Supabase

### Database

1. Create a Supabase project.
2. In Supabase, open `Project Settings -> Database`.
3. Copy the Session pooler connection string and use it for `DATABASE_URL`.
4. If Render cannot reach the direct database host, also use the Session pooler string for `DIRECT_URL`.
5. In SQL Editor, ensure the app schema exists:

```sql
CREATE SCHEMA IF NOT EXISTS visionquest;
```

### Storage

1. Open `Storage`.
2. Use the existing private bucket named `Uploads` (case-sensitive). For a new project, create that bucket and set `STORAGE_BUCKET` to its exact name.
3. Open the S3 connection settings.
4. Record:

   - `STORAGE_ENDPOINT`
   - `STORAGE_BUCKET`
   - `STORAGE_ACCESS_KEY`
   - `STORAGE_SECRET_KEY`

5. Use `us-east-1` for `STORAGE_REGION` unless your storage configuration requires otherwise.

## 2. Create Secrets

Run locally:

```bash
openssl rand -hex 32
openssl rand -base64 32 | tr -d '\n'
openssl rand -base64 32 | tr -d '\n'
```

Use the outputs for:

- `JWT_SECRET`
- `TEACHER_KEY`
- `API_KEY_ENCRYPTION_KEY`

## 3. Get Third-Party Credentials

### Gemini (optional)

Production runs Sage on a local model through the Mac relay, so it needs no Gemini key. `GEMINI_API_KEY` is optional in `src/lib/env.ts`, and no boot probe checks it. While `AI_LOCAL_ONLY=true` (or one of the older switches `VQ_MAC_RELAY_ENABLED=true`, `COHORT_DEMO_MODE=true` or `COHORT_DEMO_LOCAL_ONLY=true`), `src/lib/ai/demo-local-only.ts` refuses cloud inference for the whole service, so a Gemini key would go unused.

To run Sage on Gemini instead:

1. Go to `https://aistudio.google.com/app/apikey`
2. Create an API key
3. Store it as `GEMINI_API_KEY`

### Optional OAuth

If you want Google sign-in:

1. Create a Google OAuth web client
2. Add the callback URL:

```text
https://your-app.onrender.com/api/auth/google/callback
```

3. Save:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`

### Optional email

If students need self-serve password reset by email, collect:

- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM`

### Optional Sentry

If you want error reporting:

- `SENTRY_DSN`
- `NEXT_PUBLIC_SENTRY_DSN`

Before you set either key, change these settings in the Sentry project. The app strips student details from its reports, and these settings are the second layer.

1. **Settings, Security & Privacy**: turn on **Prevent Storing of IP Addresses**.
2. **Settings, Security & Privacy**: turn on **Data Scrubber** and **Use Default Scrubbers**. Add `displayName`, `email`, `studentId`, `message` and `slug` to **Additional Sensitive Fields**.
3. **Settings, Data Retention** (if your plan shows it): pick the shortest event retention.
4. **Settings, Client Keys (DSN), Allowed Domains**: enter only `https://visionquest.onrender.com`.
5. **Settings, Spike Protection** and the key's **Rate Limit**: turn both on so a loop of errors cannot fill the quota.
6. Leave **Session Replay**, **User Feedback**, **Crons** and **Logs** off.
7. Consider the Sentry SDK tunnel option, so reports leave from Render's address and not the student's browser.
8. Sign Sentry's Data Processing Addendum under **Organization Settings, Legal & Compliance**.

Even with all of this, each report's web request shows Sentry the student's IP address and browser. Item 7 is the only setting that hides them.

## 4. Deploy To Render

### Option A: Blueprint

This is the preferred path.

1. In Render, create a new Blueprint.
2. Connect the GitHub repository.
3. Let Render read [`render.yaml`](./render.yaml).
4. Provide the required environment variables.
5. Confirm that the web service is created and its effective settings match the intended blueprint. Verify Supabase schedules separately using the cron runbook.

### Option B: Manual Web Service

If you do not use the blueprint:

1. Create a new Render web service.
2. Set:

   - Build command: `npm ci && npx prisma generate && npm run build`
   - Start command: `npm run prisma:migrate:deploy && node .next/standalone/server.js`
   - Health check path: `/api/health`

3. Configure Supabase schedules through the [cron runbook](./docs/plans/pg-cron-setup-runbook.md), including its URL/secret prerequisites and outcome checks. Do not add duplicate Render cron services.
4. Set the intended non-secret runtime flags explicitly, including `SAGE_RAG_ABSTAIN_DISTANCE=0.40`. Preserve the authorized agent mode; changing retrieval configuration does not authorize additional tools.

## 5. Set Environment Variables

### Required

| Variable | Notes |
|----------|-------|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Supabase Session pooler string |
| `DIRECT_URL` | Session pooler on Render unless direct host is reachable |
| `JWT_SECRET` | Hex secret, at least 32 characters (the boot probe refuses shorter) |
| `ADMIN_DATABASE_URL` | Connection string for the RLS-bypassing `postgres` role, used by `prismaAdmin` (crisis notifications, nudges, SMS webhook). **Required since 2026-09-07: a production boot without it is refused by `src/lib/boot-probes.ts`**, so a deploy fails to start rather than running with the admin client silently demoted to `vq_app`. |
| `RLS_CONTEXT_INJECTION` | Must be the exact string `true`. **Required since 2026-09-07 (same boot probe)**: anything else runs every query with no session context, and the staff-scoping policies enforce nothing. |
| `AI_LOCAL_ONLY` | `true` blocks every cloud AI call for the whole service. **Required since readiness task H4: a production boot is refused by `src/lib/boot-probes.ts` unless this is `true` (or an older switch is on: `COHORT_DEMO_MODE`, `COHORT_DEMO_LOCAL_ONLY`, `VQ_MAC_RELAY_ENABLED`), or `AI_CLOUD_INFERENCE` is exactly `allowed`.** Both together, or a misspelled value, also refuse the boot. See [Cloud AI block](#cloud-ai-block-check-before-deploying) |
| `AI_LOCAL_APPROVED_ORIGIN` | The one local AI origin Sage may call while the block is on: `http://127.0.0.1:11437`, the relay's adapter inside the service. Without it every local call is refused too. The older name `COHORT_DEMO_LOCAL_AI_ORIGIN` still works; if both are set they must name the same origin |
| `TEACHER_KEY` | Gate for `/teacher-register` |
| `API_KEY_ENCRYPTION_KEY` | Base64-encoded 32-byte key |
| `APP_BASE_URL` | Public Render URL |
| `CRON_SECRET` | Shared secret for internal scheduled routes |
| `STORAGE_ENDPOINT` | Supabase S3 endpoint |
| `STORAGE_REGION` | Usually `us-east-1` |
| `STORAGE_BUCKET` | `Uploads` (existing private bucket; case-sensitive) |
| `STORAGE_ACCESS_KEY` | Supabase storage access key |
| `STORAGE_SECRET_KEY` | Supabase storage secret key |

### Optional

| Variable | Purpose |
|----------|---------|
| `GOOGLE_CLIENT_ID` | Google OAuth |
| `GOOGLE_CLIENT_SECRET` | Google OAuth |
| `GOOGLE_REDIRECT_URI` | Google OAuth callback URL |
| `GEMINI_API_KEY` | Gemini credential. Needed only when Sage runs on the cloud model |
| `GEMINI_MODEL` | Override default Gemini model |
| `VQ_MAC_RELAY_ENABLED` | `true` turns on the Mac relay for local Sage and blocks cloud inference. Its other variables are in the [Mac Sage connection runbook](docs/runbooks/mac-sage-connection.md) |
| `ADMIN_KEY` | Registration key for the first admin account. See [Create the first admin](#8-create-the-first-admin) |
| `SAGE_AGENT_ENABLED` | Enable Sage tool calls and server-driven slash commands |
| `CF_ACCESS_CLIENT_ID` | Cloudflare Access service-token client id for the local Sage AI endpoint |
| `CF_ACCESS_CLIENT_SECRET` | Cloudflare Access service-token client secret for the local Sage AI endpoint |
| `AI_PROVIDER_CLOUDFLARE_ACCESS_CLIENT_ID` | Explicit alias for `CF_ACCESS_CLIENT_ID` |
| `AI_PROVIDER_CLOUDFLARE_ACCESS_CLIENT_SECRET` | Explicit alias for `CF_ACCESS_CLIENT_SECRET` |
| `SMTP_HOST` | Password reset mail |
| `SMTP_PORT` | Password reset mail |
| `SMTP_USER` | Password reset mail |
| `SMTP_PASS` | Password reset mail |
| `SMTP_FROM` | Password reset mail sender |
| `TWILIO_ACCOUNT_SID` | SMS notifications |
| `TWILIO_AUTH_TOKEN` | SMS notifications |
| `TWILIO_FROM_NUMBER` | SMS notifications |
| `SENTRY_DSN` | Server error tracking |
| `NEXT_PUBLIC_SENTRY_DSN` | Client error tracking |
| `LOG_LEVEL` | Logging verbosity |
| `COHORT_DEMO_MODE` | `true` opens the sign-in page to demo students and a shared demo instructor. See [Cohort demo mode](#cohort-demo-mode) |
| `REAL_STUDENT_DATA` | `true` once real students use the database. Set it only after the demo closeout has run. With it on, production refuses to start while `COHORT_DEMO_MODE` is on. See [Turn it off after Dec 18, 2026](#turn-it-off-after-dec-18-2026) |

Render dashboard note:

- Paste raw values without extra quotes.
- Use normal environment variables rather than Render Secret Files.

Local AI note:

- Student and staff Sage chat can be forced to the local Ollama provider for protected data.
- If the local endpoint is protected by Cloudflare Access, set the service-token values in Render env vars or in Program Setup. Env vars are preferred for production because they survive database secret-encryption-key drift.
- The local host must run Ollama, `scripts/ollama-relay.mjs`, and `cloudflared` as auto-starting services. Use `scripts/install-local-ai-services.ps1` from an elevated PowerShell on the local AI host.
- The installer sets `OLLAMA_CONTEXT_LENGTH=8192` on the Ollama service. Sage's chat calls use Ollama's `/v1` endpoint, which ignores the app's `num_ctx`, so without it a host with less than 24 GiB of VRAM loads models at 4,096 tokens and silently cuts the front off Sage's 7,000 to 7,500-token prompt, guardrails included. After one chat turn, `ollama ps` on the host must show `8192` in the CONTEXT column. A host set up before 2026-10-15 needs the installer re-run. Keep the value equal to `OllamaProvider.DEFAULT_NUM_CTX`, or to `ai_provider_num_ctx` if Program Setup overrides it (`-ContextLength <n>`). Details are in `docs/plans/2026-07-02-local-ai-operator-runbook.md`.

## 6. First-Run Data Setup

After the app is live, seed baseline data if your environment is empty:

```bash
DATABASE_URL="..." node scripts/seed-data.mjs
DATABASE_URL="..." node scripts/seed-documents.mjs
```

## 7. Create The First Teacher

Preferred path:

1. Set `TEACHER_KEY`.
2. Share it only with authorized staff.
3. Have the teacher register at `/teacher-register`.

Fallback path:

```bash
DATABASE_URL="..." node scripts/promote-teacher.mjs <email-or-student-id>
```

## 8. Create The First Admin

Admin accounts come from the same `/teacher-register` page as teachers, with a different key.

Preferred path:

1. Generate a key locally: `openssl rand -base64 32 | tr -d '\n'`
2. In the Render dashboard, open the web service, then **Environment**. Add `ADMIN_KEY` with that value and no quotes. Save, and let Render deploy. Without `ADMIN_KEY`, the page answers "Admin registration is not configured."
3. Open `/teacher-register`, choose **Administrator**, and enter the key, your name, your email and a password.
4. The page creates the admin account and signs you in.

If an active teacher account already uses that email, the page promotes it to admin instead. It keeps the password and MFA, signs out every open session, and issues no new session. Sign in again with the current password.

The route allows 5 attempts per key and 20 attempts across all callers in 15 minutes. After that it answers "Too many attempts" until the window ends.

Fallback path, for an account that already exists. Use the `ADMIN_DATABASE_URL` connection string, because `Student` has row-level security and `DATABASE_URL` connects as `vq_app`:

```bash
DATABASE_URL="..." npm run users:promote-admin -- <email-or-student-id>
```

The script sets the role to `admin`, signs out the account's open sessions, and writes an audit row.

## 9. Verification Checklist

### Service health

- `GET /api/health` returns 200
- Web service boots without migration failure
- Every pg_cron job shows a recent successful run. Run `npm run cron:health`. It checks the jobs listed in `EXPECTED_CRON_JOBS` in `scripts/lib/cron-health.mjs`, which are the 12 that the migrations register. To recount: `grep -rh -A1 "PERFORM cron.schedule(" prisma/migrations | grep -oE "'[a-z0-9-]+'" | sort -u | wc -l`

### Student flow

- An instructor can create a student account, and the student can sign in. Students cannot register themselves: `/signup` redirects to the sign-in page
- Student can open Sage and receive a streamed response
- Admin `Program Setup -> AI Provider -> Test Connection` succeeds if Sage is using local AI
- Goal extraction runs after chat
- Orientation loads
- File upload succeeds
- Portfolio creation succeeds
- Certifications page loads

### Teacher flow

- Teacher can sign in
- Teacher dashboard loads
- Intervention queue loads
- Student detail page loads
- Teacher can review student goals or certifications

### Optional integrations

- Password reset mail sends if SMTP is configured
- Google OAuth callback works if enabled
- Sentry receives test errors if configured

## 10. Monitoring And Recovery

### Health check

```bash
curl https://your-app.onrender.com/api/health
```

### Logs

- Use the Render dashboard for web service logs
- Use Supabase `cron.job_run_details` and `net._http_response` for scheduled jobs. The [cron runbook](./docs/plans/pg-cron-setup-runbook.md) has the queries
- Use Supabase logs for database and storage issues
- Use Sentry for client and server exception tracking if enabled

### Backups

Supabase handles managed backups. To make an export yourself, follow these steps in order. The export holds every student record and this repository is public, so the file must never be inside this checkout.

`pg_dump` needs the session pooler or the direct connection. It does not work through the transaction pooler on port 6543. The value stored in the Render dashboard, service `visionquest`, **Environment** tab, key `ADMIN_DATABASE_URL` is the right kind.

1. Open a new terminal window. In the Render dashboard, service `visionquest`, **Environment** tab, copy the value of the key `ADMIN_DATABASE_URL`. Run the first line below, paste the value, and press Return. Nothing shows as you paste, and the value is not saved in your shell history. The second line clears the clipboard.

   ```sh
   read -rs ADMIN_DATABASE_URL && export ADMIN_DATABASE_URL
   pbcopy < /dev/null
   ```

   Never type or paste the value into a command itself. Every command below reads it from the variable.
2. Make the export in a folder outside the checkout that only you can open.

   ```sh
   mkdir -p -m 700 "$HOME/VisionQuest-backups"
   pg_dump "$ADMIN_DATABASE_URL" --schema=visionquest --file="$HOME/VisionQuest-backups/visionquest-$(date +%Y-%m-%d-%H%M).sql"
   chmod 600 "$HOME/VisionQuest-backups/"*.sql
   ls -lh "$HOME/VisionQuest-backups"
   ```

   Success looks like a file named for today with a size above zero. If `pg_dump` prints an error, stop, keep the output, and ask a developer.
3. Close the terminal window when you are done. That removes the value from memory.

Never copy the export into this checkout. As a second lock, `.gitignore` leaves out `/*.sql`, `/*.dump` and `/backups/` at the top of the checkout.

Restore:

```sh
psql "$ADMIN_DATABASE_URL" --set ON_ERROR_STOP=1 --single-transaction --file="$HOME/VisionQuest-backups/NAME_OF_THE_EXPORT.sql"
```

Replace `NAME_OF_THE_EXPORT.sql` with the file name that `ls` showed. This puts an export into a database whose `visionquest` schema is empty, such as a new Supabase project. It stops at the first error and then changes nothing. Putting an export back over the live database removes every change made after the export was taken. Do not do that alone: ask a developer, and read `docs/runbooks/backup-restore.md` first.

### Rollback

1. Roll back the service in Render to the last healthy deploy.
2. Verify whether the prior application is compatible with the current schema. Additive retrieval changes normally need only an application/configuration rollback. Investigate migration failures before selecting a database recovery procedure; a wholesale restore can discard unrelated live writes.

## Cohort demo mode

For the AI Leadership Academy cohort (Oct 15 to Dec 18, 2026). With the switch on, the sign-in page keeps its username and password form and adds two buttons, "Explore as a student" and "Explore as an instructor". The student button makes a new mock student and opens the first-day welcome steps. The instructor button signs the visitor in to one shared demo instructor, who sees only the "Cohort Demo Class" and its students. Nothing is emailed or texted for a demo account.

This opens the site to anyone with the link, so turn it on only while every record in the live database is mock data. That was true on 2026-10-19.

### Turn it on

1. Open the Render dashboard and select the VisionQuest web service.
2. Open **Environment** and choose **Add Environment Variable**.
3. Set the key to `COHORT_DEMO_MODE` and the value to `true`. Paste the value without quotes.
4. Save, and let Render deploy.
5. Open https://visionquest.onrender.com and check that both demo buttons show. Click each one. The student button opens the welcome steps with a privacy note, and the instructor button shows that new student in the demo class.

The switch is read when each request arrives, so it needs a restart and no rebuild. The value `true` turns it on, and capital letters or spaces around it do not matter. Any other value, or no variable, leaves it off.

While it is on, Google sign-in and the "Staff? Register here" link are hidden. Staff sign in with their own username and password.

### Limits

The defaults need no setup. Raise or lower them by adding any of these in the same **Environment** page. Each value is a whole number of 1 or more. A value that is not a valid number is ignored, the default applies, and one warning is logged with the variable name.

| Variable | Default | What it limits |
|----------|---------|----------------|
| `COHORT_DEMO_STUDENTS_PER_HOUR` | 40 | New demo students started on the whole site in one hour |
| `COHORT_DEMO_STUDENTS_PER_DAY` | 200 | New demo students started on the whole site in one UTC day |
| `COHORT_DEMO_SAGE_PER_DAY` | 2000 | Sage messages sent by all demo accounts together in one UTC day |

Two limits are fixed in code. One network can start 10 new demo students an hour, which only slows repeat clicks because the address comes from a header the caller controls. The shared demo instructor can send 300 Sage messages an hour and 1,000 a day. A visitor past any limit sees a plain message asking them to try again later.

### Turn it off after Dec 18, 2026

Closing the demo takes twelve steps over two days. Do them in order, and do not skip one. Each step says what success looks like. If a step fails and the step does not say how to fix it, stop, keep the output on screen or copy it into a note, and ask a developer. Never change the database by hand.

The tool in this checkout, `scripts/demo-closeout.ts`, deletes every account marked as demo: the demo students and the shared demo instructor. It deletes the "Cohort Demo Class" and every row attached to them, such as chats, goals, upload records, forms, alerts, appointments, case notes, Sage memories, queued jobs and the audit log entries about them. It does all of it in one transaction, then writes one audit log entry that holds counts only. It prints counts, the database name and the host. It never prints a name, a login, an email, an id or the connection string.

What the tool does not remove:

* **Mock students that are not marked as demo.** An account made before demo mode, or made by hand, has no demo mark. The preview counts these under `unmarked`. A number above 0 means mock accounts may still be in the database, and they will look like real students. The tool cannot tell mock from real and never deletes an unmarked account. Decide about each one before real students start.
* **Public credential pages of those unmarked accounts.** The preview counts them as `publicCredentialPages`, and the ones anyone can open at `/credentials/...` as `publicCredentialPagesSwitchedOn`.
* **Uploaded files in storage.** The tool deletes the database row for each demo upload. The file itself stays in the bucket named by `STORAGE_BUCKET`, and those files may hold real visitors' documents, because anyone could use the demo. The preview gives the number of files as `uploadedFilesLeftInStorage` and the number of folders as `leftBehind.storageFoldersOfDemoAccounts`. The tool does not remove them. Removing them is a separate step that is not built yet.
* **Text that mentions the demo.** The preview counts program settings that hold the demo class id (`leftBehind.systemConfigNamingDemoClass`), notices to staff that name a demo account (`leftBehind.staffNotificationsAboutDemoStudents`) and opportunity listings copied from a demo class job lead (`leftBehind.opportunitiesFromDemoLeads`). It changes none of them.
* **Shared program content** that a demo account only pointed at: employers, events, form templates, program documents, regions, and job listings of other classes. Rate limit rows stay too.

1. **Bring the main checkout up to date.** Use the main checkout of this repository, not a copy made for one task. In a terminal opened in that folder, run:
   ```sh
   git switch main
   git pull
   npm ci
   npx prisma generate
   ```
   Success looks like each command finishing with no line that starts with `error`. If `git switch main` refuses because of changed files, stop and ask a developer.
2. **In Render, delete `COHORT_DEMO_MODE` and keep `AI_LOCAL_ONLY`.** Open the Render dashboard, service `visionquest`, **Environment** tab. Delete the key `COHORT_DEMO_MODE`. Delete `COHORT_DEMO_STUDENTS_PER_HOUR`, `COHORT_DEMO_STUDENTS_PER_DAY` and `COHORT_DEMO_SAGE_PER_DAY` too if you added them. Do not delete `AI_LOCAL_ONLY`. Its value must stay `true`, because it is the switch that blocks cloud AI for every account (see [Cloud AI block](#cloud-ai-block-check-before-deploying)). Save, and wait until the deploy shows **Live**. Success looks like the sign in page with no demo buttons and with the Google block back. From then on the demo endpoints answer 404, and a demo session that is still open stops working on its next request.
3. **Wait 15 minutes after the deploy shows Live.** A visitor who was using the demo when it closed may still have a request in flight. Success looks like 15 minutes on the clock since the deploy went Live.
4. **Open a new terminal window used only for this, and load the connection string.** In the new window, go to the main checkout folder. Copy the value stored in the Render dashboard, service `visionquest`, **Environment** tab, key `ADMIN_DATABASE_URL`. Run the first line below, paste the value, and press Return. Nothing shows as you paste, and the value is not saved in your shell history. The second line clears the clipboard.
   ```sh
   read -rs ADMIN_DATABASE_URL && export ADMIN_DATABASE_URL
   pbcopy < /dev/null
   ```
   Never type or paste the value into a command itself. The tool reads it from the variable and reads no file for it. Success looks like `test -n "$ADMIN_DATABASE_URL" && echo loaded` printing `loaded`.
5. **Run the preview and read it.**
   ```sh
   node --import tsx scripts/demo-closeout.ts
   ```
   The preview reads and changes nothing. Read it top to bottom:
   * The first line is `Target: database ... on host ...`. The host must be the production database host shown in the Supabase dashboard, Project Settings, Database. If it is not, stop.
   * `marked` is the accounts and classes the apply would delete, and `rowsToDelete` is the rows that would go, table by table.
   * `unmarked` is the accounts the tool leaves. Read the sentences under the counts. A number above 0 means mock accounts may still be in the database.
   * `leftBehind.orphans` lists rows that name an account or class that does not exist. Write down the total the tool prints.
   * `refusals` is the list of reasons an apply would stop. Each is one sentence and a count. Fix the cause and run the preview again. The tool has no option that skips a refusal.

   Success looks like exit code 0, no line that starts with `An apply would be refused`, and a last line that says `To apply, use --expect-accounts=` followed by a number. Write that number down. If the refusal says a demo account was used in the last 30 minutes, check step 2 again, wait 30 minutes and run the preview again. For any other refusal you cannot fix yourself, stop, keep the output, and ask a developer.
6. **Confirm the backup right before the apply.** In the Supabase dashboard open the project, then Database, then Backups. Check that a backup from today exists, or that point in time recovery is on. If neither is true, make an export with the steps under [Backups](#backups), in this same window. The variable is already loaded, so skip their step 1. Restoring a backup puts the whole database back as it was when the backup was taken, so every change made after it is lost, including real work done since. That is why the backup must be from right before the apply. Success looks like today's backup in the list, or an export file in `$HOME/VisionQuest-backups` with a size above zero. Without one, do not go on.
7. **Run the apply.** Use the number from step 5 in place of `NUMBER`:
   ```sh
   node --import tsx scripts/demo-closeout.ts --apply --confirm-demo-disabled --expect-accounts=NUMBER
   ```
   `--confirm-demo-disabled` is your word that step 2 is finished. The tool can see only this terminal, not Render. `--expect-accounts` makes it refuse if the database changed since the preview. Success looks like exit code 0 and a last line that says `Checked again after the closeout was saved: 0 accounts are marked as demo.` The other exit codes:
   * Exit code 2: it refused and deleted nothing. Read the sentence, fix the cause, and start again from step 5.
   * Exit code 1: it stopped. It prints: "The tool stopped. Run the preview again to see whether anything was deleted. If `marked` is 0, the closeout finished. If this keeps happening, stop and ask a developer. Do not change the database by hand." Do exactly that. A lost connection while the database was saving can leave the outcome unknown, which is why the tool does not say whether anything was deleted.
   * Exit code 3: the closeout was saved, but a demo account was created while it ran, so demo mode is still on somewhere. Check step 2 again, wait 30 minutes and start again from step 5.
8. **Run the preview again.**
   ```sh
   node --import tsx scripts/demo-closeout.ts
   ```
   Success looks like `marked` is 0 and `unmarked.students` is the number you expect, and the line `0 rows name an account or class that does not exist.` If `marked` is above 0, start again from step 5. If the orphan total is above 0, stop and ask a developer.
9. **Set `REAL_STUDENT_DATA` to `true`.** In the Render dashboard, service `visionquest`, **Environment** tab, add the key `REAL_STUDENT_DATA` with the value `true`. Do it only after step 8 has succeeded, and before the first real student gets an account. From then on production refuses to start if `COHORT_DEMO_MODE` is ever turned on again. Success looks like the next deploy showing **Live**.
10. **Check the site.** Success looks like all of these:
    * The Render log of the start after step 9 has no line named `boot_probe_demo_closeout_unfinished` and none named `boot_probe_demo_rows_beside_real_data`.
    * Signed in as a teacher, the class list has no "Cohort Demo Class", and the queue of students who need attention has no demo student.
    * Sage answers one message.
    * You have decided what to do with each unmarked mock account and each file the preview counted.
11. **Close the terminal window.** That removes the connection string from memory. Success looks like the window gone.
12. **The next day, run the preview once more, then close the terminal.** Open a new terminal window, do step 4 again and run the preview from step 5. Success looks like `marked` still 0. If it is above 0, demo accounts were made after the closeout. Stop and ask a developer. Then close the terminal window.

The tool refuses, and deletes nothing, in these cases: demo mode is on in its terminal; its connection is limited by row level security; the checkout and the database are not at the same migration; the number given with `--expect-accounts` is not the number of marked accounts; a demo account was created or used in the last 30 minutes; a class has the demo class code but the demo instructor does not own it; an account with no demo mark is in the plan, is enrolled in the demo class or has rows attached to it; a marked account teaches or coordinates a class or region that has unmarked students; a marked account is named on a row that belongs to someone else or to the program; a marked account is on an audit record, a Sage action or a message about a person or class that is not demo; a kept row points at a row the closeout would delete and the database would blank that link. It also checks its own work before it saves. If any row would be left pointing at a deleted account or class, or any table would lose a row the preview did not count, it cancels the whole transaction and reports a refusal.

### Reset the fictional roster (owner operation)

The reset tool defaults to a preview and never deletes student records. It archives and disables marked demo students in the owned demo class, invalidates their sessions and the shared instructor session, and frees the four starter login slots. On the next server start and demo entry, bootstrap creates fresh starter students. Historical chats, goals, files and audit records remain attached to the archived rows. Instructor settings and shared program content are unchanged. Daily usage counters are not cleared.

1. Turn demo mode off in Render and wait for the deployment to finish on every instance.
2. Run from this checkout with `ADMIN_DATABASE_URL` supplied securely in the environment (the script never loads `.env.local`):
   ```sh
   node --import tsx scripts/reset-demo-roster.ts
   node --import tsx scripts/reset-demo-roster.ts --apply --confirm-demo-disabled
   ```
3. Re-enable demo mode in Render and wait for the restart/deployment. The restart clears the bootstrap cache. Enter as the instructor and check the four fresh starter students.

The tool refuses a class not owned by the marked demo instructor, unmarked students in the demo roster, and selected students enrolled in another class. Preview reports counts only. Apply is transactional; any error rolls back all changes. Keep the switch off until the reset finishes. There is no reset endpoint available to public demo visitors. This is a roster reset, not deletion of demo history or instructor settings. To delete the demo data for good, follow [Turn it off after Dec 18, 2026](#turn-it-off-after-dec-18-2026).

## Chat-First Rebuild (June 2026): operational notes

- **Kill switches** (env vars, all default ON): `SAGE_AGENT_ENABLED=false` (agent tools),
  `SAGE_MEMORY_ENABLED=false` (memory extraction/retrieval), `SAGE_RAG_MODE=keyword`
  (revert to legacy retrieval). Retrieval tuning: `SAGE_RAG_DISTANCE_MARGIN` (0.02),
  `SAGE_RAG_MAX_DISTANCE` (0.55), `SAGE_RAG_MIN_SCORE_RATIO` (0.85),
  `SAGE_RAG_ABSTAIN_DISTANCE` (release setting 0.40; code default 1 leaves the filter effectively off), and `SAGE_MEMORY_DUP_DISTANCE` (0.08).
- **One-time after first deploy**: trigger the embedding backfill with one curl
  (idempotent; until then Sage uses keyword fallback):
  `curl -X POST https://visionquest.onrender.com/api/internal/rag/backfill -H "Authorization: Bearer $CRON_SECRET"`
  Pass `-H "Content-Type: application/json" -d '{"force":true}'` to re-embed everything.
  (Local equivalent: `npm run sage:rag:backfill`.)
- **Optional**: set `COS_USER_ID` + `COS_API_TOKEN` (CareerOneStop) to activate the WV
  state-jobs adapter for local job feeds.
- All migrations are additive and apply automatically via `prisma migrate deploy`.
- E2E locally: `BASE_URL=http://localhost:3100 PORT=3100 npx playwright test` if port 3000
  is occupied (config honors BASE_URL/PORT).


### Demo Sage: local inference only

Public demo mode overrides the saved provider setting for the entire service,
including instructor, system, and background work. Generative requests use the
configured local endpoint and the pinned `gemma4:12b` model. Direct Gemini and
OpenRouter inference is refused before network access; `preferCloud` cannot
bypass the restriction. A local outage never falls back to a cloud model.

Keep `AI_LOCAL_ONLY=true` set when closing demo entry. It does not depend on
any demo variable, so removing `COHORT_DEMO_MODE` and `COHORT_DEMO_LOCAL_ONLY`
later leaves the block on. This safeguard applies to every account on this
service. It does not alter the saved provider settings.

Cloud AI is allowed only by a written owner decision, and then by removing
every local only switch and setting `AI_CLOUD_INFERENCE` to exactly `allowed`.
That variable only lets production start; which prompts may then reach a cloud
model is still decided by `AI_CLOUD_POLICY`, which reads as `permissive` when
unset. Set `AI_CLOUD_POLICY=local_only` or `lanes` in the same change.

### Cloud AI block: check before deploying

Production refuses to start unless it says whether cloud AI is blocked or
allowed. In the Render dashboard, service `visionquest`, Environment tab,
confirm each of these before the first deploy that carries the check, and again
after any change to these variables:

1. `AI_CLOUD_INFERENCE` is not set.
2. `AI_LOCAL_ONLY` is not set, or is exactly `true`. A value such as `yes` stops the start.
3. `COHORT_DEMO_LOCAL_AI_ORIGIN`, if set, is exactly `http://127.0.0.1:11437`. Any other value makes every Sage call fail.
4. `VQ_MAC_RELAY_ENABLED` is exactly `true`, and `VQ_MAC_RELAY_AGENT_TOKEN` and `VQ_MAC_RELAY_APP_TOKEN` are still present.
5. `COHORT_DEMO_MODE` and `REAL_STUDENT_DATA` are not both on.

After the deploy, check that the service is live on the new commit and that
Sage answers one message. If the deploy did not go live, the Render log has a
`Boot probe failure` line that names the variable.

Cloud embeddings are blocked without selecting another embedding model or
reindexing stored vectors. Document retrieval falls back to keyword search;
embedding-dependent memory work can remain pending or fail. Switching to local
embeddings requires a separately approved index migration.

The Render server must reach an authenticated, owner-approved endpoint for the
Mac's local model. Set `COHORT_DEMO_LOCAL_AI_ORIGIN` to that verified origin
(scheme, host, and optional port only), matching the configured provider URL.
Until it is explicitly pinned, demo inference fails before network access; the
saved legacy URL is not implicitly trusted. The origin pin is an operator trust
decision, not proof that an arbitrary remote server is local. A model listening on the Mac's loopback address alone is not
reachable from Render. Do not enable a new tunnel or change DNS as part of this
switch. Verify the existing transport separately; if it is unavailable, Sage
reports an outage while the portal remains usable. Hosted Ollama `:cloud` tags,
known cloud API endpoints, and HTTP redirects are refused in demo mode.

The VisionQuest-specific outbound Mac connection uses the existing Render address
and keeps model ports private. See [Mac Sage connection](docs/runbooks/mac-sage-connection.md)
for installation, credentials, single-instance limits, verification, and rollback.
