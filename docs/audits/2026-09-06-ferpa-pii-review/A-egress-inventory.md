# A — Third-Party Egress Inventory (FERPA/PII)

**Repo:** `/home/user/VisionQuest` @ `666877b` ("Match and Connect + benchmark suite (#204)")
**Method:** read the code, not the doc comments. Every claim below is `file:line`-cited. Verified 2026-09-06.
**Scope:** every path by which student data leaves the VisionQuest server process to a party that is not VisionQuest.

---

## 0. The routing switch, stated precisely

`resolveAiProvider()` (`src/lib/ai/provider.ts:174-196`) is the only FERPA routing decision in the codebase, and it does this:

```
if (sensitivity is student_record | staff_entered):        # provider.ts:180-186
    if SystemConfig.ai_provider == "local":  -> Ollama
    else:                                    -> getCloudProvider()  # Gemini
```

There is **no refusal branch**. `getConfiguredProviderType()` (`provider.ts:22-25`) defaults to `"cloud"` for *any* value that is not the literal string `"local"` — including unset, `"Local"`, a typo, or a `SystemConfig` read failure. So "local-only" is not enforced anywhere; it is a preference that yields to one config row. `.claude/MEMORY.md` records the measured consequence on dev: `ai_provider=cloud`, **57/57 `student_record` calls cloud-routed**.

Embeddings are worse: `src/lib/ai/embedding-provider.ts:5-11` declares a "FERPA FREEZE — routing keys ONLY off the existing `ai_provider` value… **No sensitivity parameters**". `resolveEmbeddingProvider()` (`embedding-provider.ts:62-69`) takes no `sensitivity` at all and cannot be told to refuse.

Count: **32 `sensitivity: "student_record"` call sites across 14 files** (the 2026-09-01 audit F15 said 27/13; it has grown). `grep -rn 'sensitivity: "student_record"' src/ --include=*.ts | grep -v '\.test\.'`

---

## 1. Executive table

Risk 1 (informational) – 5 (student re-identifiable outside the program with no consent or audit).

| # | Flow | Destination | Data classes that actually go | Tag (task / sensitivity) | Gate in code | Risk | Evidence |
|---|---|---|---|---|---|---|---|
| 1 | Student Sage chat turn (streaming) | **Google Gemini** when `ai_provider != "local"` | Full transcript history + current message; **student's real `displayName`** in the system prompt; goals (BHAG/monthly/weekly/daily), readiness snapshot, alerts, recent events, career/discovery summary, retrieved memories, RAG doc snippets | `sage_student_chat` / `student_record` | `logAiAuditEvent` ×8 only (audit, not a gate). No consent scope covers this. | **5** | `src/app/api/chat/send/route.ts:232-233,380-384,829-832`; name injected `src/lib/sage/system-prompts.ts:690-698`; bundle `src/lib/sage/context-bundle.ts:445-450` |
| 2 | Staff Sage chat turn | Gemini (same switch) | Teacher's transcript, which routinely names students | `sage_staff_chat` / `staff_entered` | audit only | 4 | `send/route.ts:232-233` |
| 3 | **RAG query embedding** — the raw student message | **Gemini embeddings API** (`gemini-embedding-001`) | Verbatim student chat message, unredacted, un-sanitised | **none — no task, no sensitivity, no audit event** | **none** | **5** | `src/lib/sage/knowledge-base-server.ts:288` → `src/lib/sage/hybrid-retrieval.ts:141-145,159` → `src/lib/ai/embeddings.ts:61-68` → `src/lib/ai/gemini-embedding-provider.ts:20,~90` |
| 4 | **Memory retrieval embedding** | Gemini embeddings API | The student's message, used as the memory query | none | none | 5 | `src/lib/sage/memory/retrieve.ts:67`, called with `userMessage` at `retrieve.ts:170,215`, from `send/route.ts:739` |
| 5 | **Memory *storage* embedding** | Gemini embeddings API | The extracted durable fact itself — by prompt design: transportation, childcare, work history, life circumstances, struggles | none | none | 5 | `src/lib/sage/memory/store.ts:152-155`; what a memory contains: `src/lib/sage/memory/extract.ts:31-38` |
| 6 | Post-response extraction (goals / discovery / mood / classroom) | Gemini | Last N conversation turns verbatim, incl. mood and crisis-adjacent disclosures | `sage_post_response` / `student_record` | audit ×4 | 5 | `src/lib/chat/post-response.ts:309-313,324` |
| 7 | Memory extraction (student) | Gemini | Same transcript slice | inherits #6's provider | **no `logAiAuditEvent` in the module** | 5 | `src/lib/sage/memory/extract.ts` (0 hits for `logAiAuditEvent`) |
| 8 | Memory extraction (staff) | Gemini | Staff transcript slice | `sage_post_response` / `staff_entered` | audit ×2 | 3 | `src/lib/sage/memory/staff-extract.ts:124-141,143` |
| 9 | Conversation summarisation | Gemini | The transcript, concatenated as `Student: … / Sage: …`, plus the prior summary | `conversation_summary` / `student_record` | audit ×3 | 5 | `src/lib/chat/conversation.ts:330-338,363` |
| 10 | Résumé upload → extract | Gemini | **Raw résumé text**: name, address, phone, email, employers, dates | `resume_extract` / `student_record` | audit ×5 | 5 | `src/app/api/resume/upload/route.ts:42-46` |
| 11 | Résumé assist / draft | Gemini | Stored résumé data + certifications | `resume_assist` / `student_record` | audit ×5 | 4 | `src/app/api/resume/assist/route.ts:29-33` |
| 12 | Sage briefing (autopilot) | Gemini | `JSON.stringify(bundle).slice(0,4000)` — **student id and `displayName` are the first keys**, plus goals, alerts, insights | `sage_briefing` / `student_record` | **no audit event in the file** | 5 | `src/lib/sage/briefing.ts:193-197,213-216`; bundle shape `context-bundle.ts:445-450` |
| 13 | Wager (goal-proposal) diagnosis | Gemini | Same 4 000-char bundle slice | `sage_post_response` / `student_record` | **no audit event** | 5 | `src/lib/sage/wager-diagnosis.ts:41-45,66-69` |
| 14 | `tailor_application` | Gemini | Résumé/skills grounding text for one student | `tailor_application` / `student_record` | **no audit event** | 4 | `src/lib/sage/agent/tailor-application.ts:269-273,279-289` |
| 15 | `explain_job` | Gemini | Posting text only — verified: no work-profile field reaches the prompt | `explain_job` / `student_record` | audit ×5, incl. terminal events | 2 | `src/lib/sage/agent/job-search-tools.ts:555-598` |
| 16 | `draft_endorsement` | **Refuses** if provider is not local | Would carry named student + employers + credentials + attendance | `draft_endorsement` / `student_record` | **the one true gate: hard `providerClass !== "local"` refusal** | 1 | `src/lib/connect/endorsement.ts:91-122` |
| 17 | Chat file **gist** — cloud path | **Gemini `generateContent`, raw document bytes base64-inlined** | The whole uploaded file: IDs, transcripts, certificates, letters, benefits paperwork | `chat_file_gist` / `student_record` (audited at the route) | **`ConsentRecord` scope `cloud_file_processing` + `role === "student"`** | 3 | `src/lib/sage/file-gist.ts:39-63`; gate `src/app/api/chat/upload/route.ts:44-45,79-98` |
| 18 | `classify_attachment` — cloud path | Gemini, raw bytes, same transport | Same | `chat_file_gist` / `student_record` | same consent scope | 3 | `src/lib/sage/classify-attachment.ts:163-195`; gate `src/lib/sage/agent/tools.ts:852-882` |
| 19 | Failed-extraction replay (teacher "AI Review") | Gemini | The archived conversation snapshot | `sage_post_response` / `student_record` | **no audit event** | 4 | `src/app/api/teacher/failed-extractions/[id]/route.ts:51-61` |
| 20 | Chat warm-up ping | Ollama only (`provider.name !== "ollama"` → return) | none — literal "ping" | `sage_student_chat` / `student_record` | early return | 1 | `src/app/api/chat/warmup/route.ts:68-80` |
| 21 | All of #1–#19 when `ai_provider = "local"` | **Ollama over a Cloudflare tunnel** (third-party network path) | Same payloads as above | same | CF Access service token, `isSafeAiProviderUrl` | 3 | `provider.ts:107-140`; `src/lib/ai/local-config.ts` |
| 22 | **Per-student personal Gemini key** | Google, **under the student's own consumer account** | Everything in #1–#14 for that student | n/a | none — `resolveApiKey` prefers it silently | **5** | `src/lib/chat/api-key.ts:17-30` (personal key checked *first*) |
| 23 | Sentry errors + traces | **Sentry (self-serve SaaS)** | `user.id` retained; `event.message` and `exception.value` **never scrubbed** | n/a | `scrubPii` — patches only `user`, `request`, `breadcrumbs` | 3 | `src/lib/sentry-scrub.ts:120-127`; wiring `sentry.server.config.ts:5-12` |
| 24 | SMS nudges | **Twilio → US carriers** | Student **phone number**; employer name; job title; interview day/time; notification titles | n/a | `smsConsentAt` + phone-code verification + quiet hours + STOP | 3 | `src/lib/sms.ts:53-95`; bodies `src/lib/nudges/sms-policy-shared.ts:441-510` |
| 25 | Notification email | **SMTP relay** (`nodemailer`) | Student **email address**; notification title + body; deep link | n/a | `NotificationPreference` | 2 | `src/lib/email.ts:108-121,172-176`; `src/lib/email-templates.ts:10-16` |
| 26 | **Employer packet email** | SMTP → **an external employer** | First name + last initial, résumé written for the job, verified certs, availability, earliest start, teacher endorsement, subsidy line | n/a | `ConsentRecord` scope `employer_referral` **plus** a per-connection approval card whose field list is the frozen `includedFields` | 2 | `src/lib/connect/employer-email.ts:44-79`; allowlist `src/lib/connect/packet-shared.ts:28-38,104-121` |
| 27 | `/connect/[token]` public page + résumé PDF | Anyone holding the token (unauthenticated) | The frozen packet; résumé PDF bytes | n/a | token hash lookup, 14-day expiry, status check, class-flag check; **no student id in the URL** | 2 | `src/lib/connect/employer-link.ts:126-172` |
| 28 | **`/credentials/[slug]` public page** | **Anyone on the internet; indexable** | Full `displayName` **and `Student.studentId`, which is the login username**, cert date, portfolio count | n/a | `page.isPublic` only. **No `noindex`, no `robots.txt` anywhere in the repo.** | **4** | `src/app/credentials/[slug]/page.tsx:14-17,64-67`; login-by-studentId noted at `src/lib/connect/dohs-export-shared.ts:14-20` |
| 29 | DoHS CSV export | **WV DoHS / WVDE (a government third party)** | `Student.studentId` (= login username), class, enrol/exit dates, employer name, hourly wage, hours, subsidy type, 30/60/90 retention | n/a | instructor-scoped + audited; **columns are an admitted guess pending P0.4(1)** | 3 | `src/lib/connect/dohs-export-shared.ts:8-28,41-57` |
| 30 | Credly badge fetch | **credly.com** | The student-entered `credlyUsername`, which is usually their real name (`jane-doe`) | n/a | none | 2 | `src/app/api/credly/badges/route.ts:69-70` |
| 31 | Supabase Storage (S3) | **Supabase / AWS** | Every uploaded file byte: signed compliance forms, IDs, certificates, résumé PDFs | n/a | server-side keys; no client-side public bucket path found | 2 | `src/lib/storage.ts:17-63,302-330` |
| 32 | Job APIs (CareerOneStop, Talroo, jsearch, USAJOBS, Adzuna, ATS) | Those vendors | **No student data.** Queries are cluster titles + class region | n/a | n/a | 1 | `src/lib/job-board/spokes-job-queries.ts:9-40`; adapters fetch at `adapters/shared.ts:45,67` |
| 33 | `pg_cron` + `pg_net` | VisionQuest's own `/api/internal/*` | **No student data** — but the decrypted `CRON_SECRET` leaves the DB in an `Authorization` header on every tick | n/a | vault-stored secret | 2 | `prisma/migrations/00000000000000_baseline/migration.sql:4709-4732,4777-4785` |
| 34 | Sage chat client CSP | browser → Google | `connect-src` allows `generativelanguage.googleapis.com` **from the browser** | n/a | n/a | 1 | `src/proxy.ts:97` |

---

## 2. Misclassified or surprising flows

### 2.1 Embeddings have no FERPA tag at all, and the FERPA benchmark cannot see them
`resolveEmbeddingProvider()` takes `{studentId?, callSite?}` and nothing else (`src/lib/ai/embedding-provider.ts:62-69`). The header calls this a deliberate "FERPA FREEZE" (`:5-11`). Consequence:

- The **raw student chat message** is POSTed to `https://generativelanguage.googleapis.com/v1beta` on every non-trivial turn (`hybrid-retrieval.ts:141-145` → `embeddings.ts:61-68` → `gemini-embedding-provider.ts:20`).
- The **memory text itself** — the module whose extraction prompt explicitly harvests "transportation, childcare, work history" (`memory/extract.ts:35`) — is POSTed to the same endpoint (`memory/store.ts:152-155`).
- Neither call emits a `logAiAuditEvent`. `embedQuery(userMessage)` at `hybrid-retrieval.ts:144` and `embedQuery(query)` at `memory/retrieve.ts:67` pass **no `usage`**, so even the `LlmCallLog` row lands with `studentId: null` (`embeddings.ts:63-67`).

This is the single biggest measurement hole: §4 explains why it makes the FERPA benchmark structurally blind.

### 2.2 Seven model call sites make a `student_record` call and log **no** AI audit event
Verified by `grep -c logAiAuditEvent`, all zero: `src/lib/sage/briefing.ts`, `src/lib/sage/wager-diagnosis.ts`, `src/lib/sage/agent/tailor-application.ts`, `src/app/api/teacher/failed-extractions/[id]/route.ts`, `src/lib/sage/classify-attachment.ts` (the `localClassify` path), `src/lib/sage/memory/extract.ts`, `src/app/api/chat/warmup/route.ts`. `job-search-tools.ts:562-566` documents exactly why this matters — "a `student_record` call that skips this is invisible to the FERPA review exactly where the review matters most" — and then six sibling modules skip it anyway.

### 2.3 `briefing` and `wager-diagnosis` send the student's name **and internal id** to the model
Both do `JSON.stringify(bundle).slice(0, 4000)`. The bundle's return literal puts `student: { id, displayName, … }` first (`context-bundle.ts:445-450`), so the 4 000-char truncation can never drop it. The prompts wrap it in `[STUDENT_CONTEXT_*]` fences against *injection* — which is a different threat from *disclosure*, and the fence does nothing about the latter.

### 2.4 `public_form_lookup` / `public_program` is the right tag for the **answer** and the wrong tag for the **input**
`send/route.ts:281-282,326-327` tags the direct form-lookup exit `public_program` with `allowCloud: true`. That is defensible — `policyDecision: "direct_no_model"`, nothing is sent anywhere. But the audited `inputChars` describes a student message that may be anything, including a crisis disclosure, and the row reads as a public-program event. No egress; a reporting misclassification only.

`preferCloud` (`provider.ts:191`) has **zero call sites** repo-wide — the `public_program` cloud fast-path is dead code today. Good news, and worth keeping dead.

### 2.5 The two document-bytes paths bypass `resolveAiProvider` entirely
`file-gist.ts:39-63` and `classify-attachment.ts:163-195` build a raw `fetch` to Gemini with `process.env.GEMINI_API_KEY`. They never touch the provider abstraction, so **flipping `ai_provider` to `"local"` does not stop them** — only the `cloud_file_processing` consent record does. That consent gate is real and correctly built (`upload/route.ts:44-45` also requires `role === "student"`; `tools.ts:852`), but the routing switch an operator would reach for is not connected to it.

### 2.6 Personal Gemini keys are checked *first*, and nothing records which key was used
`resolveApiKey()` returns the student's decrypted `Student.geminiApiKey` before the platform key (`api-key.ts:17-30`). A student who pastes a personal key into Settings routes their own transcript, name, goals and memories through **their own consumer Google account** — outside program terms, outside the program's data-processing agreement, and outside every audit trail. `scripts/sage-ai-accountability.mjs:22-30` names this as an unmeasured gap and declines to fabricate a split; nothing has closed it since.

### 2.7 The Sentry scrub does not scrub the two fields that most often carry student text
`scrubPii()` patches exactly `user`, `request`, `breadcrumbs` (`sentry-scrub.ts:120-127`). `event.message` and `event.exception.values[].value` pass through untouched. A Prisma error quoting a row, or any `throw new Error(\`… ${displayName} …\`)`, reaches Sentry verbatim. `scrubUser` drops `email`/`username`/`ip_address` but **keeps `user.id`** (`:107-110`), and the project's own security rule says a student id is PII in logs (`.claude/rules/security.md`, Data Privacy).

### 2.8 The public credential page is the sharpest single-record exposure
`credentials/[slug]/page.tsx:64-67` renders `displayName` and, on the next line, `Student ID {page.student.studentId}` — the value `login/route.ts` looks a student up by. There is **no `robots.txt` and no `noindex` metadata anywhere in `src/app` or `public/`**, so a slug that appears in a résumé, an email, or a LinkedIn post is crawlable. This is F12, and Match & Connect widened it: `dohs-export-shared.ts:14-28` reuses the same identifier for a government export and flags the collision as a deliberate non-fix.

### 2.9 Things that are correctly built, and should be said so
- `draft_endorsement` is the only call site that **refuses** rather than inheriting the fail-open (`endorsement.ts:100-122`). It is the pattern the other 31 sites should copy.
- The employer packet is genuinely well engineered: an allowlist of 7 field keys (`packet-shared.ts:28-38`), a frozen `includedFields` at approval time, two separate label maps so the student's consent screen and the employer's page can't drift, a builder with no access to a `Student` row at all (`employer-email.ts:1-15`), and no student id in the token URL (`employer-link.ts:117-124`).
- `explain_job` has a test pinning that no work-profile value enters the prompt (`job-search-tools.ts:555-566`).
- Job APIs receive no student data (`spokes-job-queries.ts:29-40`).

---

## 3. Direct-identifier footprint

| Identifier | Field | Table | Encrypted at rest? |
|---|---|---|---|
| Legal first/last name | `firstName`, `lastName` | `SpokesRecord` (`prisma/schema.prisma:354-355`) | no |
| Display name | `displayName` | `Student` (`:15`) | no |
| Email | `email` | `Student` (`:17`) | no |
| Referral email | `referralEmail` | `SpokesRecord` (`:356`) | no |
| **Date of birth** | `birthDate @db.Date` | `SpokesRecord` (`:367`) | no |
| **Phone** | `destination` | `NotificationPreference` (`schema.prisma:108`) | no |
| Employer contact name/email/phone | `name`,`email`,`phone` | `EmployerContact` (`:987-990`) | no |
| Google account id | `googleId` | `Student` (`:19`) | no |
| Login username | `studentId @unique` | `Student` (`:14`) | no — **and printed publicly**, `credentials/[slug]/page.tsx:66` |
| Home ZIP / county | `homeZip`, `county` | `StudentWorkProfile` (`:650-651`) | no |
| County | `county` | `SpokesRecord` (`:359`), `Employer` (`:947`) | no |
| Credly handle | `credlyUsername` | `Student` (`:21`) | no |

**Special-category and quasi-identifier data the owner's list omits entirely** — all on `SpokesRecord` (`schema.prisma:353-395`), none encrypted: `gender` (`:366`), `race` (`:368`), `ethnicity` (`:369`), `householdType` (`:357`), `requiredParticipationHours` (`:358` — a TANF/WV Works work-requirement figure), `barriersOnEntry` / `barriersRemaining` (`:370-371`), `educationalLevel` (`:375`), `employerName` (`:384`), `hourlyWage` (`:385`), `nonCompleterReason` (`:387`), free-text `notes` (`:388`). Combined with `county` and `birthDate`, race + gender + county is re-identifying on its own in a rural WV county long before a name is needed.

**Data at rest.** Only two fields are encrypted, both AES-256-GCM via `src/lib/crypto.ts:22`: `Student.geminiApiKey` (`api-key.ts:26`, `settings/api-key/route.ts:71`) and `Student.mfaSecret` (`mfa.ts:105,125`), plus `SystemConfig` secret values (`system-config.ts:94,108`). **No name, DOB, phone, address, race, wage, transcript, memory or uploaded file is encrypted at the application layer.** Passwords are scrypt-hashed and MFA backup codes are SHA-256 (`schema.prisma:29-30`) — hashes, not encryption. Confidentiality of everything else rests entirely on Postgres RLS + Supabase's disk encryption.

**RLS — read the two numbers carefully, they measure different things.** 95 distinct tables have `ENABLE ROW LEVEL SECURITY` across `prisma/migrations` and the schema declares 93 models, so *enablement* is near-complete. What is **not** near-complete is test coverage: `config/benchmarks/rls-coverage.json` measures policy-bearing tables having both a positive and a negative case in `src/lib/rls.test.ts` and reports **18/92 = 0.196** against a floor of 0.15. Its own notes hand-verify that `Message` (the entire Sage transcript), `SpokesRecord` (every identifier in the table above) and `Certification` have **zero** references in the RLS suite despite carrying policies. Separately, `JobBrowseListing` has no RLS at all (exempted with justification), and prod carries `CareerAssessmentSnapshot` with no RLS and on no `main` migration (F8, `.claude/MEMORY.md`).

**Supabase region: not determinable from this repo.** The only signal is `STORAGE_REGION=us-east-1` (`render.yaml:46-47`, `.env.example:62`), which is the S3-compatibility region string for the Supabase storage endpoint (`.env.example:61`) and normally tracks the project region — so **probably AWS us-east-1 (N. Virginia)**. Confirm in the Supabase dashboard; the repo cannot answer it. `DATABASE_URL` is a `db.[ref].supabase.co` host (`.env.example:8`) with no region encoded.

**Retention / offboarding.** `docs/DATA_RETENTION_POLICY.md` is a **draft**: every duration is marked `OWNER-CONFIRM` (lines 15-26) and its own §"Not Yet Implemented" (lines 85-89) states there is **no purge automation, no self-serve student export (no DSAR path), and no cascade hard-delete**. Offboarding is a single admin route, `src/app/api/admin/students/[id]/offboard/route.ts` — soft deactivate + `offboardedAt` + an export bundle. The `offboarding-completeness` benchmark measures that export and reports it **misses 30 student-linked models, including `Message` (the whole Sage transcript) and `SageInsight`**; it ships at `watch` tier so it records FAIL without gating (`.claude/MEMORY.md`, Open Items).

---

## 4. What `sage-ai-accountability` and `ferpa-routing` actually measure

`scripts/sage-ai-accountability.mjs` reads `AuditLog` rows with `targetType: "ai_request"` and unpacks the JSON `metadata` column, then flags any local-only-by-policy sensitivity with `completed.cloud > 0` (`:64,102,139-148,435-437`). `config/benchmarks/ferpa-routing.json` + `scripts/bench/suites/ferpa-routing.mjs` wrap the same `buildProviderMix()` into `student_record_cloud_ratio` over 30 days.

Three limits, all of them load-bearing:

1. **They measure only what `logAiAuditEvent` wrote.** Every embedding call, and the seven un-audited model call sites in §2.2, are invisible. A ratio of 0.0 would *not* mean no student data reached Google.
2. **The benchmark is not a gate.** `tier: "nightly"`, `"floor": null`, and the scorer only throws when `BENCH_FERPA_LOCAL_EXPECTED=1` (`ferpa-routing.mjs:46-53`). That variable is not set, and the suite additionally `requires: ["prod-readonly"]` — `BENCH_PROD_READONLY_URL` is listed as an outstanding owner item, so **the suite is currently skipped and has never produced a number in CI**.
3. **The config file states the expected answer is 1.0** — "this ratio reads 1.0 today by design, not by regression". That is an accurate description of the code and a fair engineering decision (a gate that reds for a reason nobody can fix gets disabled), but it means the FERPA instrument is presently an unexecuted note-to-self, not a control.

---

## 5. Facts the owner's mental model gets wrong

1. **"The only real PII is name, phone, address, email, DOB."** `SpokesRecord` also stores race, ethnicity, gender, household type, TANF participation hours, entry/remaining barriers, wages and employer (`schema.prisma:353-395`). Under FERPA the relevant category is not "identifiers" but **education records**, and under 34 CFR 99.3 that includes anything "directly related to a student and maintained by" the institution — the transcript, the mood entries, the goals, the crisis alerts, the memories. The name is not what makes them protected.

2. **A transcript with no name in it is still an education record.** It is linked to a `studentId` and to a real person in your database. Removing the name from a chat log does not de-identify it; 34 CFR 99.31(b) requires that a record be de-identified *such that a reasonable person could not identify the student*, and a first-person account of one adult's job search in one WV county fails that test on its own. Flow #3 sends those messages to Google verbatim, with no name — and that changes nothing legally.

3. **"student_record is local-only."** It is a preference, not a control. `provider.ts:180-186` has no refusal branch, and any `ai_provider` value that is not exactly `"local"` — including unset — routes to Gemini. One `SystemConfig` row is the whole enforcement.

4. **Embeddings are not "just numbers", and are not covered by the routing rule at all.** The routed thing is the **input text**: the POST body to Google carries the student's message and their stored memories in plaintext. Embedding routing keys off the same global switch with no sensitivity parameter and no audit event (`embedding-provider.ts:5-11,62-69`).

5. **Signing the `ai-data-consent` form is not a consent gate.** It is `storageKey: null`, `acceptsSubmission: false` (`src/lib/spokes/forms.ts:178-192`) — a paper acknowledgement with no PDF and no enforcement anywhere in the code. The only consent scopes that gate anything are `cloud_file_processing` and `employer_referral` (`src/lib/consent.ts:17-30`). **There is no consent scope for "send my conversation to Google."**

6. **The Gemini API key is not always yours.** A student's personal key is preferred over the platform key (`api-key.ts:17-30`), which moves their data to a personal consumer Google account with no DPA and no audit.

7. **"It's behind a login."** Two pages are not. `/credentials/[slug]` publishes a name plus the login username to anyone with the URL, with no `noindex` and no `robots.txt` in the repo. `/connect/[token]` is capability-token protected and well built, but it is still an unauthenticated page serving a résumé PDF.

8. **A cloud transcript is not recoverable.** Retention (`docs/DATA_RETENTION_POLICY.md`) governs your Postgres. It says nothing about, and cannot reach, what Google or Twilio or Sentry now hold. The offboarding export does not even cover `Message` in your own database.

---

## 6. Cheapest high-value fixes (ordered; no code was changed)

1. Make `student_record` **refuse** instead of fail open — copy `endorsement.ts:100-122` into `provider.ts:180-186` behind a `AI_LOCAL_REQUIRED` flag. One change closes flows #1,2,6,7,9-14,19.
2. Give `resolveEmbeddingProvider` a `sensitivity` and the same refusal, and emit `logAiAuditEvent` from `embeddings.ts` — closes #3,4,5 and makes the FERPA benchmark honest.
3. Add `logAiAuditEvent` to the seven silent call sites in §2.2.
4. Remove `Student ID` from `credentials/[slug]/page.tsx:66` and add `robots: { index: false }` to both public routes.
5. Decide the personal-key policy (`api-key.ts:17-30`) — either delete the branch or record which key served each call.
6. Extend `scrubPii` to `event.message` and `event.exception` and drop `user.id`.
7. Set `BENCH_PROD_READONLY_URL`, then run `ferpa-routing` once to get the first real number.
