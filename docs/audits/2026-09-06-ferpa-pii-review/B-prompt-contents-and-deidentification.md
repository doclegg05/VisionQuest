# Memo B — What student data actually reaches an AI provider, whether a de-identification layer is feasible, and how the "FERPA-safe" local path really compares

Repo state: `main` @ `666877b` (Match and Connect + benchmark suite, #204). Read-only analysis; nothing modified.
Owner's direct-identifier list, used throughout: **name, phone, address, email, date of birth**. Everything else (interests, skills, goals, learned behaviours) treated by the owner as non-identifying.

---

## 0. Executive answer

1. **Only three of ~15 model-calling paths put a direct identifier into a prompt, and only two put more than a display name.** The student chat prompt carries `displayName` and nothing else from the identifier list. The résumé paths carry name + email + the résumé's own contact block. The staff-chat path carries name + login id. Everything else in the prompts is education-record content (goals, readiness, certifications, alerts, memories, transcripts) — FERPA-protected, but not direct identifiers.
2. **A structured pseudonymization decorator at the `AIProvider` boundary is genuinely feasible and small** — the codebase already has the exact decorator precedent (`withUsageLogging`, `src/lib/llm-usage.ts:157-269`), including the hard part (`streamWithTools`). Structured substitution alone makes **11 of 14** `student_record` call sites carry zero direct identifiers.
3. **The blockers are not the structured fields.** They are (a) the free-text channel — the student's own typed messages, which the transcript ships verbatim (`route.ts:826-831`), (b) the résumé, where the identifiers *are* the payload, and (c) the fact that de-identified education records are still FERPA education records when re-identification is trivially available to the recipient's counterparty.
4. **The local path is not the clean FERPA story the cost doc claims** (`docs/VisionQuest_Annual_Cost_Analysis_2026.md:40`). Prompts traverse Cloudflare's edge, where TLS is terminated and re-originated; the host is a personal Mac with no audit, no access logging, and `authMode` defaulting to `"none"` (`src/lib/ai/local-auth.ts:3`). Compared honestly against a cloud vendor under a signed zero-retention/no-training DPA, the local path's advantage is *contractual reach*, not *fewer parties who could see the data*.

---

## 1. What student data is actually in the prompts

### 1.1 The routing frame

`AiTask` has 14 values (`src/lib/ai/types.ts:159-173`); `DataSensitivity` has 5 (`:175-180`). `isLocalOnlySensitivity` treats `student_record` and `staff_entered` as local-only (`src/lib/ai/provider.ts:143-145`).

Measured counts on non-test code:
- **32** literal `sensitivity: "student_record"` occurrences (most are audit rows, not calls).
- **14** distinct `resolveAiProvider(...)` call sites declaring `student_record`.
- **1** path that bypasses `resolveAiProvider` entirely and calls Gemini directly by URL (§1.4).

`resolveAiProvider` (`provider.ts:174-196`) does **not** fail open at runtime: if `ai_provider = "local"` and the URL is unset/invalid, `getLocalProvider` throws (`:111-122`) and the chat route returns 503 (`src/app/api/chat/send/route.ts:380-415`). The "fail-open" recorded as VQ-R-002 is a **configuration** flip — when `ai_provider = "cloud"`, `student_record` prompts go to Gemini and are merely audited (`provider.ts:166-172`, `:183-189`). *That distinction matters for this decision: today the switch already exists; the memo below is about what would ride on it.*

Prompt tier also changes with the provider (`provider.ts:198-200`): `ollama` → `compact`, Gemini → `full`. Compact carries **less** student data (§1.3).

### 1.2 The matrix — prompt/route × field

Legend: **●** interpolated verbatim · **◐** present only inside free text the student/staff authored (transcript, memory, notes) · **○** absent · **▲** present as an opaque cuid.

| # | Prompt / route (file:line) | Task · sensitivity | Name | Email | Phone | Addr | DOB | Class | Teacher name | Employers | Wages | TANF/SNAP | Barriers | Mood | Crisis flag | Memories | Goals | Transcript turns |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **Student chat system prompt** `system-prompts.ts:691-698`, assembled `chat/send/route.ts:637-660` | `sage_student_chat` · student_record | ● `displayName` | ○ | ○ | ○ | ○ | ○ (only a confirmed-at flag, `:701-703`) | ○ | ◐ | ◐ | ○ | ◐ | ◐ | ○ | ● | ● | — |
| 2 | **Student chat message array** `route.ts:703-716`, `:826-831` | same | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | — | ◐ | **20** (cloud) / **6** or **12** (local, `:703-711`) |
| 3 | Situational snapshot block `situational-snapshot.ts:64-105` | inside #1 | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ● (≤4, truncated 90ch) | — |
| 4 | Recent-activity block `recent-activity.ts:118-156` | inside #1 | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ◐ alert text | ○ | ○ (student-visible allowlist only) | ○ | ○ | — |
| 5 | Durable memory profile + recall `memory/profile.ts:37-50`, `memory/retrieve.ts:193` | inside #1 | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ○ | ● | ● | — |
| 6 | Attachment descriptions `route.ts:790-796` | inside #1 | ◐ filename + gist | ◐ | ◐ | ◐ | ◐ | ○ | ○ | ◐ | ◐ | ○ | ◐ | ○ | ○ | ○ | ○ | — |
| 7 | **Staff chat system prompt** `system-prompts.ts:691-698` w/ `staffStudentContext` `staff-student-context.ts:456-486` | `sage_staff_chat` · staff_entered | ● staff name **and** student `displayName` (`:458`) | ○ | ○ | ○ | ○ | ● class name + code (`:460`) | ● case-note authors (`:426`) | ● (`:344` opportunity company) | ○ | ○ | ● alerts/notes | ◐ | ● alerts | ● staff memories | ● | 20 |
| 7b | Ambiguous-name branch `staff-student-context.ts:525-531` | same | ● up to 8 students' `displayName` + `studentId` login id | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | — |
| 8 | **`resume_assist`** `resume-ai.ts:100-119`, route `resume/assist/route.ts:76-131` | resume_assist · student_record | ● `displayName` (`:101`) | ● `Student.email` (`:102`) | ● via `existingResume.contact.phone` (`:106`) | ● via `contact.location` | ○ | ○ | ○ | ● résumé experience | ○ | ○ | ○ | ○ | ○ | ○ | ● (6) | — |
| 9 | **`resume_extract`** `resume-extract.ts:31,98-111`, route `resume/upload/route.ts:112` | resume_extract · student_record | ● (`:101`) | ● (raw résumé text) | ● | ● | ● if printed on the résumé | ○ | ○ | ● | ● | ○ | ○ | ○ | ○ | ○ | ○ | — |
| 10 | **`sage_briefing`** `briefing.ts:191,205-216` | sage_briefing · student_record | ● — `JSON.stringify(bundle).slice(0,4000)` and the bundle carries `displayName` (`context-bundle.ts:448`) | ○ | ○ | ○ | ○ (`birthDate` is fetched at `context-bundle.ts:205` but only feeds an alert flag at `:392`; the value is **not** emitted) | ○ | ○ | ○ | ○ | ○ | ● alerts | ○ | ● alerts | ● insights | ● | — |
| 11 | **`conversation_summary`** `chat/conversation.ts:320-340` | conversation_summary · student_record | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ● ("emotional state" is an explicit instruction, `:337`) | ◐ | ○ | ● | **all** un-summarised turns |
| 12 | **Memory extraction** `memory/extract.ts:31-49,116` | sage_post_response · student_record | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ● (prompt explicitly solicits "life circumstances… transportation, childcare") | ◐ | ◐ | — | ● | **last 12** |
| 13 | Other post-response extractors (goals, discovery, mood, classroom) `chat/post-response.ts:309-400` | sage_post_response · student_record | ◐ | ◐ | ◐ | ◐ | ◐ | ● (classroom extractor's whole job) | ● (classroom extractor) | ◐ | ◐ | ◐ | ◐ | ● (mood extractor) | ◐ | ○ | ● | user msg + reply |
| 14 | **`tailor_application`** grounding `career-tools.ts:255-268`, sent `tailor-application.ts:280-290` | tailor_application · student_record | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ● prior employers (`:262`) | ● posting salary (`:257`) | ○ | ○ | ○ | ○ | ○ | ○ | — |
| 15 | **`explain_job`** `job-search-tools.ts:465-478,553-570` | explain_job · student_record | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ● posting company only | ● posting pay only | ○ | ○ | ○ | ○ | ○ | ○ | — |
| 16 | **`draft_endorsement`** `connect/endorsement.ts:54-73` | draft_endorsement · student_record | ● (`:57`) | ○ | ○ | ○ | ○ | ○ | ◐ instructor notes (`:70`) | ● (`:65`) | ○ | ○ | ● prompt forbids mentioning them but notes may contain them | ○ | ○ | ○ | ○ | — |
| 17 | **`chat_file_gist` (cloud)** `sage/file-gist.ts:24-64` | chat_file_gist · student_record | ● whatever is on the page | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ○ | ○ | ○ | ○ | — (raw document **bytes**) |
| 18 | `chat_file_gist` (local classify) `classify-attachment.ts:257-311` | chat_file_gist · student_record | ● document text | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ○ | ○ | ○ | ○ | — |
| 19 | **`wager_diagnosis`** `wager-diagnosis.ts:66-77` | sage_post_response · student_record | ● (bundle JSON, as #10) | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ● alerts | ○ | ● alerts | ● insights | ● | — |
| 20 | `chat/warmup` `chat/warmup/route.ts:66-80` | sage_student_chat · student_record | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | none (literal "ping") |
| 21 | `public_form_lookup` / `public_program_help` `chat/send/route.ts:282,327` | public_program | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | — |
| — | **Crisis detection** `chat/crisis-scan.ts` | **no model at all** | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — |

### 1.3 Quantification

- **21 model-calling prompts/routes** inventoried above (excluding the model-free crisis path).
- **Carrying at least one owner-listed direct identifier as a structured interpolation:** 8 — #1, #7, #7b, #8, #9, #10, #16, #19. Of those, **6 carry only the display name** (#1, #7, #10, #16, #19, and #7's staff half); **2 carry name + email/phone/address** (#8, #9).
- **Carrying identifiers only because a *document* does:** 2 (#17, #18).
- **Carrying no direct identifier at all, only education-record or public content:** 11 — #3, #4, #6, #11–#15, #20, #21, plus #2's system-prompt half.
- **Free-text channel (◐) is present in 8 of 21** and is the one nobody can enumerate: the student typing "call me at 304-555-0134, I live off Route 19 in Fayette County" puts all three into #2, #11 and #12 verbatim.
- **Transcript depth:** cloud gets **20** turns (`route.ts:703-711`), local gets **6** (or **12** in discovery / career-profile-review). Moving to cloud therefore *increases* the free-text exposure per call by ~3×, before any de-identification.
- **Explicitly pinned as identifier-free:** `explain_job` has a test asserting no work-profile value reaches the prompt (`src/lib/sage/agent/job-search-tools.test.ts:792-815`) and an in-code note that adding one re-opens the routing decision (`job-search-tools.ts:558-566`). This is the model to copy.
- **DOB is fetched but never emitted.** `context-bundle.ts:205` selects `spokesRecord.birthDate`; `:392` passes it only to `buildStudentAlertDescriptors` for a `profile_birthdate_missing` flag. It is inside the object `JSON.stringify`d at `briefing.ts:191` — *verify* whether the 4,000-char slice reaches it before relying on "DOB never leaves"; the field ordering is not pinned by any test.
- **SpokesRecord `firstName`/`lastName`/`county`/`ethnicity` never reach any prompt** — only `displayName` does. Grep confirms the only `firstName` use in the Sage tree is name *matching* in staff chat (`staff-student-context.ts:141-143`).
- **TANF/SNAP status is in no prompt anywhere.** Neither is a phone number from `NotificationPreference` (`prisma/schema.prisma:990`).

### 1.4 The path that bypasses the whole routing layer

`src/lib/sage/file-gist.ts:38-64` builds a raw `fetch` to `https://generativelanguage.googleapis.com/.../generateContent?key=…` and posts the **entire uploaded document as base64 `inlineData`**. It never touches `resolveAiProvider`, so `ai_provider = "local"` does not govern it. It is gated instead on a recorded `cloud_file_processing` consent (`chat/upload/route.ts:80-99`) and on `process.env.GEMINI_API_KEY` existing. A student uploading a benefits letter, a state ID, or a medical note with consent ticked sends that image to Google today.

The sibling local path is correctly fenced: `classify-attachment.ts:286-288` refuses to proceed unless `provider.name === "ollama"`.

---

## 2. Feasibility of a pseudonymization layer at the provider boundary

### 2.0 Why the boundary is the right place

`AIProvider` (`src/lib/ai/types.ts:42-85`) has exactly four methods and every prompt in §1.2 (except #17) goes through one of them. The codebase already ships a **transparent decorator over that exact interface**: `withUsageLogging` (`src/lib/llm-usage.ts:157-269`) wraps all four methods, threads `onUsage` through, and — the part that matters — correctly re-wraps the `streamWithTools` async generator including its tool-call callback (`:239-266`). A `withPseudonymization(provider, ctx)` decorator is a structural copy of that file.

Placement: **inside** `resolveAiProvider`, applied only when `getProviderClass(provider.name) === "cloud"` and `sensitivity` is local-only. Then a call site that forgets it cannot exist, which is the failure mode the repo's own history keeps hitting (F63, the platform-map drift, the four-copy money regex).

### 2.a Structured-field substitution + streaming re-hydration

**Substitution.** The app already knows the values: `displayName`, `email`, and `SpokesRecord.birthDate` are read by name at the call sites. Build a per-request `TokenVault`:

```
{ "[STUDENT_NAME]": student.displayName,
  "[STUDENT_EMAIL]": student.email,
  "[TEACHER_NAME_1]": note.author.displayName, … }
```

Deterministic within a request; a stable per-student salt (`studentLogKey` precedent, `src/lib/log-keys.ts:20-28`) if cross-turn stability matters so the model does not think it is talking to a different person each turn. Replace longest-first, word-boundary-anchored, case-insensitive with case preserved — and note the repo's own hard-won lesson that **unanchored substring matching on short tokens is a bug**, exactly the `explain_job` "ged" inside "changed"/"managed" defect (Key Decisions Log, 2026-09-05). A student named "Art" or "Will" makes that lesson immediate.

Prefer a `[STUDENT_NAME]` placeholder over a fake name ("Student A"): a plausible fake name is indistinguishable from a real one in the output, so a re-hydration miss leaks *silently*, whereas a stray `[STUDENT_NAME]` in the UI is loud. Loud is the correct failure mode here.

**Streaming re-hydration — the real engineering.** `route.ts:1116-1120` forwards each provider chunk straight to SSE and appends to `fullResponse`. Gemini chunks are multi-word but split at arbitrary points, so `[STUDENT_` / `NAME]` across two chunks is normal, not exotic. The fix is a small streaming state machine in the decorator:

1. Maintain a carry buffer. On each chunk, scan for complete `[TOKEN]` occurrences and substitute.
2. Find the **longest suffix of the buffer that is a proper prefix of any vault token** (`[`, `[ST`, `[STUDENT_NA`…). Hold that suffix back; emit everything before it.
3. On stream end, flush the carry verbatim.
4. Bound the carry at `max(tokenLength)` characters — ~24 — so a `[` that is never completed delays at most 24 characters, not the stream.

Cost: one extra allocation per chunk and at most ~24 characters of latency on the first token. Negligible against the seconds this whole exercise is trying to save. Correctness is fully unit-testable: feed the same output split at every possible boundary and assert the reassembled string is identical — a property test, not a fixture, per the repo's "a fixture proves what it contains" rule.

**Where re-hydration must happen:** before SSE emit *and* before `capForPersist`/`saveMessage` (`route.ts:1150-1160`), so the stored transcript matches what the student saw. The decorator returning re-hydrated chunks gets both for free.

**Tool calls.** `streamWithTools` needs the same treatment in three places: outbound `messages`, the model-emitted `args` handed to `onToolCall` (re-hydrate *before* the tool runs, or `book_appointment` receives `[STUDENT_NAME]`), and the tool `response`/`summary` fed back (re-pseudonymize). `withUsageLogging:239-266` shows the shape; this is where a naive implementation breaks, and where the effort actually lives.

### 2.b Free-text detection (student-typed identifiers)

**Easy, high-confidence, already in-repo:** email and phone. `src/lib/log-redaction.ts:15-31` has both patterns, deliberately written to leave bare digit runs alone. Reuse verbatim; do not write a second copy (the four-copy money-regex lesson). Add DOB (`/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/`, plus month-name forms — `classify-attachment.ts:328-330` already has that pattern) and US street addresses (`\d+\s+\w+\s+(St|Street|Rd|Road|Ave|Ln|Hwy|Route|Rt)\b`) — decent recall, and cheap.

**Hard: names.** No NLP dependency exists in this repo (`package.json` has zero NER libraries). The realistic Node options:
- `compromise` (~250 KB, MIT, pure JS, no model download) — POS-tag-based person detection. Fast, works in a serverless-ish runtime. Recall on Appalachian given names and informal capitalisation ("me an tyler went") is poor.
- `wink-nlp` + `wink-eng-lite-web-model` — faster, similar recall ceiling.
- `@xenova/transformers` running a BERT NER model — much better recall, but pulls ~100 MB of weights into a Render container and adds hundreds of ms per turn. That is *slower than the Ollama call this project is trying to escape*, which defeats the purpose.
- **The domain-specific trick that actually works here:** the app knows every name in the cohort. `staff-student-context.ts:504-509` already loads `{ id, displayName, studentId }` for up to 500 managed students. An Aho-Corasick or simple sorted-token match against the roster (student names + instructor names + the speaker's own name) catches the overwhelming majority of names that matter *and* is exact, fast, and needs no dependency. It does not catch "my son Jayden" or "my caseworker Brenda" — third parties outside the roster.

**Honest conclusion for 2.b:** regex covers email/phone/DOB/address at high confidence. Roster matching covers in-program names at high confidence. Third-party names typed in free text **cannot be reliably caught** by anything shippable here. Any claim of "de-identified free text" is therefore false, and the memo should not make it.

### 2.c What breaks

1. **Sage addressing the student by name.** `personality.ts:16` instructs "Use their name when you know it"; the check-in stage literally scripts `"Hey [name], good to see you."` (`system-prompts.ts:394`). With substitution, the model emits `[STUDENT_NAME]` and re-hydration restores it — **this one does not break**, provided the placeholder survives round-trip. Three tests pin the exact injected string (`system-prompts.test.ts:367, 400, 461`) and would need updating; they are asserting the *mechanism*, not the value, so the change is mechanical. Risk is behavioural, not structural: models sometimes decline to use an obviously-synthetic token in warm prose, so measure it — the `sage:quality:eval` harness already builds prompts with `studentName: "Sam"` (`scripts/sage-quality-eval.mjs:116`) and is the natural place for the A/B.

2. **Tool calls carrying `studentId` / cuids.** Cuids are opaque, high-entropy, non-enumerable, and carry no embedded timestamp-plus-counter that would let a recipient order or guess them. `src/lib/log-keys.ts:11-15` already makes exactly this argument in-tree ("there is no dictionary to run against the digest; anyone who could hash every id to match one already has the database"). **They are not direct identifiers.** They *are* pseudonymous identifiers — under FERPA a de-identified record must not carry a code the recipient could use to re-identify, and the recipient here (a cloud vendor) cannot: the mapping lives only in Postgres behind RLS. Conclusion: passing cuids to a cloud model is defensible and should be stated as a considered position, not left implicit. It is *not* defensible to pass `Student.studentId` — that is the **login id**, printed publicly on the credential page, and already an open finding (F12). Add it to the vault.

3. **Résumé editing.** #8 and #9 are unfixable by pseudonymization, because the identifiers *are* the deliverable — the model's job is to write a contact block. `resume-ai.ts:44-50` has the model emit `contact.email` / `contact.phone` / `contact.location`. Options: (i) exclude résumé tasks from the cloud lane entirely and keep them local (they are batch, not interactive — the latency complaint does not apply); (ii) strip the contact block, let the model write the body, and re-attach contact locally, which the Connect packet already does for a different reason (Key Decisions Log, SEC-W4). **(ii) is the right answer and is ~20 lines** — it also removes `Student.email` from the prompt at `resume-ai.ts:102` with no loss.

4. **Memory extraction.** The prompt *asks* for life circumstances (`memory/extract.ts:37`) and *tells* the model not to record "facts about other people by name" (`:39`) — an instruction, not an enforcement. So `"her son Jayden has asthma"` can be, and probably is, stored today. Two consequences: memories go to the cloud on every subsequent turn (#5), and a third-party minor's name is in them. This is the single most under-defended surface. Minimum fix: run the outbound de-identifier over `memory.content` at *write* time too, not only at prompt time.

5. **The crisis path — confirmed model-free.** `src/lib/chat/crisis-scan.ts` calls `detectCrisisSignal`, a deterministic regex module, at the top of the request before provider resolution; the 988 block is appended post-generation (`route.ts:1125-1133`). **A cloud switch cannot degrade crisis detection**, and de-identification cannot break it. This is a genuinely reassuring finding and should be stated plainly to the owner.

6. **`SAGE_PROMPT_REVISION` / eval canaries.** Substitution changes rendered prompt text, so `src/lib/sage/prompt-revision.ts` must bump (the 2026-08-21 precedent: bump when *rendered text materially grows or changes*, even from a data file). More seriously: the gating red-team and guardrail evals assert on prompt content and on leak canaries (`scripts/sage-redteam-eval.mjs:162-167`). A de-identification layer is a Sage-affecting change and cannot merge on unit tests alone — it needs `sage:agent:eval` + `sage:redteam:eval` green, which are currently blocked on depleted Gemini credits (standing Open Item).

7. **Not in the brief but load-bearing: the `[STUDENT_NAME_START]`/`[STUDENT_NAME_END]` delimiters already in use.** `sanitizeForPrompt` (`system-prompts.ts:178-232`) strips anything shaped like `[WORD_START]`/`[WORD_END]` from untrusted input, to a fixpoint. **A vault placeholder must not be marker-shaped**, or the sanitizer will eat it — `[STUDENT_NAME]` is safe (no `_START`/`_END` suffix), `[STUDENT_NAME_TOKEN]` would be safe, `[STUDENT_1_START]` would be destroyed. Also: a student who *types* `[STUDENT_NAME]` into chat could forge a re-hydration site and cause another student's name to appear — so re-hydrate **only tokens the vault issued this request**, never by pattern.

### 2.d Size and risk estimate

| Piece | Files | Rough LOC | Risk |
|---|---|---|---|
| `src/lib/ai/deidentify.ts` — vault, substitute, re-hydrate, streaming carry | 1 new | ~250 | Medium — the streaming state machine is the whole risk; fully unit-testable |
| `src/lib/ai/with-deidentification.ts` — decorator (copy of `llm-usage.ts:157-269`) | 1 new | ~180 | Low — proven shape, incl. `streamWithTools` |
| Wire into `resolveAiProvider` cloud branch | `provider.ts` | ~15 | Low |
| Vault population per call site (name/email/roster/instructors) | ~8 files | ~10 each | Low |
| Résumé contact-block split (#8, #9) | `resume-ai.ts`, `resume-extract.ts`, 2 routes | ~60 | Low |
| Free-text regex pass (reuse `log-redaction.ts`) + roster matcher | 1 new + 1 edit | ~120 | Medium — false positives on prose |
| Tests: property test over chunk boundaries, red-baselined leak fixtures, eval re-run | ~4 | ~400 | — |
| **Total** | **~18 files** | **~1,100 LOC** | **Medium overall** |

**Fraction of `student_record` call sites made cloud-safe by structured substitution alone (no free-text NER):** of the 14 `resolveAiProvider` call sites declaring `student_record`, **11 carry no direct identifier once name/email are vaulted** (`warmup`, `explain_job`, `tailor_application`, `classify_attachment`, `briefing`, `wager_diagnosis`, `endorsement`, `failed-extractions`, `post_response`, `conversation_summary`, and the student-chat *system prompt*). The 3 that remain are `resume_assist`, `resume_extract` (fixed by the contact-block split, §2.c.3 — after which it is 13 of 14) and the student-chat **message array**, which structured substitution cannot reach because its content is whatever the student typed. Plus the 1 non-routed path (`file-gist`), which structured substitution cannot help at all.

**So: ≈79% by structured substitution alone; ≈93% with the résumé split; the residual is free text and document bytes, and no amount of engineering closes those two.**

---

## 3. The local path's own privacy posture — an honest comparison

**Is student data traversing a third party today? Yes.** The recommended and deployed design is a Cloudflare Tunnel to `llm.<domain>` fronted by Cloudflare Access service tokens (`docs/plans/2026-04-15-local-ai-tunnel-recommendation.md:39-40, 54-55, 67`). Cloudflare Access terminates TLS at its edge to evaluate the `CF-Access-Client-Id`/`CF-Access-Client-Secret` headers the app sends (`src/lib/ai/local-auth.ts:49-52`) and re-originates to the tunnel. **The full prompt — display name, goals, memories, the student's own words about their circumstances — is in plaintext in Cloudflare's memory on every turn.** Cloudflare is therefore a processor of FERPA education records in this design, exactly as Google would be, and there is no signed DPA with them for it. This is the single most consequential finding in the memo, and it directly contradicts `docs/VisionQuest_Annual_Cost_Analysis_2026.md:25` ("keeping all student data on-premises") and `:40` ("cloud AI is not an option").

**Is the Mac an audited, access-controlled system?** No, on every axis the repo can show:
- `authMode` defaults to `"none"` (`src/lib/ai/local-auth.ts:3, 13`). A misconfiguration leaves the tunnel hostname unauthenticated, and the failure is silent — `buildLocalAiHeaders` only throws for `bearer`/`cloudflare_service_token` (`:29-46`), never for `none`.
- Credentials are Cloudflare **service tokens**, i.e. app-to-app shared secrets with no per-user identity. There is no "who accessed the model" record, only "something with the token did".
- The host is a personal machine (`docs/VisionQuest_Annual_Cost_Analysis_2026.md:23`, "Mac Studio M4 Max"). Nothing in the repo describes full-disk-encryption posture, OS patching, screen lock, physical access control, or backup handling for it. Compare: a compliant cloud vendor is SOC 2 audited and will produce evidence.
- No audit record exists on the model side at all. `logAiAuditEvent` records that a call was *routed* (`route.ts:415-433`), which is the app's record of its own behaviour — not the host's record of what it did with the data.

**Does Ollama log prompts?** Not into this repo — nothing here logs a system prompt or message body (verified: no `logger.*` call in the codebase takes `systemPrompt` or message content; `route.ts:812-822` logs only *sizes*). But **Ollama's own server log records every request line**, and on macOS with the shipped app that is `~/.ollama/logs/server.log`, retained until someone deletes it, on a machine with no retention policy in evidence. Whether prompt *bodies* land there depends on Ollama's log level; the durable point is that this is entirely unmanaged, whereas a zero-retention cloud contract is a written, enforceable commitment.

**Who can actually see the data, side by side:**

| | Local path (today) | Cloud w/ no-training + zero-retention DPA |
|---|---|---|
| Parties in the plaintext path | Render, **Cloudflare edge**, the Mac's OS + Ollama + anyone with the Mac | Render, the vendor |
| Contract governing retention | none | signed, enforceable |
| Training on the data | no | contractually no |
| Audit evidence available | none | SOC 2 / ISO report |
| Access control on the model host | one shared service token; default `none` | vendor IAM + audit |
| Breach notification obligation | none defined | in the DPA |
| Data leaves the state / country | Cloudflare's routing decides | vendor region, contractually pinnable |

The local path wins on **legal simplicity** (no new processor to disclose, no new DPA to negotiate, and the *appearance* of on-premises is much easier to defend to WVDE/DoHS). It does **not** win on "fewer parties can see the data" — it is currently *worse* on that measure than a properly contracted cloud vendor, because Cloudflare is in the path with no contract at all.

**Availability, accurately.** `checkOllamaHealth` (`src/lib/ai/health.ts:152-277`) probes `/api/tags` or `/v1/models`, then *actually issues a chat completion* to validate the path (`:106-150`) — a real check, not a ping, with a default 2 s timeout (`:161`). At request time, if the local URL is unset or invalid, `getLocalProvider` throws (`provider.ts:111-122`) and student chat returns **503 with the 988 crisis block attached** (`route.ts:404-415`) — fail-closed, and correctly so. But the practical consequence is stark: **the Mac being asleep, updating, or behind a flapping tunnel means Sage is down for every student.** The tunnel doc records this happening repeatedly in production — `Local AI stream failed (502)`, `(530)`, missing Access credentials, empty streams (`2026-04-15-local-ai-tunnel-recommendation.md:71`). Availability, not just latency, is a real argument for the cloud lane.

**Cost.** `docs/VisionQuest_Annual_Cost_Analysis_2026.md`: local = **$3,699 one-time** hardware + $435/yr recurring; cloud Gemini for 200 students ≈ **$50–$275/yr** (`:40`). Year 1: $4,134 vs ~$710. The doc's stated reason for paying 6× — "no cloud AI provider currently offers compliant terms for this data" (`:40`) — is the claim this memo exists to re-open, and it is stated as settled fact in a document that goes to funders.

---

## 4. Findings

### CRITICAL

**C1 — Student documents are already going to Google in plaintext, outside the entire FERPA routing layer.**
`src/lib/sage/file-gist.ts:38-64` posts raw uploaded bytes to `generativelanguage.googleapis.com` via a hardcoded `fetch`, never calling `resolveAiProvider`. Setting `ai_provider = "local"` does not stop it. The only gate is a recorded `cloud_file_processing` consent (`chat/upload/route.ts:80-99`). Students upload IDs, benefits letters and certificates here. Any decision about "should we use the cloud" is moot until this is acknowledged: the answer is already partly yes, on the most identifier-dense payload in the system, and it will not be covered by a no-training term unless that term names the consumer Gemini API key in use.

**C2 — Per-student personal Gemini API keys defeat any enterprise no-training/zero-retention agreement.**
`src/lib/chat/api-key.ts:17-31` resolves a student's own encrypted `geminiApiKey` **first**, ahead of the admin platform key and the environment key. A no-training DPA attaches to the *account* the key belongs to. If any student has a personal key set, their prompts run under consumer terms — where free-tier Gemini traffic is used to improve the product. Before any cloud decision: audit `Student.geminiApiKey IS NOT NULL`, and make the enterprise-key path unconditional for `student_record` tasks.

**C3 — The "FERPA-safe" local path routes plaintext student records through Cloudflare, an uncontracted third party.**
`docs/plans/2026-04-15-local-ai-tunnel-recommendation.md:39-40, 54-55` (design), `src/lib/ai/local-auth.ts:49-52` (implementation). Cloudflare Access terminates TLS to evaluate the service-token headers. `docs/VisionQuest_Annual_Cost_Analysis_2026.md:25` tells funders data stays "on-premises". These cannot both be true. Either negotiate a Cloudflare DPA, or move to a path where TLS terminates only on the Mac (a raw WireGuard/Tailscale tunnel with no L7 inspection would do it), or correct the funder-facing document.

### WARNING

**W4 — `Student.studentId` — a live login credential — is interpolated into every staff-chat prompt.**
`staff-student-context.ts:458` (`Student: ${displayName} (${studentId})`) and `:529` (up to 8 students' names + login ids on an ambiguous match). This is the same identifier already flagged as F12 for being printed on the public credential page. It must go into the vault before any staff prompt reaches a cloud model, and arguably before it reaches Ollama.

**W5 — Memory extraction solicits third-party details and forbids them only by instruction.**
`memory/extract.ts:37` asks for "life circumstances that affect coaching (transportation, childcare, work history)"; `:39` says do not include "facts about other people by name". Nothing enforces `:39`. Stored memories are then replayed into every subsequent prompt (`memory/retrieve.ts:193`, `memory/profile.ts:37-50`). A minor's name recorded once is exfiltrated on every turn thereafter. De-identify at write time, and add a red-baselined fixture proving a "her son Jayden" input does not store the name.

**W6 — Cloud routing silently triples the transcript exposure per call.**
`route.ts:703-711`: 20 turns on the `full` tier, 6 (or 12) on `compact`, and the tier is chosen by provider name (`provider.ts:198-200`). Flipping to cloud for latency therefore *also* sends 3× more free-text student speech per request — the exact channel de-identification cannot clean. If the cloud lane ships, pin the history cap to the FERPA decision rather than to the provider.

**W7 — `sanitizeForPrompt` will destroy a marker-shaped placeholder, and a student can forge one.**
`system-prompts.ts:178-232` strips any `[WORD_START]`/`[WORD_END]` token from untrusted input to a fixpoint. Vault tokens must avoid that shape, and re-hydration must be restricted to tokens the vault issued **this request** — never a pattern match — or a student typing `[STUDENT_NAME]` into chat causes a name to be injected into the reply.

**W8 — `resume_assist` sends `Student.email` for no reason the model needs.**
`resume-ai.ts:102` interpolates the account email; `:44-50` also lets the model author the contact block. Splitting the contact block out and re-attaching it locally (§2.c.3) removes an identifier, removes a hallucination surface, and is the smallest single privacy win in this memo — worth doing whether or not the cloud lane ships.

**W9 — A local runtime failure takes Sage down for everyone, and the tunnel has a production failure history.**
`provider.ts:111-122` → `route.ts:404-415` (503). `2026-04-15-local-ai-tunnel-recommendation.md:71` records repeated 502/530/empty-stream incidents in production. The fail-closed behaviour is correct; the availability consequence is a legitimate, separate argument for a cloud lane that has nothing to do with latency.

### NOTE

**N10 — Crisis detection is model-free and cannot be degraded by any of this.** `src/lib/chat/crisis-scan.ts` runs `detectCrisisSignal` (deterministic regex) at the top of the request, before provider resolution and before every exit; the 988 block is appended post-generation (`route.ts:1125-1133`). Say this plainly to the owner — it removes the scariest objection to a provider change.

**N11 — Date of birth is fetched into the context bundle but never rendered.** `context-bundle.ts:205` selects it; `:392` uses it only for a `profile_birthdate_missing` alert flag. It is nonetheless inside the object serialised at `briefing.ts:191` and `wager-diagnosis.ts:68` (`JSON.stringify(bundle).slice(0, 4000)`). No test pins it out. Add one — an omission and a decision must not look alike.

**N12 — Opaque cuids are defensibly not identifiers; state the position rather than leaving it implicit.** `src/lib/log-keys.ts:11-15` already argues it in-tree for the same class of value. Cuids are high-entropy and unenumerable, and the mapping lives only behind RLS, so a cloud recipient cannot re-identify from one. This is a considered position that should be written down where a reviewer will find it — not a fact that speaks for itself.

**N13 — `explain_job` is the pattern to copy.** `job-search-tools.ts:558-566` documents *why* the prompt carries no student-derived field and what adding one would re-open; `job-search-tools.test.ts:792-815` pins it. Every prompt in the cloud lane should carry the same comment and the same test.

**N14 — The decorator precedent already exists and already solves the hard part.** `src/lib/llm-usage.ts:157-269` wraps all four `AIProvider` methods and correctly re-wraps `streamWithTools` including the tool-call callback. Build `withPseudonymization` as a structural copy, apply it inside `resolveAiProvider`'s cloud branch, and no call site can forget it.

**N15 — No NER library exists in the repo, and adding a real one costs more latency than it saves.** `package.json` has none. A transformer NER model on Render would add hundreds of ms per turn — slower than the Ollama call this is trying to escape. The shippable substitute is roster matching against the ~500 names the app already loads at `staff-student-context.ts:504-509`, plus the existing `log-redaction.ts:15-31` patterns for email and phone. Third-party names in free text remain uncatchable; do not claim otherwise.

**N16 — This is a Sage-affecting change and cannot merge on unit tests.** The gating red-team and guardrail evals (`scripts/sage-redteam-eval.mjs`) assert on prompt content and leak canaries, and `SAGE_PROMPT_REVISION` must bump for the rendered-text change (2026-08-21 precedent). Those evals are currently red on depleted Gemini credits — a standing Open Item that would block this work today.

---

## 5. Recommendation in one paragraph

The owner's instinct is sound and better supported by the code than the cost document suggests: **the student chat prompt carries exactly one direct identifier — the display name — and everything else in it is education-record content**, so structured pseudonymization at the `AIProvider` boundary would make 11 of 14 `student_record` call sites (13 of 14 with a small résumé change) carry no direct identifier at all, for roughly 1,100 lines across ~18 files using a decorator pattern the repo already ships. But three things must be settled first, and none of them is engineering: **(1)** document bytes already go to Google outside the routing layer (C1) and personal API keys would void any DPA (C2); **(2)** the local path is not identifier-free either — Cloudflare sits in the plaintext path today with no contract (C3), so the honest comparison is "one uncontracted processor" versus "one contracted processor", not "none" versus "one"; and **(3)** de-identification cannot clean the free-text channel — the student's own typed words are ~⅓ more of the payload on the cloud tier (W6) and no shippable Node library catches third-party names (N15), so the correct framing to WVDE is *reduced* exposure under contract, never *de-identified data*. Given all that, the strongest position is a hybrid: keep the résumé, document and endorsement paths local where latency does not matter, and move interactive chat to a contracted cloud model behind the pseudonymization decorator with the transcript cap held at the local tier's depth.
