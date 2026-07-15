# Sage as a Full-Service Career Agent — Design & Recommendation

**Date:** 2026-07-15
**Status:** Design proposal (exploration lane — not built, not merged)
**Author:** Claude (design turn for Britt)

---

## 0. TL;DR — read this first

You asked for Sage to become a full-service career agent: goal-setting → counseling
→ portfolio → custom resume + cover letter → two-way job matching → **and then either
Sage or a second agent that mass-applies to jobs, bypassing CAPTCHAs and applying to
boards that have no API.**

**My recommendation, plainly:**

- **Build the full-service agent.** ~80% of the foundation already exists in the repo
  (tool-calling loop, job scraper, CareerOneStop grounding, RIASEC discovery, goal
  hierarchy, portfolio/resume models). The gap is *orchestration + a few persistence
  models*, not net-new infrastructure. This is very buildable and genuinely valuable.

- **Do NOT build the CAPTCHA-bypassing, mass-auto-apply bot.** This one piece I am
  recommending against, and I want to be direct about why rather than quietly designing
  around it. It is (a) against my own operating rules, (b) a Terms-of-Service violation
  on every major board, (c) legally exposed under the CFAA, (d) a FERPA/PII-consent
  problem given your students, and — the part that matters most for the mission —
  (e) **counterproductive: it gets students fewer interviews, not more.** Detail in §2.

- **Build the thing that actually gets the outcome you want** (more interviews for
  students) instead: an **"Assisted Apply" co-pilot** that does all the labor —
  discovers matches, tailors the resume + cover letter per posting, pre-fills every
  field it legally can — and leaves the final *submit* (and any CAPTCHA) to the student
  or a staff job-developer. Same destination (a student applies to many good-fit jobs
  with near-zero effort), without torching the student's accounts, the program's
  employer relationships, or your legal footing. Detail in §3–§4.

This is exactly the "make the ship call for him / surface unknown-unknowns" role you
asked me to play. The auto-apply bot is the one place your instinct and the evidence
diverge, so I'm flagging it hard and proposing the better road.

---

## 1. What already exists (do not rebuild)

A subagent mapped the repo. The scaffolding for a full-service career agent is largely
in place:

| Capability | Where it lives | State |
|---|---|---|
| **Agentic tool loop** (tiered, confirm-gated, audited, rate-limited) | `src/lib/sage/agent/{loop,executor,tools,confirmation}.ts` | Production |
| **Risk tiers** `read / mutate_reversible / mutate_consequential` + HMAC confirm tokens | `src/lib/sage/agent/{types,confirmation,flags}.ts` | Production |
| **Gemini multi-hop tool calling** | `src/lib/ai/gemini-provider.ts` (`streamWithTools`) | Production |
| **Job board scraper** (10 adapters: jsearch, adzuna, usajobs, careeronestop, ats, smartrecruiters, remoteok, remotive, arbeitnow, weworkremotely) | `src/lib/job-board/` + `adapters/` | Production |
| **CareerOneStop integration** (skills matcher, occupation profile, wages, training) | `src/lib/career/careeronestop-counseling.ts` | Production (needs `COS_*` keys) |
| **Two-way matching inputs**: RIASEC/Holland discovery, cluster matcher, recommendation ranking | `CareerDiscovery` model + `src/lib/job-board/{recommendation,cluster-matcher}.ts` | Production |
| **Job pipeline model**: saved → applied → interviewing → offered | `StudentSavedJob` (schema L1552) | Production |
| **Goal hierarchy** BHAG→monthly→weekly→daily→task + extraction + proposal | `src/lib/goals.ts`, `src/lib/sage/{goal-extractor,propose-goal}.ts` | Production |
| **Counseling guardrails** (deterministic crisis detection, mood, no message storage) | `src/lib/sage/crisis-detection.ts`, `src/lib/chat/crisis-safety-net.ts` | Production |
| **Resume** (single JSON blob), **portfolio** CRUD, **cover letter / interview prep** | `ResumeData`, `PortfolioItem` models; `career-tools.ts` | Partial (see gaps) |
| Career career-agent tools: `analyze_job_match`, `generate_cover_letter`, `prepare_for_interview`, `propose_resume_edit`, `save_job`, `update_application_status` | `src/lib/sage/agent/career-tools.ts`, `write-tools.ts` | Production |

**The real gaps** (this is what a full-service agent actually adds):

1. **No orchestration** — there's a per-turn tool loop and a wager loop, but nothing that
   runs a *whole* job-search campaign as a multi-step, resumable plan ("find matches →
   tailor materials → queue applications → track → follow up").
2. **Cover letters & interview prep are ephemeral** — generated as chat text, never
   persisted or versioned. A real applicant needs per-job tailored, saved artifacts.
3. **Resume editing is a narrow 4-field surface** (headline/objective/skills/references)
   with no full builder, no versioning, no per-application tailoring.
4. **Two parallel job tracks** (`Opportunity`/`Application` staff-curated vs.
   `JobListing`/`StudentSavedJob` scraped) that don't share a pipeline.
5. **No application-assembly or submission-assist layer at all.**

---

## 2. The auto-apply / CAPTCHA piece — why I'm recommending against it

You called this "the big challenge." It's actually the one part I think you should *not*
build, and here's the grounded case, because you've told me you'll usually take my
recommendation and I don't want you adopting this one blind.

### 2a. It violates my operating rules
Bypassing or solving CAPTCHAs and other bot-detection is on my hard "will not do" list,
and building a system whose purpose is to defeat those controls is the same act one step
removed. I won't design that, and I'd be doing you a disservice to pretend the reason is
only policy — the reasons below are why the policy exists.

### 2b. It's a Terms-of-Service violation on every major board
- **Indeed** explicitly prohibits "any automation, scripting, or bots to automate the
  Indeed Apply process outside of Indeed's official vendors and tooling."
  ([Indeed legal terms](https://docs.indeed.com/legal-terms/additional-api-terms-and-guidelines))
- **LinkedIn's** User Agreement prohibits unattended automation and bots. Their March
  2026 transparency report: 78.2M fake accounts blocked and **23.5M automated sessions
  flagged in one quarter**. In 2025 they added detection for "human-impossible
  application velocity" (100+ apps/hr) that flags accounts even when each application
  looks fine individually.
  ([ConnectSafely 2026 ToS guide](https://connectsafely.ai/articles/is-linkedin-automation-safe-tos-scraping-guide-2026),
  [Northlight on the HeyReach ban wave](https://northlight.ai/blog/is-linkedin-automation-against-the-rules))

### 2c. It's legally exposed under the CFAA
Scraping *public* job postings is generally lawful (and is what your existing scraper
already does — fine). But **the moment you circumvent a technical barrier like a CAPTCHA,
courts can read it as "unauthorized access" under the Computer Fraud and Abuse Act.**
That's the bright line: reading public data ≠ defeating an access control.
([cloro 2026 scraping-law overview](https://cloro.dev/blog/website-scraping-legal/),
[Cybersecurity Law Fundamentals ch.2](https://cybersecuritylawfundamentals.com/chapter-2))

For a **federally-funded workforce program serving TANF/SNAP recipients**, that exposure
lands on the program and the grant, not on a nameless bot.

### 2d. It's a FERPA / informed-consent problem
Auto-submitting a student's PII (name, contact, address, work history) to arbitrary
third-party employers, at machine speed, without the student reviewing each submission,
is exactly the kind of unconsented PII disclosure your governance is built to prevent.
Every application is a disclosure decision the student should own.

### 2e. The part that should actually change your mind: it backfires
Even setting aside law and policy — **mass bot-applying gets students *fewer* interviews.**
- Employers' ATS and boards increasingly detect and auto-reject bot-submitted, generic
  applications; velocity flags nuke the account the student needs.
- A banned LinkedIn/Indeed account is a catastrophe for a job-seeker who has few other
  channels.
- Volume ≠ outcome. 200 generic auto-applies convert worse than 15 tailored ones. The
  ToS-compliant tools that survive (Simplify, LoopCV's compliant mode, JobApplyAI) all
  converged on the same model: **generate drafts the user reviews, act only on
  user-initiated clicks.** ([LoopCV: is auto-apply safe](https://blog.loopcv.pro/is-it-safe-to-auto-apply/))

Your students' edge isn't volume — it's that they have a coach (Sage) and, uniquely, a
**local workforce program with real employer relationships.** Bots throw that edge away.
§3 keeps it.

---

## 2.5 How the market actually does it vs. what we'd do

Companies like LazyApply, AIApply, Sonara, and Simplify market "AI applies to jobs for
you." Under the hood there are only three techniques, and the honest one is the one this
design already proposes. This section is here so the decision in §7.1 is made against the
real mechanics, not the marketing.

### The three techniques behind "we apply for you"

| Technique | Who does it | What actually happens | Where it breaks |
|---|---|---|---|
| **Autofill, human submits** | Simplify | Browser extension fills form fields (Greenhouse ~90%, Lever ~90%, Workday ~70%); **user clicks submit on every one.** Not actually auto-apply. | Nothing breaks — this is the compliant model. It's also the best-reviewed. |
| **Bot-submits on "Easy Apply" only** | LazyApply, AIApply | Chrome extension runs **logged in under the user's own account/cookies**, so the board sees "the user" clicking and **the ToS/ban risk lands on the user, not the vendor.** Works almost exclusively on LinkedIn/Indeed one-click forms. | Any CAPTCHA, writing sample, coding challenge, or multi-step questionnaire → the bot bails. **They don't beat CAPTCHAs — they skip the jobs that have them.** |
| **Rewrite + bot-submit** | Sonara | Same logged-in-bot submission as above, plus per-posting resume keyword rewrite each morning. | Same failure point — only frictionless forms; risk still on the user's account. |

**The two things the marketing hides:**

1. **They shift the risk to the user.** Because the bot acts under the job-seeker's own
   login, the vendor's terms make the *user* responsible for any ToS violation or
   suspension. Vendor keeps the subscription; user's LinkedIn/Indeed account gets flagged.
2. **"Applies to any job" is false.** Every bot-submit tool is limited to Easy-Apply-style
   forms. "Apply to boards without an API / bypass CAPTCHAs" is not a capability any of
   them actually have — it's the boundary all of them stop at.

### The measured outcomes (why volume loses)

- Applications surged **+45.5%** in one quarter while jobs posted **−10.6%** — the gap is
  auto-apply tools flooding the funnel.
  ([jobstrack.io, 2026 data](https://jobstrack.io/blog/ai-job-application-tools))
- **33.5% of recruiters spot an AI application within ~20 seconds; ~19.6% reject on sight.**
- Auto-tools hit aggregator listings already 24–72h old, so the application lands in a
  pile that already exists; and **~1 in 4 online postings don't correspond to a real job**
  — bot effort burned on ghost jobs.
- **AIApply carries a BBB "F" rating**; career forums describe the pattern as "spams
  hundreds, rarely hits the mark." The market calls the result the hiring "doom loop."
  ([Reclaim Saturday: tested 6, only 2 work](https://www.reclaimsaturday.com/post/artificial-intelligence-job-application-services),
  [CBS News](https://www.cbsnews.com/news/ai-job-applications-mass-apply-autofill-job-search/))

### VisionQuest vs. the market

| | Consumer auto-apply tools | VisionQuest Assisted-Apply (this design) |
|---|---|---|
| Submission model | Bot submits under user's login (Easy-Apply only) | Human submits (Tier 2) or sanctioned API (Tier 1) or warm human send (Tier 3) |
| Who holds the ban/legal risk | **The student** | **No one** — no control is defeated |
| CAPTCHA / hard forms | Skipped entirely | Human present for the CAPTCHA; packet still pre-assembled |
| Resume tailoring | Keyword rewrite (some) | Grounded per-job tailoring, never fabricated |
| Unique channel | None — same public boards everyone floods | **Local employer relationships (Tier 3)** — gets read, not filtered |
| Coach in the loop | None | Sage + program staff |

**Takeaway:** the reputable market leader (Simplify) is already doing our Tier 2 —
high-quality autofill, human submits. The tools making the loudest "we apply for you"
claims are the ones with F ratings and recruiter-detection problems. Copying the
bot-submit model would make students *worse off* (flagged accounts, ghost-job spam,
20-second rejections). Our edge is the two things no consumer tool has: a coach who
tailors, and a program with real employer contacts.

---

## 3. The design: Sage as a full-service career agent

Same outcome you're after — *a student ends up applied to many good-fit jobs with almost
no manual effort* — reached the compliant, higher-converting way.

### 3.1 Career Campaign Orchestrator (the "full-service" brain)

A new resumable, multi-step orchestration layer above the existing per-turn tool loop —
model it on the **wager/OODA loop you already built**, not a new framework.

```
Campaign  = a student's active job search
  Stage 1  DISCOVER   → scrape + rank matches (wide, cluster/interest-weighted, §3.2)
  Stage 2  PREP       → ensure resume complete; generate per-job tailored resume + cover letter (§3.3)
  Stage 3  QUEUE      → assemble ready-to-submit application packets (§3.4)
  Stage 4  ASSIST     → student/staff reviews & submits; co-pilot pre-fills (§4)
  Stage 5  TRACK      → StudentSavedJob pipeline + follow-up nudges (§3.5)
```

- New Prisma model `CareerCampaign` (studentId, status, targetClusters[], cadence,
  weekly application target, current stage) + `CampaignStep` for the resumable log.
- Sage narrates progress in chat and via the ambient rail; a teacher can see each
  student's campaign on the existing Student Detail surface.
- Runs on the existing cron infrastructure (`api/cron/*`, Supabase pg_cron) for the
  autonomous "keep my search moving while I sleep" behavior — but every *outward* action
  stops at the human gate in Stage 4.

### 3.2 Wide, interest-targeted matching (you asked for this explicitly)

You want a *wide, variabled* search targeted to interest + cluster, not a strict
perfect-match filter. The pieces already exist; wire them into the campaign:

- Rank, don't filter. `src/lib/job-board/recommendation.ts` already scores; expand the
  scoring to a **banded** result set:
  - **Core** — strong cluster + skills match.
  - **Stretch** — adjacent clusters / transferable-skill matches (RIASEC neighbors from
    `CareerDiscovery`). Deliberately wider.
  - **Wildcard** — interest-driven picks outside the obvious cluster, capped, clearly
    labeled, to widen the aperture the way you described.
- Two-way framing: Sage explains *why* each job matches the student ("this fits your
  Realistic+Social profile and your CNA cert") **and** helps the student see where
  they're a fit for the employer (skills-gap callout from CareerOneStop Skills Matcher).

### 3.3 Persisted, per-application tailored materials (fills a real gap)

- New `CoverLetter` model (studentId, jobListingId, version, content, status) — cover
  letters become saved, per-job artifacts instead of ephemeral chat text.
- New `ResumeVersion` model (or a `versions` relation on `ResumeData`) so the agent can
  produce a **tailored resume per posting** (reorder skills, mirror the posting's
  keywords) without destroying the student's base resume. This is the single highest-
  leverage ATS win and is fully compliant.
- Reuse `gatherJobAndProfile()` (`career-tools.ts:201`) so everything stays grounded in
  real `JobListing` + `ResumeData` + `Certification` + `CareerDiscovery` — no
  hallucinated experience. **Hard rule: the agent tailors *emphasis*, never fabricates
  history.** (Fabricating a student's work history would be its own disaster.)
- The `spokes-job-search-toolkit` skill already encodes your green-themed .docx output
  style — the campaign's PREP stage should emit packets in that format.

### 3.4 Application packet assembly

For each queued job, the agent assembles a **packet**: tailored resume + cover letter +
a structured **answer sheet** (pre-computed answers to the common application questions —
work authorization, availability, salary expectation, screening questions) derived from
the student's profile. This is the labor that makes "apply to 20 jobs" feel like one
click — done entirely on *your* side of the wire, zero ToS surface.

### 3.5 Application tracker + follow-up

- Unify the two job tracks: promote `StudentSavedJob` to the single pipeline; migrate the
  staff-curated `Opportunity`/`Application` track into it or link them.
- Follow-up nudges (existing cron pattern): "It's been 7 days on the Kroger application —
  want Sage to draft a follow-up email?" Drafts, student sends.
- Outcome capture feeds the two-way matcher and your grant metrics (which, per your
  program memory, are what actually define success).

---

## 4. The "Application Co-Pilot" — three compliant submission tiers

This is the direct, legitimate answer to "apply to jobs for the student." It replaces the
one banned method with three lawful ones, tiered by how the destination lets you in:

### Tier 1 — API-friendly / partner boards → true near-one-click assisted apply
Where an official, ToS-blessed path exists, use it:
- **Indeed Apply** (partner integration — the *sanctioned* programmatic apply path;
  requires partner onboarding). ([Indeed Apply docs](https://docs.indeed.com/indeed-apply/apply-with-indeed))
- **USAJOBS** (already an adapter) and other public/government boards.
- **ATS partner integrations** (Greenhouse/Lever/SmartRecruiters "apply" endpoints where
  the employer has enabled them).
Here the student clicks "Apply," reviews the pre-filled packet, and confirms — the submit
is programmatic *and* authorized. This is as close to your original vision as is legal,
and it's the good kind.

### Tier 2 — No-API boards → browser-extension autofill co-pilot (human submits)
This is the compliant version of "apply to boards without an API." A **VisionQuest browser
extension** (LinkedIn's own 2024 guidance explicitly permits *"browser extensions that
enhance the user's own experience"* and *"tools that assist... if each action is reviewed
and approved by the user"*):
- On a job's application page, the extension **fills every field** from the packet
  (Tier-1-quality prep, Tier-2 delivery).
- The **student clicks submit. The student solves any CAPTCHA.** The bot never defeats a
  control; the human is present for the one action that legally and ethically must be
  theirs.
- Result: a 20-minute application becomes a 30-second review-and-click. That's the labor
  win you actually wanted, and it *keeps the account alive.*

### Tier 3 — Direct employer & job-developer channel (your unfair advantage)
You're not a bot farm — you're a **local workforce program.** The highest-conversion
channel isn't a board at all:
- A **staff job-developer console**: the agent surfaces best-fit students↔local-employer
  matches; staff (or the student) sends a real, warm, tailored application straight to a
  known employer contact. Human-sent, high-signal, ban-proof, and it compounds the
  employer relationships that make the program work.
- This is the lead-gen instinct from your operating profile applied to job placement:
  make the *program itself* the channel rather than fighting three ToS walls.

---

## 5. Governance (reuse what you built — don't reinvent)

- Every outward action = `mutate_consequential` tier → **HMAC confirmation token**
  (`confirmation.ts`) → explicit human approval before anything leaves the machine.
- Applying on a student's behalf via Tier 1 requires a **recorded, per-application
  consent** (a small `ApplicationConsent` record), not a blanket toggle — informed
  consent per disclosure.
- All actions already flow through `executeAgentTool()` audit logging and per-student
  rate limits — extend, don't replace.
- Keep everything behind the existing `SAGE_AGENT_MODE` flag (`off/readonly/full`) and
  ship dark first, exactly like the autopilot rollout.
- **No student PII to any cloud LLM** beyond what's already governed; packet assembly and
  autofill run over the student's own stored data.

---

## 6. Recommended first slice (close the plan→ship gap)

Do **not** build all of §3–§4 at once. Smallest shippable slice that delivers real value
this cycle:

1. **`CoverLetter` + `ResumeVersion` persistence** + a `tailor_application` tool that
   produces a saved, per-job tailored resume + cover letter packet. (Pure win, zero ToS
   surface, fills the biggest gap.) → ship first.
2. **Banded matching** (Core/Stretch/Wildcard) on top of the existing recommender. → ship second.
3. **Campaign orchestrator MVP** (DISCOVER→PREP→QUEUE→TRACK, no submission yet). → ship third.
4. **Tier-2 autofill extension** *or* **Tier-3 job-developer console** — pick one — as a
   separate, larger initiative with its own plan. → next milestone.

Tier 1 (Indeed Apply partner) is a *business/partnership* task (onboarding, agreements),
not just code — flag it as a parallel track for you to pursue, not something I can stand
up unilaterally.

---

## 7. Open decisions for you

1. **Do you accept dropping the CAPTCHA-bypass/mass-auto-apply approach** in favor of the
   Assisted-Apply co-pilot (§2–§4)? My strong recommendation is yes; the rest of the
   design assumes it.
2. **Tier-2 (browser extension) vs. Tier-3 (job-developer console) first?** My lean:
   Tier-3 — it plays to the program's real advantage and has no client-distribution
   overhead. Tier-2 is higher-reach but a bigger build (extension packaging, per-board
   field maps, maintenance).
3. **Pursue Indeed Apply partner onboarding?** Business decision; worth it only if board-
   volume applying is a core goal vs. direct-employer placement.
4. **Unify the two job tracks now or later?** (`Opportunity`/`Application` vs.
   `StudentSavedJob`.) Recommend later — it's a migration, not blocking the first slice.

---

*Nothing here is built. This is a design on an isolated worktree for your decision at the
gate. On your go, I'd start with slice #1 (§6).*
