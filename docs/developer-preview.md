# Developer preview

**READY — developer-only, synthetic, macOS-local.** Actual start/check/stop/restart and task persistence verified on 2026-09-10. This is not deployment, participant-pilot, production-security, or Linux approval. Those environments are outside this preview's scope, not blockers to using it locally. Existing uncommitted source changes and deletions were preserved; no real database or `.env.local` was used or modified.

## Run

From `/Users/brittlegg/VisionQuest`:

```sh
npm run preview:local          # build if inputs changed; otherwise reuse owned preview
npm run preview:check          # fingerprint, process ownership, DB roles, HTTPS/dev-login health
npm run preview:stop           # stop only verified owned processes; retain synthetic progress
npm run preview:local          # restart with the same database and credentials
npm run preview:reset -- --confirm  # DESTRUCTIVE: remove only this marked synthetic runtime
```

The verified preview was left running at **https://127.0.0.1:61850**. The subsequent private signature-storage repair and restart evidence are documented in [developer-preview-signatures.md](developer-preview-signatures.md). Ports are allocated dynamically and change after restart: use the URL printed by `preview:local` / `preview:check`, not a bookmarked port. Use `127.0.0.1`, not a LAN hostname. Accept the self-signed certificate warning only for this local preview; no system trust changes are made. The certificate expires after 30 days. Do not disable application TLS, secure cookies, CSRF, RLS, or CSP to work around errors.

Credentials: privately inspect **`/Users/brittlegg/VisionQuest/.developer-preview/credentials.json`** with a local editor. Its `accounts` array contains `login` and `password` for `preview-student`, `preview-second`, and `preview-instructor`. Use normal login; there is no dev-login bypass or admin fixture. Do not paste this file into chat, logs, screenshots, or commits: it also contains synthetic signing/encryption secrets. The directory is mode 0700 and credential/runtime files are 0600. Passwords remain stable across stop/restart; reset destroys them.

### Prerequisites

- macOS with `/usr/bin/sandbox-exec`, Node **24**, npm, and git.
- Homebrew PostgreSQL **17** at `/opt/homebrew/opt/postgresql@17/bin`, with `pgvector` installed for that PostgreSQL version (`vector.control` must exist in its extension directory).
- Homebrew OpenSSL at `/opt/homebrew/opt/openssl@3/bin/openssl`.
- Disk space for a private dependency/build snapshot and a synthetic PostgreSQL cluster. Initial build needs internet access only for the allowlisted tooling downloads below.
- Optional journey/browser checks require Google Chrome at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`.

No configured real database, provider keys, `.env.local`, system PostgreSQL service, or production credentials are prerequisites. Other platforms/Homebrew layouts fail descriptively rather than silently changing isolation.

## Isolation and lifecycle contract

- `.developer-preview/` is an ignored, owner-marked private runtime. A separate owner-marked `/private/tmp/vqp-<uid>-…` directory holds the PostgreSQL Unix socket. The local cluster has **no TCP listener**. Nothing connects to or migrates a real database.
- A fresh allowlisted environment replaces inherited service credentials and Node configuration. A source manifest copies current intended source, including uncommitted changes and deletions, into a private snapshot; dotenv files, symlinks, uploads, dependencies and previous build artifacts are excluded. Official catalog-selected forms must be tracked, unmodified blank templates; PDF fields are screened before build.
- Build/runtime subprocesses run under a macOS network sandbox denying remote connections. During builds only, a loopback CONNECT proxy permits `registry.npmjs.org`, `binaries.prisma.sh`, `fonts.googleapis.com`, and `fonts.gstatic.com` on port 443. It closes after the build. Loopback and Unix-socket connections remain allowed; this is a trusted-developer preview, not a sandbox against hostile same-user processes or arbitrary other local services.
- The production standalone app, TLS proxy and authenticated private persistent object service bind to loopback. App queries use non-superuser, non-BYPASSRLS `vq_app` with strict RLS context injection. Normal pre-auth login uses a separate local non-superuser BYPASSRLS role limited to the tables required for login/rate limiting/audit. The migration superuser is not supplied to the app.
- Process records bind PID, UID, start time and command. Because macOS denies `/bin/ps` inside the sandbox, the outside controller binds the standalone identity **only after checking its PPID against the verified worker**. Subsequent checks/signals require the saved identity. Unknown/stale identities fail closed; no broad `pkill`, port-owner termination or foreign process adoption.
- Stop preserves the database, credentials and built snapshot. Restart checks applied migration checksums and does not reseed completed fixtures. Changed source triggers a rebuild; a source change during build fails rather than launching stale code. Interrupted seeding requires explicit review/reset, never automatic overwrite.
- Operations are locked. If a command is interrupted and reports a stale lock or unowned postmaster, inspect the private `operation.lock`, ownership and process identities before recovery. Never remove a live lock, kill an unverified PID, or point these scripts at another data directory. Private diagnostics are in `.developer-preview/logs/`.

## Verified results

Latest lifecycle used the real npm commands above, not mocks:

- `preview:local` and `preview:check`: PASS on the existing owned build.
- Created a synthetic task via normal login and `/api/tasks`; verified Secure + HttpOnly session cookies.
- `preview:stop`: PASS; old worker and PostgreSQL exited and state records cleared.
- `preview:local` and `preview:check`: PASS after restart, with worker, standalone and PostgreSQL identities verified.
- Logged in again and fetched the **same task ID and title** via HTTP: persistence PASS. Preview remains running.
- Ten lifecycle/safety tests PASS (`npm run test:preview`), including bounded process-group timeout cleanup of a TERM-resistant grandchild holding inherited output pipes: environment replacement, private paths/symlinks, containment, stale/forged identity rejection, occupied-port safety, tooling proxy denial, dotenv exclusion, prerequisites, and reset confirmation refusal. Confirmed destructive reset was **not run** against the retained preview.
- Private snapshot production build, Prisma validate, 44 local migrations, typecheck and scoped lint: PASS. The existing private npm audit recorded exit 0; this is not a new production security approval.
- 22 affected tests PASS: `src/lib/zod-csp.test.ts`, `src/lib/dashboard/tasks.test.ts`, `src/app/api/tasks/route.test.ts`, `src/dashboard-security.test.ts` (Node/tsx module-mock runner).
- Isolation journey PASS: normal login, second-student mutation rejection, unauthenticated rejection, foreign-origin CSRF rejection, retired dev-login 404, and dashboard API reads. Runtime role flags and remote-network denial are also checked by the controller.
- Repeated production dashboard browser checks at **1440×1000** and **390×844**: PASS, no page errors or horizontal overflow, **zero observed CSP violations**. Earlier CSP evidence identified Zod's `Function` capability probe; `src/lib/zod-csp.ts` configures interpreted (`jitless`) task validation without weakening CSP. Regression test confirms zero `Function` attempts. This is bounded dashboard coverage, not every screen/action. Server logs from the same runs still show CSP `script-src`/eval warnings that were not diagnosed (see [local follow-up](workflow-local-followup.md)); the zero count covers browser-reported violations on the dashboard only.
- Earlier same-source HTTP form check: all **26** official fallback forms returned 200. No cloud upload success is simulated.

### Four journeys: LIMITED, not end-to-end outcome validation

| Journey | Local steps actually exercised | Not verified / unavailable |
| --- | --- | --- |
| Skills | Saved goal; catalog/matching read; learning-platform visit recorded; progression reread | External learning or course completion |
| Ready to work | Existing non-file requirement; explicit synthetic evidence; authorized instructor verification persisted | File evidence upload; full certification earned |
| Employment | Resume save/read; instructor-created synthetic opportunity; self-reported application; opportunities reread | External submission, recruiting, placement |
| Education | Education-planning goal persisted; 11-entry platform catalog read | Enrollment transaction or admission outcome |

The fixture seed creates two synthetic students and one instructor with a synthetic class, goals and minimal non-signature orientation progress. It does not award certifications. Journey checks add explicitly synthetic records and exercise one instructor-reviewed requirement; they are not participant evidence. They can be rerun with `node scripts/developer-preview-journeys.mjs` after `preview:check`, but **mutate the synthetic dataset** and are not a general production test runner.

AI/Sage providers, cloud storage, email, external jobs/learning/enrollment and other remote services are unavailable. Authenticated private local object uploads/downloads now persist across restart; missing local objects still allow official blank form fallback. See [signature repair evidence](developer-preview-signatures.md) for the actual signature/file/completion regression. Agent mode is disabled. Local storage success is not a working cloud integration.

## Evidence and handoff

Private evidence (contains only synthetic preview data, but do not publish wholesale):

- `.developer-preview/lifecycle-evidence.json` — actual start/check/stop/restart and exact task persistence.
- `.developer-preview/journey-evidence.json` — latest attempt (currently blocked at normal login by HTTP 429 after repeated test logins; not a successful post-rebuild journey run).
- `.developer-preview/review-fix-evidence.json` — reviewer fixes, successful sandboxed pre-rebuild journey observations, timeout/redirect regressions and post-rebuild login limitation.
- `.developer-preview/dashboard-1440.png`, `dashboard-390.png` — latest screenshots.
- `.developer-preview/forms-evidence.json` — earlier 26-form HTTP check.
- `.developer-preview/csp-before.json` — prior Zod probe attribution.
- `.developer-preview/commands.jsonl`, `logs/handoff-tests.log`, `logs/handoff-lint.log`, `logs/handoff-typecheck.log`, `logs/build.log`, `logs/migrate-deploy.log` — private command/build evidence. The initial 21 affected tests, scoped lint and typecheck passed after restart. Following reviewer fixes, 22 affected tests and scoped lint passed again (`logs/review-fix-tests.log`, `logs/review-fix-lint.log`); final `preview:check` and `git diff --check` passed.

## Final reviewer fixes and latest status

Both P2 findings were addressed:

1. The journey runner re-executes under the same OS local-only network sandbox **before reading credentials**, using the allowlisted environment. Chrome receives that sanitized environment explicitly and inherits the sandbox. A real remote-denial probe must return EPERM/EACCES; an internal flag alone is not trusted. Every Playwright API request sets `maxRedirects: 0`. A sandboxed local 302 regression confirmed the redirect target received zero requests (`logs/review-fix-redirect.log`). Page routing remains an additional browser guard, not the API security boundary.
2. `support.command` now spawns each command in its own dedicated session/process group. On timeout/output overflow it signals only that invocation's group, escalates TERM to KILL after one second even if the leader exits, and bounds pipe draining to another 200ms before rejecting. Its new regression killed a TERM-resistant grandchild retaining stdout and settled in about two seconds; all ten safety tests passed.

The fixed sandboxed journey runner passed all four LIMITED journeys, isolation and desktop/mobile checks with zero CSP violations against the existing preview at port 55727. The changed source fingerprint then required an actual private rebuild/relaunch; it succeeded and the latest `preview:check` passes at **port 56213**. A subsequent journey retry hit the normal login rate limiter (HTTP 429) after repeated synthetic logins. The parent subsequently verified private runtime/socket/process ownership and cleared only test-generated `RateLimitEntry` rows in the synthetic `vq_preview` database to make developer login available immediately. No account data, production system, authentication code or rate-limit policy changed. Do not claim that the final post-rebuild journey retry passed. The earlier stop/restart task persistence evidence remains valid; the rebuild retains the synthetic database.

Archival `docs/verification/workflow-local-followup/followup-{alerts,assets}.ts.txt` renames made by the parent were preserved. Final parent `preview:check` reports healthy at `https://127.0.0.1:56213`; typecheck and npm audit also passed (zero findings). Independent reviewer reapproval is not claimed. Production/Linux verification and full external outcome journeys remain outside scope.
