# VisionQuest FERPA / PII Review — student data, AI providers, and what to do about it

**Date:** 2026-09-06
**Repo state reviewed:** `main` @ `666877b` (Match and Connect + benchmark suite, #204)
**Requested by:** Britt (owner). Question asked: *review VisionQuest through a FERPA / student-PII lens; look at what other institutions do; decide whether a cloud AI model with no-training / no-retention terms could replace or supplement the local model; and if nothing fits, invent something.*
**Method:** six parallel agents (two read-only code audits, four web-research passes), every load-bearing code claim re-verified by the orchestrating agent against the file and line cited. Supporting reports are in `docs/audits/2026-09-06-ferpa-pii-review/` (A through F). Nothing in the codebase was changed by this review.

> **How to read this.** Part 0 is the answer in plain language. Parts 1–5 are the evidence. Part 6 is the recommended architecture. Part 7 is the ordered action plan. Part 8 lists the decisions only Britt can make. Cited paths are `file:line` at commit `666877b`.

---

## Part 0 — The answer in plain language

**1. The premise that cloud AI is off the table is wrong, and the repo currently says it as fact.** `docs/VisionQuest_Annual_Cost_Analysis_2026.md:40` tells funders "cloud AI is not an option — no cloud AI provider currently offers compliant terms for this data." That is not what the law says and not what peers do. FERPA has no certification; what it has is the *school official* exception (34 CFR 99.31(a)(1)(i)(B)): a vendor may receive education records without consent when it performs an institutional service, is under the institution's direct control over use and maintenance of the records, uses them only for the authorised purpose, and does not redisclose. That is a **contract**, not a technology. Every university surveyed (Michigan, Arizona State, Cal State, Harvard, Stanford, Florida, the UC system, Wisconsin, Chicago) sends FERPA-tier records to a cloud model *under an enterprise contract*, and bans the same model's consumer tier for that data. Khan Academy's Khanmigo, MagicSchool and Brisk do the same for K-12. VisionQuest's stated "local-only for student records" rule is stricter than every peer found except one (Florida's self-hosted NaviGator). See Part 3.

**2. But the rule is not actually enforced, and the local path is not the clean story the cost document claims.** Today `ai_provider` is unset or `cloud` in production, so *every* student-record prompt already goes to Google (the September 1 audit measured 57 of 57 on dev; `provider.ts:180-186` has no refusal branch). Uploaded documents — state IDs, benefits letters — go to Google through a raw `fetch` that bypasses the routing layer entirely (`src/lib/sage/file-gist.ts:38-64`). Raw chat messages and stored memories go to Google's embeddings API on every turn with no sensitivity tag and no audit event (`src/lib/ai/embedding-provider.ts:5-11`). Seven student-record call sites write no audit row at all. And when the local path *is* switched on, the prompt traverses Cloudflare's edge, where TLS terminates for the Access check, on its way to a personal Mac whose tunnel auth defaults to `none` (`src/lib/ai/local-auth.ts:3`). Cloudflare is an uncontracted processor of education records in that design. So the honest comparison is not "no third party versus one third party." It is "one uncontracted party today versus one contracted party tomorrow." See Part 2.

**3. The most urgent item is not a vendor choice. It is a five-minute check.** Google's Gemini API terms make the no-training promise conditional on one thing: the key must be used "through a Cloud Project associated with an active billing account." If `GEMINI_API_KEY` was minted in AI Studio against an unbilled project, every student turn to date has been under the *unpaid* terms, where Google may use content "to provide, improve, and develop Google products and services" and "human reviewers may read, annotate, and process your API input and output." Confirm the billing link in the Cloud Console before anything else. Separately, the per-student personal API key path (`src/lib/chat/api-key.ts:17-31`) resolves *first* and routes that student's transcript under their own consumer Google account with no contract at all; it should be removed. See Part 4.

**4. Yes, a cloud model with no-training / zero-retention terms can be used for student records, and this review recommends doing so — with four conditions.** (a) A signed data-processing agreement in which the vendor is designated a school official (Microsoft writes this down for Azure explicitly; Google writes it for Workspace for Education but, as far as could be verified, not for Vertex AI; Anthropic, OpenAI, AWS and Groq offer strong no-training and retention terms without education-specific paper), the designation reflected in the SPOKES provider's annual FERPA notice, and the agreement covering DoHS-sourced data naming W. Va. Code 9-9-20 and flowing its confidentiality down to subprocessors. (b) A written student consent as a second, independent basis, which adult students can give themselves and which AEFLA providers already collect for other purposes. (c) Minimisation: the student chat prompt today carries exactly one direct identifier, the display name, and it does not need even that. (d) A pseudonymisation decorator at the single provider boundary that the codebase already has a pattern for. See Parts 1, 4, 5 and 6.

**4a. Two West Virginia statutes matter more than FERPA here, and neither is about AI.** W. Va. Code 9-9-20 makes DoHS beneficiary records confidential under **criminal penalty** and only allows release under an agreement that names that section and binds the recipient's agents; that covers the SPOKES case data FERPA might miss. W. Va. Code 18-2-5h, if it reaches WVDE-administered adult education (an open question), **prohibits schools from collecting "data collected through affective computing"**, which is a plausible description of a coach that detects and responds to a student's emotional state. VisionQuest's mood extractor, its conversation summariser (instructed to capture "emotional state") and its crisis detector all touch this, and today the first two run on Gemini. Whatever counsel concludes, the cheap posture that is defensible under every reading is: **mood, crisis and emotional-state content never goes to a cloud model and never into state reporting.** See Part 1.5 and D-J.

**5. "Invent something" — the answer is an assembly, not an invention, and it must be framed honestly.** The app already knows every student's name, email, phone, DOB and address structurally, so it does not need a name-detection model to keep them out of prompts: deterministic substitution before the call and re-hydration on the streamed reply handles 11 of the 14 student-record call sites, 13 of 14 with a small résumé change. What it cannot do is catch a family member's name a student types into chat, and no library shippable in Node does that reliably. So the correct claim to make to WVDE or DoHS is **"reduced disclosure under contract,"** never **"de-identified data."** A first-person account of one adult's job search in one West Virginia county is linkable with or without a name. See Part 5.

**6. Britt's mental model needs one correction.** The five-field list (name, phone, address, email, DOB) is the *direct identifier* list. FERPA protects *education records* — anything directly related to a student and maintained by the program — so the transcript, the goals, the mood entries, the memories and the crisis alerts are all protected whether or not a name is attached. And the schema holds more than five fields: `SpokesRecord` carries race, ethnicity, gender, household type, TANF participation hours, barriers, wages and employer, none of them encrypted (`prisma/schema.prisma:353-395`). None of those reach a prompt today; that is a good fact worth pinning with a test. And under W. Va. Code 9-9-20 and 18-2-5h(b)(11), *recipient status itself* is protected information: the roster is sensitive before any field is populated.

**7. The one thing that cannot be degraded by any of this: crisis detection.** It is deterministic regex, runs before the provider is resolved, and appends the 988 block after generation (`src/lib/chat/crisis-scan.ts`, `route.ts:1125-1133`). A provider change cannot weaken it.

**Recommended architecture in one sentence:** one contracted cloud processor for interactive chat with the display name pseudonymised and the transcript window pinned, the highest-sensitivity batch tasks (document bytes, résumé extraction, endorsements) on a second lane that is either a contracted zero-retention open-weight host or a properly-secured local model, a written classification-to-lane mapping that is enforced in code rather than by a config row, and a student-facing "what Sage does with your data" page.

---

## Part 1 — What the rules actually require

*(See `C-legal-framework.md` in the supporting folder for citations and the verbatim regulatory text. This part distinguishes statute and regulation from guidance and from inference.)*

### 1.1 Does FERPA apply to SPOKES? Probably, provider by provider

FERPA reaches an "educational agency or institution" that receives funds under a program administered by the Secretary of Education (34 CFR 99.1). AEFLA (WIOA Title II) is such a program, and SPOKES is delivered under a WVDE Office of Adult Education contract with DoHS through regional educational cooperatives and county adult-education programs. The only on-point federal analysis is the ED/DOL *Joint Guidance on Data Matching to Facilitate WIOA Performance Reporting and Evaluation*, which splits the answer: LEAs and postsecondary institutions providing AEFLA services "are generally considered to be educational agencies or institutions subject to FERPA," while community-based nonprofits delivering the same services "typically would not be." Even where FERPA does not reach the entity, the redisclosure limits of 34 CFR 99.33 follow any education-record PII it received from a covered institution. So: **most SPOKES sites are probably covered; each site's legal identity and funding path must be confirmed** (Part 8, D-H).

If FERPA applies, VisionQuest's database is inside the definition, not outside it: "education records" are records directly related to a student and maintained by the institution "or by a party acting for the agency or institution" (34 CFR 99.3). And because every SPOKES student is an adult, **every FERPA right is the student's own** (34 CFR 99.5(a)(1)): no parent, no PPRA, no COPPA. That is the single biggest legal advantage the program has and it is underused.

### 1.2 Nothing in FERPA bars cloud AI; FERPA conditions it

FERPA is a disclosure-consent statute, not a technology statute. It has no hosting, locality, architecture or AI provision. 34 CFR 99.31(a)(1)(i)(B) expressly lets a "contractor, consultant, volunteer, or other party" be treated as a school official if it (1) performs an institutional service the institution would otherwise use employees for, (2) is under the institution's direct control as to use and maintenance of the records, and (3) is bound by 99.33(a): use only for the disclosed purpose, no redisclosure. PTAC's February 2014 guidance on online educational services is fourteen pages of *how*, and it notes that FERPA does not even require a written agreement, though in practice a contract is how direct control is proven. The Secretary's Dear Colleague letter of 22 July 2025 affirms that AI uses "are allowable under existing federal education programs" and names **"virtual advising systems"** and career-pathway platforms as fundable categories, with one privacy sentence: systems "must comply with federal privacy laws including FERPA." No PTAC AI-specific FERPA guidance exists as of the research date; anyone who cites one should be asked for the document.

**Two conditions get skipped.** The annual FERPA notification must specify the criteria for who counts as a school official with a legitimate educational interest (34 CFR 99.7(a)(3)(iii)); if the SPOKES provider's notice does not describe contractors that way, the exception is unavailable no matter how good the contract is. And the institution must affirmatively inform the vendor of the 99.33(a) restrictions (99.33(d)).

**The one AI-specific landmine is training.** Using education-record content to improve a model is a use for a purpose other than the one disclosed, which 99.33(a)(2) forbids. This is not a new AI doctrine; it is the ordinary use-limitation rule. Google's Gemini API terms draw exactly this line between tiers: the unpaid tier says Google uses content "to provide, improve, and develop Google products and services," permits human review, and instructs "Do not submit sensitive, confidential, or personal information to the Unpaid Services." The paid tier does not. Which tier the deployed key bills against is the highest-value single fact in this review.

### 1.3 De-identification: stripping the five fields does not de-identify a transcript

34 CFR 99.31(b) allows release without consent only after removal of *all* PII, and 99.3 defines PII to include indirect identifiers and "other information that, alone or in combination, is linked or linkable to a specific student that would allow a reasonable person in the school community ... to identify the student with reasonable certainty." PTAC's de-identification guidance is blunt: "simple removal of direct identifiers from the data to be released DOES NOT constitute adequate de-identification." A coaching transcript about a TANF recipient in one of West Virginia's 55 counties, several with populations under 10,000, is near the worst case: county plus barrier plus occupational goal plus cohort timing is plausibly unique to an instructor. **Do not build the compliance story on de-identification.** Pseudonymisation (Part 5) is minimisation under a contract, not a way out of FERPA.

### 1.4 The benefits-program rules, which cover the data FERPA might miss

- **TANF.** The federal rule is one delegating clause (42 U.S.C. 602(a)(1)(A)(iv)); whether the prescriptive 45 CFR 205.50 still binds TANF post-PRWORA is contested and for counsel. It does not much matter, because West Virginia legislated directly. **W. Va. Code 9-9-20** makes "all records and information of the department regarding any beneficiary" confidential, carries a **criminal misdemeanor** for knowing release, and permits release to another entity only under an agreement that **specifically references that section by name and extends its confidentiality requirements to the entity, its agents and employees**. A generic confidentiality clause does not satisfy it, and "agents" plausibly reaches subprocessors (Google, Supabase, Render, Twilio). Recipient status itself is protected: the mere existence of a row in VisionQuest's roster encodes it.
- **SNAP.** 7 CFR 272.1(c) is a closed list of permitted uses, all program-administration, and binds the *recipient* of the information directly. VisionQuest's defensible position is that it acts for the administering agency in an employment-and-training function connected to the plan; that characterisation should be written into the contract, not assumed.
- **WIOA.** 20 CFR 683.220, routinely cited as "the WIOA privacy rule," applies to Title I and Wagner-Peyser funds. SPOKES is Title II. It does not directly bind a SPOKES provider; do not cite it as if it does.

### 1.5 West Virginia state law: two statutes that outrank the FERPA question

**W. Va. Code 18-2-5h (Student Data Accessibility, Transparency and Accountability Act).** Usually treated as K-12, but its definition of "school district" includes "the West Virginia Department of Education with respect to the education programs under its jurisdiction that are not in the public schools," which is a plausible hook for WVDE-administered adult education. Unresolved; no case law or AG opinion found. If it reaches SPOKES, three provisions bite:

1. "Confidential student information" expressly includes "whether the person or their family are or were recipients of financial assistance from a state or federal agency" and "medical, psychological or behavioral diagnoses," and the Department is directed to prohibit its collection (with a scrivener's cross-reference error a court would likely read past).
2. **Schools "shall not collect ... any data collected through affective computing,"** defined as "human-computer interaction in which the device has the ability to detect and appropriately respond to its user's emotions." This is a **collection ban**, which consent does not cure. VisionQuest's mood extractor parses *self-reported* 1–10 scores from chat (`src/lib/sage/mood-extractor.ts:12`), which is arguably disclosure rather than device inference; the conversation summariser, however, is instructed to capture "emotional state" (`src/lib/chat/conversation.ts:281,335`), and the crisis detector is detection by the device. Three mitigating readings exist (scope of "schools," self-report versus inference, the safety purpose) and all need counsel. The cheap, defensible posture under every reading: **mood, crisis and emotional-state content never goes to a cloud model and never into state reporting.** Today all three go to Gemini.
3. Vendor contracts governing outsourced student data must "include penalties for noncompliance." Not a FERPA requirement; cheap to add; add it regardless.

**W. Va. Code 9-9-20** is described above. Note also what West Virginia does *not* have: the breach-notification statute (46A-2A-101) covers only name plus SSN, licence or financial-account number with an identity-theft nexus, so a leak of every transcript in the state would likely trigger no duty under it; and there is no comprehensive consumer-privacy act in force (HB 4868 sits in House Judiciary). Breach duties will therefore come from the contract, and should be set at "any unauthorised access to student data."

**WVDE's own AI guidance** (v1.2, March 2025, PK-12 by its terms) states the posture a WVDE-contracted program will be measured against: staff and students "are prohibited from entering confidential or personally identifiable information into unauthorized AI tools, such as those without approved data privacy agreements," and "even with consent, using identifiable data in public AI models is not advisable." That maps exactly onto the paid-versus-unpaid tier distinction and onto the contract-first architecture in Part 6.

### 1.6 Consent: available, workable, and already how AEFLA operates

A valid consent (34 CFR 99.30) specifies the records, states the purpose, names the party or class ("third-party AI service providers used to operate the coaching feature, currently Google LLC"), and is signed and dated; electronic signature is expressly permitted if it authenticates the person, which a logged-in student's click with a server timestamp and audit row does. The joint guidance records that AEFLA providers already obtain written consent from participants for wage-record matching, so asking adult students is an ordinary act in this program. One well-drafted instrument can discharge FERPA 99.30, W. Va. Code 9-9-20(a)(2) ("express written consent of the beneficiary") and the 45 CFR 205.50 expectation together. Two consequences: consent must be genuinely voluntary, so a working non-cloud path is what makes declining possible; and 99.30(c)(1) gives the student a right to a copy of what was disclosed, which implies logging what was *sent* to the model, not only what was written back.

**This review's position, matching the legal report's:** belt and braces. The school-official designation is the primary basis (it survives a student who never signs, and it is what PTAC expects of an operational system); a 99.30 consent is the second, independent basis. Consent alone is the wrong design: any withdrawal breaks the service and it puts the compliance weight on the least sophisticated party.

### 1.7 Health law, briefly

HIPAA does not apply (not a covered entity). 42 CFR Part 2 does not apply unless VisionQuest ever adds a substance-use *referral* feature, at which point re-run the analysis. W. Va. Code 27-3-1 is keyed to treatment at a mental-health facility. The real constraint on mood and crisis data is the education statute above, which is exactly why it is easy to miss.

### 1.8 Required versus folklore

| Claim | Reality |
|---|---|
| "FERPA prohibits student data in the cloud or in AI." | False. No technology provision; contractors expressly contemplated; the 2025 Dear Colleague letter names virtual advising as allowable. |
| "FERPA requires a signed vendor contract." | Not as a matter of law (PTAC 2014), but get one: 9-9-20 and 18-2-5h independently require contract terms. |
| "Strip name, email, phone, DOB and it is de-identified." | False, emphatically (PTAC). |
| "US data residency is legally required." | No source found. Sound procurement hygiene; do not call it mandatory. |
| "We must notify students of any breach." | Not under WV law for this data. Set the duty by contract. |
| "HIPAA covers the mood data." | No. 18-2-5h(e)(3) does, if it applies. |
| "20 CFR 683.220 applies to us." | Title I only; SPOKES is Title II. |
| "Adults' records are not education records." | Backwards: adulthood moves the rights to the student, it does not remove them. |

The full contract checklist, item by item with the source that makes each necessary, is section 10 of `C-legal-framework.md`.

---

## Part 2 — What VisionQuest does today

### 2.1 The routing switch, stated precisely

`resolveAiProvider()` (`src/lib/ai/provider.ts:174-196`) is the only FERPA routing decision in the codebase:

```
if sensitivity is student_record or staff_entered:      # provider.ts:180-186
    if SystemConfig.ai_provider == "local": Ollama
    else:                                   Gemini      # no refusal branch
```

`getConfiguredProviderType()` (`:22-25`) returns `"cloud"` for any value that is not the literal `"local"`, including unset. The rule in `.claude/rules/sage-ai.md` ("student_record/staff_entered are local-only by policy") is therefore a preference that yields to one config row. The September 1 audit's F15 counted 27 call sites in 13 files; today it is **32 literal `student_record` occurrences across 14 files, 14 distinct `resolveAiProvider` call sites**. It is worth being exact about the failure mode, because the repo's own notes describe it two ways: the provider does *not* fail open at runtime (an unset or invalid local URL throws and the chat route returns 503 with the 988 block, `route.ts:380-415`); what is open is the **default**.

`draft_endorsement` is the one call site that refuses rather than inherits this (`src/lib/connect/endorsement.ts:100-122`). It is the pattern the other sites should copy.

### 2.2 Every path student data takes out of the process

The full 34-row inventory with evidence is in `A-egress-inventory.md` §1. The rows that matter for this decision:

| Flow | Destination | What actually goes | Tag | Gate | Risk |
|---|---|---|---|---|---|
| Student chat turn | Gemini (when `ai_provider != local`) | 20 turns of transcript, **display name** in the system prompt, goals, readiness, alerts, memories, RAG snippets | `sage_student_chat` / `student_record` | audit only | 5 |
| **RAG query embedding** | Gemini embeddings API | the raw student message, verbatim | **none** — no task, no sensitivity, no audit | none | 5 |
| **Memory storage embedding** | Gemini embeddings API | the extracted fact itself (transportation, childcare, work history by prompt design) | none | none | 5 |
| Post-response extraction ×4, memory extraction, conversation summary | Gemini | recent transcript turns | `sage_post_response` / `student_record` | audit on some; **memory extraction writes none** | 5 |
| Résumé upload → extract | Gemini | raw résumé text: name, address, phone, email, employers | `resume_extract` | audit | 5 |
| Résumé assist | Gemini | stored résumé + **`Student.email`** | `resume_assist` | audit | 4 |
| Sage briefing, wager diagnosis | Gemini | `JSON.stringify(bundle).slice(0,4000)` — **student id and display name are the first keys** | `student_record` | **no audit event** | 5 |
| **Chat file gist (cloud)** | Gemini via **raw `fetch`, bypasses `resolveAiProvider`** | the whole uploaded document as base64 | `chat_file_gist` | `cloud_file_processing` consent + `role === student` | 3 |
| Per-student personal Gemini key | Google, **under the student's own consumer account** | everything above for that student | n/a | none; checked first | 5 |
| Local path (`ai_provider = local`) | Ollama on a Mac via **Cloudflare Tunnel + Access** | same payloads | same | service token; auth default `none` | 3 |
| Sentry | Sentry SaaS | `user.id` kept; `event.message` and `exception.value` never scrubbed | n/a | partial scrub | 3 |
| Twilio SMS | Twilio → carriers | phone number, employer, interview time | n/a | consent + code verification + STOP | 3 |
| Employer packet + `/connect/[token]` | SMTP → employer; unauthenticated page | first name + last initial, résumé, certs, endorsement | n/a | consent scope + per-connection allowlisted card | 2 |
| **`/credentials/[slug]`** | anyone on the internet | full display name **and the login username**; no `noindex`, no `robots.txt` | n/a | `isPublic` only | 4 |
| DoHS CSV export | WV DoHS | login username, class, dates, employer, wage, retention | n/a | instructor-scoped, audited | 3 |
| Job APIs (COS, Talroo, jsearch, USAJOBS, Adzuna) | those vendors | **no student data** | n/a | n/a | 1 |

Three things the September 1 audit did not surface: embeddings carry no FERPA tag at all and cannot be told to refuse (`embedding-provider.ts:62-69`); seven student-record model call sites (`briefing.ts`, `wager-diagnosis.ts`, `tailor-application.ts`, `failed-extractions/[id]`, `classify-attachment.ts` local path, `memory/extract.ts`, `chat/warmup`) log zero AI audit events; and the `ferpa-routing` benchmark is `nightly`, `floor: null`, requires a `BENCH_PROD_READONLY_URL` that is unset, and can only see calls that wrote an audit row. **A ratio of 0.0 from it would not mean no student data reached Google.**

### 2.3 What is actually inside the prompts

`B-prompt-contents-and-deidentification.md` §1.2 is a 21-row prompt × field matrix. The quantified result:

- **8 of 21** prompts interpolate an owner-listed direct identifier as a structured field. **6 of those carry only the display name** (`system-prompts.ts:691-698`). The **2** heavy ones are the résumé paths: `resume-ai.ts:100-119` sends name plus `Student.email` plus the résumé's own contact block; `resume-extract.ts:101` sends name plus raw résumé text.
- **11 of 21** carry no direct identifier at all, only education-record content (goals, readiness, certifications, alerts, memories, transcript).
- **The free-text channel is present in 8 of 21** and is the one nobody can enumerate: whatever the student types goes in verbatim.
- **Transcript depth is 20 turns on the cloud tier and 6 (or 12) on the local tier** (`route.ts:703-711`), chosen by provider name. Flipping to cloud for latency silently triples the free-text exposure per call.
- `Student.studentId` — the **login username** — is interpolated into every staff-chat prompt (`staff-student-context.ts:458`, and up to eight students' at `:529` on an ambiguous name). It is also printed on the public credential page (F12). It must be treated as an identifier.
- Date of birth is fetched into the context bundle (`context-bundle.ts:205`) and used only for an alert flag, but sits inside the object serialised at `briefing.ts:191`; no test pins it out.
- **TANF/SNAP status, `SpokesRecord.firstName/lastName/county`, race, ethnicity and phone numbers reach no prompt anywhere.** `explain_job` has a test asserting no work-profile value enters its prompt (`job-search-tools.test.ts:792-815`); that is the pattern every cloud-lane prompt should carry.

### 2.4 The local path, honestly

The deployed design is a Cloudflare Tunnel to `llm.<domain>` fronted by Cloudflare Access service tokens (`docs/plans/2026-04-15-local-ai-tunnel-recommendation.md`; headers built at `src/lib/ai/local-auth.ts:49-52`). Cloudflare Access terminates TLS at its edge to evaluate those headers and re-originates to the tunnel. **The full prompt is in plaintext in Cloudflare's memory on every turn.** There is no DPA with Cloudflare for that. The host is a personal machine with `authMode` defaulting to `"none"` and a silent failure when it is left there, no per-user identity on access, no audit record on the model side, and Ollama's own server log on disk with no retention policy. The tunnel doc records repeated 502/530/empty-stream incidents in production, and a sleeping or updating Mac takes Sage down for every student (fail-closed, correctly, but down).

| | Local path today | Cloud under a no-training + zero-retention DPA |
|---|---|---|
| Parties in the plaintext path | Render, **Cloudflare edge**, the Mac's OS, Ollama, anyone with the Mac | Render, the vendor |
| Contract governing retention | none | signed |
| Audit evidence | none | SOC 2 / ISO report |
| Access control on the model host | one shared token; default `none` | vendor IAM + audit |
| Breach notification duty | none defined | in the DPA |
| Availability | one machine, one tunnel | vendor SLA |
| Year-1 cost | $4,134 (`VisionQuest_Annual_Cost_Analysis_2026.md`) | ~$710 |

The local path wins on **legal simplicity and optics**: no new processor to disclose to WVDE, and "on-premises" is easy to say. It does not win on "fewer parties can see the data." It is currently worse on that measure than a contracted vendor would be.

### 2.5 Data at rest, retention, consent

- Only `Student.geminiApiKey`, `Student.mfaSecret` and `SystemConfig` secrets are encrypted at the application layer (`src/lib/crypto.ts`). No name, DOB, phone, race, wage, transcript, memory or file is. Confidentiality rests on Postgres RLS plus Supabase disk encryption. RLS *enablement* is near-complete (95 tables); RLS *test coverage* is 18 of 92 (`rls-coverage` benchmark), with `Message`, `SpokesRecord` and `Certification` untested.
- Supabase region is not determinable from the repo; `STORAGE_REGION=us-east-1` suggests N. Virginia. Confirm in the dashboard.
- `docs/DATA_RETENTION_POLICY.md` is a draft with every duration `OWNER-CONFIRM`, no purge automation, no self-serve export, and an offboarding export that misses 30 student-linked models including `Message`.
- Consent scopes that gate anything: `cloud_file_processing` and `employer_referral` (`src/lib/consent.ts:17-30`). The `ai-data-consent` orientation form is a paper acknowledgement with `acceptsSubmission: false` and no code gate. **There is no consent scope, and no notice, for "your conversation goes to Google."**

### 2.6 Findings, graded

**CRITICAL**

- **C1. Uploaded documents already go to Google in plaintext, outside the routing layer.** `src/lib/sage/file-gist.ts:38-64`. `ai_provider = local` does not stop it. Route it through `resolveAiProvider` or make the consent gate the documented, deliberate exception.
- **C2. Per-student personal Gemini keys resolve first and void any agreement the program signs.** `src/lib/chat/api-key.ts:17-31`. Remove the branch for student-record tasks; audit `Student.geminiApiKey IS NOT NULL` first.
- **C3. The "on-premises" local path routes plaintext records through Cloudflare, an uncontracted third party**, and the funder-facing cost document says otherwise. Either a Cloudflare DPA, a raw WireGuard/Tailscale tunnel with no L7 termination, or correct the document.
- **C4. The Gemini paid-tier no-training term depends on the key's project having an active billing account.** Unverifiable from the repo. Owner check, today.

**WARNING**

- **W5.** Embeddings have no sensitivity parameter and no audit event; raw chat and memory text go to Google's embeddings API on every turn (`embedding-provider.ts:5-11`, `hybrid-retrieval.ts:141-145`, `memory/store.ts:152-155`).
- **W6.** Seven student-record call sites write no `logAiAuditEvent` (list in §2.2), so the accountability report and the FERPA benchmark are structurally blind to them.
- **W7.** `Student.studentId` (login username) in every staff-chat prompt (`staff-student-context.ts:458,529`) and on the public credential page (`credentials/[slug]/page.tsx:66`), which has no `noindex` and no `robots.txt`.
- **W8.** Memory extraction solicits life circumstances and forbids third-party names only by instruction (`memory/extract.ts:37-39`); a minor's name recorded once is replayed into every subsequent prompt.
- **W9.** Cloud tier triples transcript depth (`route.ts:703-711`) by provider name rather than by policy.
- **W10.** `resume_assist` sends `Student.email` for no reason the model needs (`resume-ai.ts:102`).
- **W11.** Sentry scrub leaves `event.message` and `exception.value` untouched and keeps `user.id` (`sentry-scrub.ts:107-127`).
- **W12.** `SpokesRecord` holds race, ethnicity, gender, TANF hours, barriers, wages unencrypted; race + gender + county is re-identifying in a rural WV county without a name.

**NOTE (things that are right and should be said so)**

- Crisis detection is model-free and runs before provider resolution.
- `draft_endorsement` refuses the cloud; the employer packet is allowlisted and frozen at approval; `explain_job` pins an identifier-free prompt with a test; job APIs receive no student data; the public `/connect/[token]` page carries no student id.
- `preferCloud` has zero call sites — the public-program cloud fast path is dead code, and should stay dead.
- Opaque cuids are defensibly not identifiers (high-entropy, unenumerable, mapping only behind RLS; `src/lib/log-keys.ts:11-15` already argues this in-tree). State the position in writing rather than leaving it implicit.

---

## Part 3 — What other institutions do

Full survey with ~40 sources in `E-institutional-practice.md`. The pattern is uniform enough to state as a rule:

1. **A data-classification tier maps to an allowed-tool list.** UC (P1–P4; FERPA at P3, generative AI only for P1–P2 without review), Harvard (Levels 1–4; AI Sandbox and ChatGPT Edu cleared to Level 3), Michigan (Low/Moderate/High/Restricted; U-M GPT on Azure OpenAI cleared to Moderate, which includes FERPA data), Stanford (low/moderate/high; own AI Playground alone cleared for high-risk).
2. **Exactly one class of tool is cleared for FERPA-tier data: an institutionally contracted enterprise product** with a signed no-training, defined-retention agreement — ChatGPT Edu (ASU, Cal State's 460,000 students, Stanford from June 2026), Azure OpenAI-backed in-house apps (Michigan), Gemini for Education under Workspace terms.
3. **The same model's consumer tier is banned for that data.** Every policy says so in nearly identical words, because the school-official exception is a contractual state, not a property of the model.
4. **Human decision authority is preserved.** Code for America's SNAP Policy Navigator (built with Anthropic) answers policy questions from documents and explicitly does not decide eligibility — the same confirm-card discipline VisionQuest already runs for goals, orientation and certifications.
5. **Transparency, weakest in practice.** Instructure ships per-feature "AI Nutrition Facts" naming the model, the data accessed and the retention. The July 2025 Department of Education Dear Colleague letter names "transparent" and "protective of student data" among five principles for AI bought with federal education funds. The cautionary tale is Cal State: students distrusted the sanctioned tool and used the consumer one instead; notice alone did not build trust.

**The closest peers to VisionQuest specifically:** Florida's NaviGator (self-hosted, every one of ~104 models tagged with the data classes it may receive — the architectural twin of `DataSensitivity`) and Khan Academy's Khanmigo (Azure OpenAI, "we anonymize all the information that is sent to their model" — the intent twin of the pseudonymisation layer proposed in Part 5).

**Where VisionQuest sits:** the *stated* rule is stricter than every peer except NaviGator. The *operating* reality (Part 2) is looser than every peer, because every peer has the contract and VisionQuest has neither the contract nor the enforcement.

**The workforce / TANF / SNAP sector has no documented peer.** DOL guidance (TEGL 03-25, the February 2026 AI Literacy Framework) is about teaching AI literacy, not routing case data. The one federal artefact naming SNAP, AI and governance together is the USDA FNS "Framework for State, Local, Tribal, and Territorial Use of Artificial Intelligence for Public Benefit Administration"; its existence was confirmed, its body was not read in this pass, and it should be read in full before anything is finalised.

**Two facts that changed recently:** the Student Privacy Pledge was retired by the Future of Privacy Forum on 2025-04-25 (vendors still citing it are citing a defunct badge; 1EdTech TrustEd Apps and Common Sense are the live successors), and WVDE's own AI guidance (v1.2, March 2025) is K-12 only — no West Virginia adult-education or workforce AI guidance was found.

---

## Part 4 — Cloud vendors: who will put what in writing

Full comparison with quoted terms and an explicit list of 17 unverified items in `D-vendor-terms.md`. Research date 2026-09-06; terms pages change, re-read before signing anything.

| Vendor / route | Trains on inputs? | Default retention | Zero-retention self-serve? | DPA self-serve? | FERPA school-official statement? | US processing pinnable? | ~$/1M input (Flash/Haiku class) |
|---|---|---|---|---|---|---|---|
| Gemini Developer API, **unpaid** | **Yes, plus human review** | indefinite | no | no | no | no | $0 |
| Gemini Developer API, **paid** (billing linked) | no | "limited period" for abuse (days unstated); 30 d if Search grounding | approval-gated, mechanism unverified | via Google Cloud terms | **no** (Google's commitment is Workspace-for-Education-scoped) | not on this endpoint | $0.25 |
| **Vertex AI (Gemini)** | no | abuse logs + up to 24 h prompt cache | form / invoiced billing (unverified) | **yes — Cloud DPA auto-incorporated** | **no** (same gap; ask in writing) | **yes**, regional endpoint, never `global` | ~$0.25 |
| **Anthropic Claude API** | **no, contractual** | **none by default** for conversation content; 30 d on the newest "Covered Models"; 2 y if flagged | no — sales; Haiku 4.5 is eligible, Fable/Mythos are not | **yes — auto-incorporated** | K-12 DPA exists; API applicability unverified | **yes — `inference_geo: "us"`, workspace-enforceable, ×1.1** | $1.00 (Haiku 4.5) |
| OpenAI API | no (opt-in only) | 30 d abuse | approval + sales | yes (console-signed) | Edu/Enterprise SDPA; API unverified | business tiers | ~$0.25–0.50 |
| **Azure OpenAI / Foundry** | **no, explicit five-point block** | 30 d abuse store in your geography; **verifiably off** via `ContentLogging: false` | Limited Access form | yes, Product Terms DPA | **YES — "agrees to be designated a school official," Azure named in scope, 34 CFR 99.33(a)** | yes — US DataZone | ~$0.15–0.60 |
| **AWS Bedrock** | **no, providers walled off** | **none by default** (zero operator access + ZDR); 30 d only for models requiring `aws_review` | **yes — `data_retention_mode: none`, enforceable by SCP** | yes | whitepaper "school official"; Bedrock in scope unverified | yes, regional + SCP | $0.06–1.00 |
| **Groq** (Gemma/Llama host) | no | **none for inference by default**; ≤30 d troubleshooting logs, switchable off | **yes — Data Controls page** | yes, published DPA with audit clause | no | **yes, "GCP buckets located in the United States"** | $0.075–0.11 |
| Fireworks | no (opt-in only) | none for open models | effectively default | unverified | no | US-only option | ~$0.10–0.90 |
| Together | no (opt-in only) | unspecified | yes (settings) | unpublished | no | **no — policy permits transfer outside the country** | ~$0.10–0.18 |
| OpenRouter | routes to ZDR providers on flag | none itself | yes | unverified | no | routing, not a nameable processor | passthrough |
| Confidential GPU (Azure/GCP) | you host | you control | n/a | inherited | inherited | yes | ~$5.60/GPU-hour (~$4k/month) |

**Reading the table for VisionQuest:**

- **Nobody is "FERPA compliant."** Microsoft is the only vendor that writes the school-official designation down and names Azure in scope. Google writes it for Workspace for Education, and no commitment for Vertex AI or the Gemini API could be found; its own FERPA page returned navigation-only on four fetch attempts, so this is inferred, not quoted. Ask Google's public-sector team the question in one email.
- **"No training" and "zero retention" are different promises.** Anthropic's API and Groq have the strongest *defaults* (no retention of conversation content unless flagged); Bedrock has the only *infrastructure-enforced* zero retention (an org-wide SCP that denies any other mode). Google and OpenAI are no-training by default but retain for abuse review unless an exception is approved.
- **The newest frontier models are excluded from zero-retention** at both Anthropic and Bedrock. The Flash/Haiku-class model VisionQuest would actually use is eligible everywhere.
- **Hosted open-weight models (Groq, Fireworks) are the "local model without the local hardware"**: contractual no-training and self-serve zero retention, US-only storage stated in plain words, ~120–180 ms time-to-first-token, cheaper than Flash Lite. They carry no education-specific paper at all, and Sage's tool-calling and boundary behaviour have never been measured on any open-weight model in this repo.
- **Confidential computing addresses the wrong threat** (a malicious operator) at fifty times the cost of contractual zero retention. Not now.

**Ranked shortlist (the vendor agent's, endorsed by this review):**

1. **Stay on Gemini, move to Vertex AI with a pinned US region, accept the Cloud DPA, request the abuse-monitoring exception.** Least code change: the `@google/genai` SDK switches backends with `vertexai: true, project, location`; `generateContentStream` and the SSE relay are untouched; `SAGE_PROMPT_REVISION` bumps and the gating evals re-run. Trade-off: no written school-official commitment from Google for Vertex; you argue the DPA satisfies 99.31(a)(1)(i)(B) rather than cite a page that says so.
2. **Azure OpenAI / Foundry if the FERPA paperwork is what WVDE or DoHS will ask for.** Only vendor with the designation in writing and a self-verifiable logging-off flag. Trade-off: model and SDK change, full eval re-run, and the modified-abuse-monitoring form has eligibility criteria a small nonprofit may not meet.
3. **Groq or Fireworks hosting Gemma/Llama as the second lane** (the "local-equivalent" for the batch tasks that today are meant to stay local), or Claude Haiku via Bedrock if the program prefers one processor with infrastructure-enforced zero retention. Either would also retire the home-Mac availability problem.

Not recommended: OpenRouter (no nameable processor), Together (non-US transfer permitted), confidential computing (cost, wrong threat).

---

## Part 5 — "Can we invent something?" De-identification, honestly

Full design memo in `B-prompt-contents-and-deidentification.md` §2 and the tooling survey in `F-deidentification-architectures.md`.

### 5.1 What exists

Every off-the-shelf redaction tool (Microsoft Presidio, Google DLP, AWS Comprehend, Azure AI Language, Skyflow, Private AI, LLM Guard, gateway hooks in LiteLLM/Portkey/Cloudflare AI Gateway) detects PII with a confidence score, and none publishes accuracy on casual, lowercase, misspelled, nickname-heavy chat — the 2026 literature confirms this is an open problem for all of them. Presidio's person-name recogniser benchmarks at roughly 0.51 precision / 0.68 recall and is Python-only. The one path that runs inside a Node process (GLiNER-PII via `onnxruntime-node`) is unvalidated on Appalachian colloquial text. A transformer NER model on Render would add hundreds of milliseconds per turn, which is slower than the Ollama call this is trying to escape. Skyflow's data-privacy-vault pattern is architecturally right and SaaS-priced wrong for 100–500 students.

### 5.2 What VisionQuest can build, because of what it already knows

The app knows each student's name, email, phone, DOB and address from the database. That turns the hard problem (open-vocabulary name detection) into an easy one (deterministic find-and-replace of a known dictionary) for every identifier the schema holds. The design:

- **A `withPseudonymization(provider, vault)` decorator at the `AIProvider` boundary**, applied inside `resolveAiProvider`'s cloud branch so no call site can forget it. The repo already ships the exact precedent: `withUsageLogging` (`src/lib/llm-usage.ts:157-269`) wraps all four provider methods and correctly re-wraps `streamWithTools` including the tool-call callback, which is the hard part.
- **A per-request token vault** (`[STUDENT_NAME]`, `[STUDENT_EMAIL]`, `[TEACHER_NAME_1]`, roster names, `Student.studentId`), replaced longest-first, word-boundary-anchored, case-insensitive with case preserved. The repo's own `explain_job` lesson applies ("ged" inside "changed"): a student named Art or Will makes it immediate. Prefer a loud placeholder over a plausible fake name, so a re-hydration miss shows as `[STUDENT_NAME]` in the UI rather than leaking silently. Placeholders must not be `_START`/`_END` shaped or `sanitizeForPrompt` (`system-prompts.ts:178-232`) will strip them, and re-hydration must only honour tokens the vault issued *this request*, never a pattern match, or a student typing `[STUDENT_NAME]` can forge one.
- **Streaming re-hydration** with a carry buffer: hold back the longest suffix of the buffer that is a proper prefix of any vault token (~24 characters at most), emit the rest, flush at stream end. Property-test it by splitting the same output at every boundary. Re-hydrate before SSE emit *and* before the transcript is saved, so what is stored matches what the student saw.
- **Tool calls** need the same treatment in three places: outbound messages, model-emitted arguments (re-hydrate *before* the tool runs, or `book_appointment` receives `[STUDENT_NAME]`), and tool results fed back.
- **Free text**: reuse the email and phone patterns already in `src/lib/log-redaction.ts:15-31` (do not write a second copy), add DOB and street-address patterns, and match against the roster of names the app already loads (`staff-student-context.ts:504-509`). Third-party names typed into chat ("my son Jayden") cannot be caught reliably by anything shippable here.
- **Résumé paths**: strip the contact block, let the model write the body, re-attach contact locally — the Connect packet already does this for a different reason (SEC-W4). About 20 lines; also removes `Student.email` from the prompt.
- **Memory**: run the outbound de-identifier over `memory.content` at *write* time, not only at prompt time, with a red-baselined fixture proving "her son Jayden" does not store the name.
- **Pin the transcript window** to the FERPA decision, not the provider name.

**Coverage:** structured substitution alone leaves **11 of 14** student-record call sites with no direct identifier; **13 of 14** with the résumé split. The residual is the student's own typed words and raw document bytes, and no engineering closes those. **Size:** ~1,100 lines across ~18 files, medium risk concentrated entirely in the streaming state machine, plus a `SAGE_PROMPT_REVISION` bump and a green run of the gating red-team and guardrail evals (currently blocked on the depleted Gemini credits).

### 5.3 What it does not achieve, and how to describe it

De-identification manages disclosure risk; it does not eliminate it (NIST SP 800-188; ED PTAC's de-identification guidance puts the burden on the institution to have a *defensible methodology*, not to have run a tool). A closed population of 100–500 students in one West Virginia program is the worst case: employer + town + certification track + approximate age singles someone out with no name present, and per-turn redaction does not compose into per-conversation safety. Published evidence also shows placeholder-dense prompts measurably degrade model reasoning, so the placeholder scheme must be A/B'd in `sage:quality:eval`, which already builds prompts with a fixed `studentName`.

The practitioner consensus, and this review's position: **contract first, minimisation second, pseudonymisation third**, and the claim to make to a funder is *reduced disclosure of identifiers under a data-processing agreement*, never *de-identified data*. Anyone who says the second thing about a chat transcript is wrong.

---

## Part 6 — Recommended architecture

**Principle:** the lane a prompt goes to is decided by the data class it carries, enforced in code, backed by a contract for every lane, and disclosed to the student. This is what every peer does; VisionQuest already has the `DataSensitivity` vocabulary to do it and lacks the enforcement and the contracts.

| Lane | Data classes | Provider | Contract | Code enforcement |
|---|---|---|---|---|
| **A — Public** | `public_program`, `system`: form lookup, program help, no student facts in the prompt | any contracted cloud model | vendor terms | prompt-builder test asserting no student field is interpolated (the `explain_job` pattern) |
| **B — Interactive coaching** | `student_record` chat, post-response extraction, summaries, briefing, memory | **one contracted cloud processor** (Vertex AI Gemini in a US region under the Cloud DPA, or Azure OpenAI if written FERPA paper is required) | DPA + no-training + retention exception + US region + school-official designation in SPOKES's own agreement | `withPseudonymization` decorator applied inside the cloud branch; transcript window pinned; embeddings routed and audited through the same decision; audit event mandatory (lint rule) |
| **C — Identifier-bearing batch** | résumé extraction, uploaded document bytes, endorsement drafting, `classify_attachment` | a **contracted zero-retention open-weight host** (Groq / Fireworks / Bedrock under an SCP), *or* a local model on a properly secured host | DPA + self-serve ZDR + US-only; or, for local, a tunnel that terminates TLS only on the host and a written host-security posture | refusal branch (the `endorsement.ts` pattern): if the resolved provider is not lane-C-eligible, refuse and alert, never fall through |
| **C' — Emotional-state content** | mood extraction, conversation summaries asked for "emotional state," any prompt carrying crisis context | lane C only, or deterministic code; **never lane B, never state reporting**, pending counsel on 18-2-5h(e)(3) | as lane C | the refusal branch keyed on task, not only on sensitivity |
| **Never a model** | crisis detection, consent, RLS, audit | deterministic code | n/a | unchanged |

Why lane C exists at all: latency does not matter for these tasks (they are batch), the identifiers *are* the payload (a résumé header), or the payload is raw bytes no decorator can clean. Keeping them off the interactive lane is the minimisation step that makes lane B's claim honest. Whether lane C is a hosted open-weight model or the local Mac is Britt's call (Part 8); the review's view is that a contracted zero-retention host is *more* defensible than the current tunnel design and removes the availability problem, and that if the local Mac stays it needs the Cloudflare L7 termination removed and a written security posture.

**Governance artefacts that go with it** (each is what a peer institution would show an auditor):

1. A one-page **classification-to-lane mapping**, signed by the owner, mirrored in `.claude/rules/sage-ai.md`, and enforced by the code above.
2. The **school-official designation** written into SPOKES's agreement with WVDE/DoHS and reflected in the annual FERPA notice, with the vendor DPA on file; the agreement covering DoHS-sourced data **naming W. Va. Code 9-9-20** and extending its confidentiality to VisionQuest's subprocessors; and a **penalties-for-noncompliance** clause (18-2-5h(c)(6)).
2a. A **99.30-compliant consent instrument** (records, purpose, named party or class, electronically signed by the authenticated student, audit row), drafted to also serve as 9-9-20(a)(2) express written consent, with a working non-cloud path so declining is real.
3. A student-facing **"What Sage does with your data"** page (Instructure's nutrition-label pattern) linked from the `/memory` page that already exists: which parts of a conversation go where, no training, retention, how to ask for a copy or deletion.
4. `docs/DATA_RETENTION_POLICY.md` with its `OWNER-CONFIRM` markers resolved, and the offboarding export extended to `Message`.
5. Correction of `docs/VisionQuest_Annual_Cost_Analysis_2026.md:25,40` so the funder-facing document says what is true.

---

## Part 7 — Action plan, in order

Effort is rough and assumes the existing agent-orchestrated workflow. "Owner" means only Britt can do it.

### Now (this week, no code)

| # | Action | Who | Effort |
|---|---|---|---|
| 1 | Confirm the `GEMINI_API_KEY` project has an **active Cloud Billing account** linked (Cloud Console → project → Billing). Write the answer down. | Owner | 5 min |
| 2 | Query `SELECT count(*) FROM "Student" WHERE "geminiApiKey" IS NOT NULL` on prod. | Owner | 5 min |
| 3 | Confirm the Supabase project region in the dashboard. | Owner | 2 min |
| 4 | Email Google's public-sector/education team: *does Google make a FERPA school-official commitment for Vertex AI, or only for Workspace for Education?* Email Anthropic: *can the K-12 DPA attach to an API organisation?* | Owner | 30 min |
| 5 | Ask WVDE/DoHS counsel the four questions in Part 8 D-H (FERPA applicability per site; 9-9-20 flow-down; whether 18-2-5h reaches adult ed and whether the mood/crisis features are "affective computing"; SNAP 272.1(c) characterisation). | Owner | 1 h |
| 5a | Pull the SPOKES provider's **annual FERPA notification** and check whether it names contractors as school officials with legitimate educational interest. No contract can cure its absence. | Owner | 30 min |
| 6 | Read the USDA FNS AI framework for public-benefit administration in full. | Owner or agent | 1 h |

### Sprint 1 — close the holes in the current path (engineering, ~2–3 days)

7. **Refusal branch** in `resolveAiProvider` for local-only sensitivities behind an `AI_LOCAL_REQUIRED` (or lane) flag, copying `endorsement.ts:100-122`. Closes flows 1, 2, 6, 7, 9–14, 19 in the inventory.
8. **Route `file-gist.ts` and `classify-attachment.ts` through `resolveAiProvider`**; keep the `cloud_file_processing` consent as an additional gate, not the only one.
9. **Remove the personal API key branch** for student-record tasks (`api-key.ts:17-31`), or record which key served each call if it must survive for a non-record scope.
10. **Give `resolveEmbeddingProvider` a `sensitivity`** and the same refusal; emit `logAiAuditEvent` from `embeddings.ts` with the studentId on `LlmCallLog`.
11. **Add `logAiAuditEvent` to the seven silent call sites**, and an ESLint `no-restricted-syntax` rule (the log-PII precedent) that fails CI on a `resolveAiProvider` call in a file with no audit event.
12. **Remove the login username** from `credentials/[slug]/page.tsx:66` and from the staff prompt (`staff-student-context.ts:458,529`); add `robots: { index: false }` metadata to both public routes.
13. **Sentry**: extend `scrubPii` to `event.message` and `event.exception`; drop `user.id`.
14. **Pin the transcript window** to policy rather than provider name (`route.ts:703-711`).
15. **Test that DOB, TANF/SNAP status, race, ethnicity, `SpokesRecord.firstName/lastName`, phone never reach any prompt** — today that is true and unpinned.
15a. **Route mood extraction, the conversation summariser and any crisis-context prompt off the cloud lane** (refuse or route local by *task*, not only by sensitivity), and drop "emotional state" from the summariser instruction (`conversation.ts:281,335`) unless counsel clears it.
16. Set `BENCH_PROD_READONLY_URL` and run `ferpa-routing` once, after 10 and 11, so the number means something.

### Sprint 2 — the contracted lane B (engineering ~1 week + owner paperwork)

17. Move the Gemini client to **Vertex AI** with an explicit US `location` (never `global`), service-account auth via a new Render secret, implicit caching disabled, no Search grounding on any student-record path. Assert the location in a test.
18. Request the **abuse-monitoring logging exception** for the project (form or invoiced billing; mechanism unverified — confirm with a rep).
19. Bump `SAGE_PROMPT_REVISION`; re-run `sage:agent:eval`, `sage:redteam:eval`, the guardrail evals and the crisis suites on the new endpoint (needs the Gemini credits topped up, an open item).
20. Owner: accept the Cloud DPA (auto-incorporated on Google Cloud terms), file it, put the school-official designation in SPOKES's agreement and annual notice, and name 9-9-20 in the DoHS-data agreement.
20a. Build the **consent instrument** as a real `ConsentRecord` scope (`cloud_coaching`), replacing the paper `ai-data-consent` form: records, purpose, named party, authenticated click, audit row, copy-on-request backed by the AI audit log; declining routes the student to the non-cloud lane rather than out of the service.
21. If Google answers "Workspace only" and WVDE wants paper: run the same steps against Azure OpenAI instead, budgeting a model change and a full eval re-run.

### Sprint 3 — minimisation and pseudonymisation (engineering ~2 weeks)

22. Résumé contact-block split (`resume-ai.ts`, `resume-extract.ts`, two routes) — do this first, it is 20 lines and a win regardless.
23. `src/lib/ai/deidentify.ts` (vault, substitute, re-hydrate, streaming carry) + `with-deidentification.ts` (structural copy of `withUsageLogging`) + wiring in the cloud branch + vault population at ~8 call sites + free-text regex and roster matcher + memory write-time de-identification.
24. Property tests over every chunk boundary; red-baselined leak fixtures built the way the crisis fixtures are (nicknames, lowercase, misspellings, WV names); an A/B of placeholder vs name in `sage:quality:eval`; tool-call argument checkpoint.
25. `SAGE_PROMPT_REVISION` bump and the full gating eval run.

### Sprint 4 — lane C and governance (owner-led, engineering ~3 days)

26. Decide lane C's host (Part 8, D-E). If hosted: add the provider (OpenAI-compatible endpoint, same shape as the Ollama provider), self-serve ZDR on, DPA filed, bake-off with `sage:model:bakeoff`. If local: replace the Cloudflare Access termination with a WireGuard/Tailscale path, set `authMode` to fail loudly when `none`, write the host posture down.
27. Student-facing "What Sage does with your data" page; classification-to-lane mapping doc; retention policy signed; offboarding export covers `Message`; cost-analysis document corrected.

---

## Part 8 — Decisions only Britt can make

These replace D1 from the September 1 review, which asked the question too narrowly ("local-only, or cloud with consent?"). Consent is not the mechanism peers use; the school-official designation is.

- **D-A. Policy ruling (replaces D1):** *A contracted cloud processor — signed DPA, no training, retention exception, US processing, designated a school official in SPOKES's own agreement — is an acceptable destination for `student_record` prompts that carry no direct identifier.* Recommended: **yes.** This is what every peer does and it is more defensible than today's operating reality. If **no**, then the honest consequence is that lanes B and C both need a properly secured host, the home Mac does not qualify as-is, and the student experience will stay slow.
- **D-B. Lane B vendor:** Vertex AI Gemini (least change, no written FERPA commitment) vs Azure OpenAI (written commitment, real migration) vs Claude/Bedrock (strongest default retention posture, migration plus eval re-run). Recommended: **Vertex first**, with Google's written answer on the school-official question deciding whether Azure follows.
- **D-C. Personal API keys:** remove entirely, or keep for a non-record scope only. Recommended: **remove.**
- **D-D. Which tasks stay off lane B:** the review proposes document bytes, résumé extraction, `classify_attachment`, endorsement drafting. Confirm or adjust.
- **D-E. Lane C host:** contracted zero-retention open-weight host (Groq/Fireworks/Bedrock) vs the local Mac with the tunnel fixed vs a dedicated cloud GPU VM running the current model. Recommended: **hosted**, for availability and for the contract; the Mac only if optics to WVDE outweigh both.
- **D-F. Cloudflare in the current local path:** DPA, replace the tunnel, or retire the path. Cannot stay as-is while the cost document says "on-premises."
- **D-G. Student notice and the `ai-data-consent` form:** replace the paper acknowledgement with a real notice page and, if legal advises, a recorded consent scope for lane B. Under the school-official exception consent is not required, but notice is cheap and the Dear Colleague letter asks for it.
- **D-H. Four questions for WVDE/DoHS counsel:** (1) for each SPOKES delivery site, whether it is a FERPA "educational agency or institution" (LEA, RESA, college) or a community-based provider, and who the FERPA-responsible institution is; (2) whether the data VisionQuest collects directly from students become "records and information of the department" under W. Va. Code 9-9-20, and the exact wording needed to bring VisionQuest and its subprocessors inside 9-9-20(a)(4); (3) whether 18-2-5h reaches WVDE-administered adult education through its (b)(9) definition, and if so whether a self-reported mood score, a model-written summary of "emotional state," and a regex crisis detector are "data collected through affective computing"; (4) the SNAP 7 CFR 272.1(c) characterisation to write into the contract. Part 1 gives this review's reading; a lawyer confirms it.
- **D-J. The mood extractor and the summariser's "emotional state" instruction (product decision, pending D-H(3)):** keep both but off the cloud lane and out of any state report; keep the extractor (self-report) and drop the summariser instruction (inference); or drop both. Recommended: **keep the extractor on lane C, drop "emotional state" from the summariser now**, and revisit once counsel answers. Crisis detection is deterministic and stays.
- **D-I. The residual you accept in writing:** third-party names typed into chat and small-population re-identification are not solvable to zero. Every peer accepts them under contract. Say so in the classification document rather than letting the next reviewer discover it.

---

## Appendix — verification and limits of this review

- Every `file:line` claim in Parts 0, 2, 5, 6 and 7 was checked by the orchestrating agent by reading the cited lines at `666877b`, not taken from the sub-agent reports on trust.
- Web claims carry the research date 2026-09-06. The vendor report lists 17 items it could not verify from a primary source; the most consequential are Google Cloud's FERPA page body (navigation-only on four attempts), the Vertex abuse-monitoring exception mechanism, and whether Anthropic's K-12 DPA or OpenAI's Edu agreement can attach to API usage.
- Nothing about the production Google Cloud project, the Supabase region, the count of students with personal keys, or the Mac's security posture could be determined from the repository. Those are the "Now" items in Part 7.
- This review is engineering and policy analysis, not legal advice. Part 8 D-H names the two questions for counsel.

Supporting reports: `A-egress-inventory.md`, `B-prompt-contents-and-deidentification.md`, `C-legal-framework.md`, `D-vendor-terms.md`, `E-institutional-practice.md`, `F-deidentification-architectures.md` in `docs/audits/2026-09-06-ferpa-pii-review/`.
