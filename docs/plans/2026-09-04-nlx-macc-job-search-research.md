# Research: the NLx → MACC job-search handout and VisionQuest's mission

**Date:** 2026-09-04
**Status:** Research memo — awaiting owner decisions (D1–D3 at the end)
**Source reviewed:** "National Labor Exchange" instruction sheet shared by Sandra Adkins (WVDE, wvk12 SharePoint, shared to britt.legg@wvesc.org). The SharePoint link needs a WV K-12 sign-in; the review was done from two full-page screenshots supplied by Britt.
**Related:** `docs/superpowers/specs/2026-06-09-wv-local-job-feed-design.md`, `src/lib/job-board/adapters/careeronestop.ts`, `docs/superpowers/plans/2026-03-31-job-board.md`

---

## 1. Verdict in one paragraph

The handout's *goal* is squarely on VisionQuest's mission: put SPOKES students in front of West Virginia employers who post through WorkForce West Virginia, and get them applying inside the MACC, where each application is automatically recorded as a work-search activity. The handout's *process* is a poor fit for our students: six steps across two websites, one of which requires clicking "More" an unknown number of times to find one label in an alphabetised list of hundreds of companies. VisionQuest can deliver the same outcome with zero manual steps, because the job board already has a CareerOneStop adapter that reads exactly this NLx feed and supports the exact company filter the handout teaches by hand. The adapter has been dark since June for one reason: no CareerOneStop credentials. So the recommendation is not "build the NLx process into VisionQuest" but "finish provisioning the credentials that were already the critical-path item, then add three small WV-specific touches."

## 2. What the document is

A one-page, six-step student handout (with screenshots) titled "National Labor Exchange":

1. Go to `https://usnlx.com`.
2. Search by your local or nearby city (screenshot shows "Charleston, WV", Exact Location).
3. In the left "Filter By Company" panel, click **More** — "maybe multiple times".
4. Find and click **"West Virginia Employer"**. The handout says: "These are the jobs listed in the MACC." (Screenshot shows 29 such postings for Charleston.)
5. Open a posting and click **Apply Now** (example: "Production Associate", Charleston, WV, manufacturing).
6. "The link will take you to the job posting in the MACC. You must sign into the MACC to apply for any of these jobs."

There is no policy text, no rationale, and no mention of SPOKES, WV Works, or TANF. It is a how-to, written for a student or an instructor walking a student through it.

## 3. What the two systems are

**NLx (National Labor Exchange, usnlx.com).** A nonprofit public-private partnership between the National Association of State Workforce Agencies (NASWA) and DirectEmployers, running since 2007 as the successor to America's Job Bank. It collects roughly 3 million postings a day from corporate career sites, state job banks, and federal job sites, de-duplicates them, and redistributes them daily to every state job bank and to nonprofit and government partners. Applying always sends the job seeker back to the *point of origin* — the employer's own site or the state job bank. usnlx.com is the public search front end; under the hood it queries DirectEmployers' private search API (`prod-search-api.jobsyn.org`), which is not licensed for third-party use. Do not scrape it.

**MACC (Mid-Atlantic Career Consortium, macc.workforcewv.org).** WorkForce West Virginia's labor-exchange and case-management system. It is where WV employers (or WorkForce WV staff on their behalf) post jobs, where job seekers register and apply, and where WIOA, Wagner-Peyser, and related programs are case-managed and reported. Its public job search shows about 31,000 postings but requires an account to view details or apply. Two facts matter for our students:

- **WV Works (TANF) participants must be registered and "active" in the MACC** to satisfy work requirements (WV Income Maintenance Manual, ch. 13.5). SPOKES exists to serve WV Works participants.
- **MACC records work-search activity automatically.** WorkForce WV's 2026 Work Search Activity guide states that registering, searching, viewing a job, and applying inside the MACC need "no proof" because "your activities are automatically recorded". Applying anywhere else requires the student to keep dated screenshots.

**Why the handout goes through NLx instead of straight to the MACC.** The postings WorkForce WV enters directly appear in NLx under the anonymised company name "West Virginia Employer", with an Apply link back into the MACC. Filtering to that label on usnlx.com is the only way, without a MACC login, to see just the WV-employer postings rather than the full NLx feed of corporate listings (Oracle 1,168, Meta 298, and so on, as the screenshot shows). That is the whole trick, and it is what makes the process fragile: the label sits deep in a long list.

## 4. What VisionQuest already has

- **`careerOneStopAdapter`** (`src/lib/job-board/adapters/careeronestop.ts`) calls CareerOneStop's "List Jobs" API, which returns NLx postings — the same feed usnlx.com shows — for each SPOKES target title, within the class's region and radius, last 30 days. Every field the handout's process yields (title, company, location, description, apply URL that resolves to the MACC or the employer site) is already mapped to `NormalizedJob`. It returns `[]` when `COS_USER_ID`/`COS_API_TOKEN` are unset. They are unset in every environment.
- **The company filter the handout teaches by hand exists as an API parameter.** CareerOneStop's List Jobs accepts `companyName` as a filter, and with `showFilters=true` returns the same company facet list (name + count) the handout screenshots. The June design deliberately deferred a "trusted employer roster via `companyName`" as a future layer. "West Virginia Employer" is that layer's first entry.
- **Local-first defaults are already set.** `DEFAULT_JOB_SOURCES = ["careeronestop", "usajobs", "adzuna"]`, and `careeronestop` is in `TRUSTED_LOCAL_SOURCES`, so its listings get the ranking boost and the "Verified WV listing" reason once live.
- **Apply is fully external.** `JobCard` opens the listing URL in a new tab. There is no in-app apply, and nothing today tells a student that a given link will land on a MACC login screen.
- **Two disconnected application trackers.** A job-board apply becomes a `StudentSavedJob` row; the placement bridge and SPOKES placement provenance only consume `Application` rows (which hang off the curated `Opportunity` board). A MACC application made from the job board can therefore never reach a placement record. This was already recorded (VQ-R-017) and is the structural gap this handout makes more visible.
- **Sage** has `save_job`, `update_application_status`, `analyze_job_match`, `lookup_saved_jobs`, and `tailor_application`, but no `search_jobs` tool, and no knowledge of the MACC or NLx (zero hits for "MACC", "usnlx", or "Mid-Atlantic Career Consortium" anywhere in the repo before this memo).

## 5. Fit against the mission

**Where it helps.** The audience for VisionQuest is TANF/SNAP adults, most of whom are WV Works participants, most of whom need an active MACC registration anyway and get work-search credit only for activity done inside the MACC. A job board that surfaces MACC-origin postings and routes applications into the MACC does three things at once: real local entry-level jobs (the June spec's "empty tank" problem), applications that count toward the student's benefit requirements with no paperwork, and a data trail WorkForce WV can see. That is a better outcome than any of the remote or big-tech boards the adapters also pull.

**Where the handout itself does not fit.** Six steps, two sites, a hidden filter, and a login wall on a second system, for a population the design context describes as low-literacy, mobile-first, and easily derailed. The screenshots are desktop layouts. The "More (maybe multiple times)" step alone will lose students. This is the kind of process the product exists to remove, not to teach.

## 6. Options, ranked

1. **Provision CareerOneStop Jobs API access (owner action, no code).** Already listed as CRITICAL-PATH in MEMORY.md since 2026-07-31 for the assessment→occupation chain; this memo adds a second reason. One change since the June research: as of 2024-08-27, *all new* Jobs API requests are reviewed by the NLx Research Hub governance board (2–3 weeks), and the Hub's stated exclusions include "platform integration" and "job matching" without approval and any job board with a subscription model. VisionQuest is a free nonprofit education tool whose use is job search for a state workforce program, which is the case the CareerOneStop path is described as optimised for. The request should say exactly that, name SPOKES and WVDE, and cite the WorkForce WV relationship. This is the gating risk for everything below.
2. **"WorkForce WV posting" badge and MACC apply hint (small build).** In the adapter, detect `Company === "West Virginia Employer"` and add a dedicated `companyName=West Virginia Employer` query pass per region so those postings are never crowded out by the title-keyword passes. In `JobCard`, when a listing is MACC-origin (or its URL resolves to `macc.workforcewv.org`), show one plain-language line: "This job is on the MACC. You'll sign in with your MACC account to apply. Applying there counts as a work search activity." Estimated size: adapter change + test, one card component change, one source-option label tweak.
3. **Make MACC registration a visible journey item (product call, small build).** If SPOKES students are required to hold an active MACC account (D2 below), add it as an orientation item with the registration link, so "Do this next" can point at it and Sage can nudge. Cheap, and it removes the login-wall surprise in step 6 of the handout.
4. **Give Sage the handout (trivial).** Ingest this memo's step list as a `ProgramDocument` / catalog entry so Sage can walk a student through usnlx.com if an instructor sends them there directly, and answer "what is the MACC?" correctly. No code.
5. **Close the tracker gap (larger, already tracked as VQ-R-017).** Let a `StudentSavedJob` reaching `applied` create or link an `Application`, so MACC applications made from the board can flow into the placement bridge and SPOKES placement provenance. Not required for the handout's value, but it is what turns "students applied" into "students placed" in the program's own records.

Not recommended: building an NLx adapter against usnlx.com (private API, no licence), or an NLx Research Hub feed (research-only terms, explicitly excludes job matching and platform integration), or driving students to the manual six-step process.

## 6a. Execution status (2026-09-04, same day)

Britt chose option 1 and has requested CareerOneStop API access; the credentials have not arrived yet. Option 2 was built in the same branch so it ships dark and activates the moment `COS_USER_ID`/`COS_API_TOKEN` are set:

- `src/lib/job-board/wv-employer.ts` — the "West Virginia Employer" label, `isWorkForceWvPosting()`, the badge text, and the plain-language MACC apply hint.
- `careeronestop.ts` — a dedicated WorkForce WV pass (`keyword=0`, `companyName=West Virginia Employer`, 50 rows) runs before the title passes and is additive to the 60-row cap, so MACC postings can never be crowded out.
- `JobCard.tsx` — badge plus hint on WorkForce WV postings, in both full and compact cards.
- `npm run cos:smoke` — two new job-board families: counts WorkForce WV postings for Charleston and follows one apply link to report whether it lands on `workforcewv.org`. Running it on day one settles the first two unverified points below.

## 7. Unverified points

- That the CareerOneStop API returns the company string exactly as "West Virginia Employer" and that its `URL` for those rows resolves into the MACC. Both are what the handout and CareerOneStop docs imply; both can only be confirmed with live credentials.
- NLx posting density for rural WV regions outside Charleston (the June spec's open risk, still open).
- Whether every SPOKES student is a WV Works participant subject to the MACC registration rule, or only a subset (affects option 3).

## 8. Decisions for Britt

- **D1.** Submit the CareerOneStop Jobs API (v2) access request now, framed as a nonprofit SPOKES job-search integration, and record the outcome in MEMORY.md. If refused, fall back to option 4 plus teaching MACC directly (macc.workforcewv.org/jobs, which has its own public search) and drop the NLx layer entirely.
- **D2.** Confirm with Sandra Adkins whether SPOKES students are required to register in the MACC (WV Works rule) and whether "West Virginia Employer" is WorkForce WV's anonymised label for staff-entered postings. Both answers shape options 2 and 3.
- **D3.** Whether the tracker gap (option 5) moves up from the #136 job-board bundle, given that MACC applications are the ones the program most wants to count.

## Sources

- NASWA, "What is the National Labor Exchange" and "NLx Services and Tools" (naswa.org/national-labor-exchange)
- usnlx.com "About Us" (partnership, daily counts, return-to-origin rule)
- CareerOneStop Web API: "List Jobs" v1 and v2 documentation and the "Jobs API Updates" notice (careeronestop.org/Developers/WebAPI)
- NLx Research Hub, "Request NLx Data" (eligibility and restrictions)
- WorkForce West Virginia, "Find a Job" and MACC public search (macc.workforcewv.org/jobs); "Work Search Activity & Acceptable Proof Guide", rev. 03/2026
- WV DHHR Income Maintenance Manual ch. 13.5 (WV Works work requirements, MACC registration)
- WVDE Adult Education employer recruitment page (WVAdultEd + MACC partnership)

---

# Part 2 — Is there a better way? (research pass, 2026-09-04 evening)

Britt asked whether other tools, workflows, or integrations would give a similar or better experience than the NLx → CareerOneStop path. Four parallel research tracks: job-posting data sources, platforms and workflows used by other TANF/workforce programs plus the placement evidence base, AI-first job-search products, and West Virginia's own state systems. Claims below were verified on the source's own page unless marked otherwise; the per-track reports with URLs are summarised here.

## The finding that reorders everything

**Rigorous evaluations of TANF employment programs find that more self-directed job search does not raise employment.** OPRE's Job Search Assistance study (NYC, Sacramento, Michigan) found no detectable effect at six months from stricter search requirements or goal-coaching. What does move placement, per MDRC's synthesis and trials: a person or program brokering the job (job developers, employer intermediaries), subsidized employment slots (LA paid work experience, +4 points employment), and sector pipelines with employer ties (WorkAdvance +14% earnings at two years, Per Scholas +14% at year seven). One cheap exception has RCT evidence: weekly SMS reminders during job search (Harvard People Lab / LA WorkSource) made participants 20% more likely to report employment.

So a better job *board* is a modest gain. A better *brokering workflow* is the real gain, and West Virginia already has the levers:

- **WV Works pays employers to hire SPOKES graduates.** The Employment Incentive Program (EIP) reimburses 50% of starting wage for 200–600 hours; the subsidized employment program (ESP) reimburses up to 100% for six months. Both are triggered only by the student's WV Works case manager. The SPOKES Work Verification Plan already says each program's Job Coach "works closely with the WDBs and with local Job Service to find employment for the participants as they finish". Nothing in VisionQuest supports that hand-off today.
- **WorkForce WV business services** will post job orders, pre-screen, and refer candidates for an employer; the statewide number is 1-800-252-JOBS. Jobs & Hope WV (recovery population) shows the model at full strength: named placement staff plus up to $20,000 wage reimbursement, and WV Adult Education is a listed partner.
- **SPOKES funding is under live review.** DoHS told WVDE in July 2026 to run SPOKES on unexpended FY26 TANF while the FY27 review is pending, amid a projected WV Works deficit. Placement-outcome evidence is the most valuable thing VisionQuest can produce this year.

## Data sources: the verdict holds, with one addition

- **CareerOneStop/NLx stays first.** MACC, jobs.wv.gov (run by Jobcase), and CareerOneStop all draw on the same NLx-vetted pool, so this credential is the WV-local lever, not "one more aggregator".
- **Add Talroo** as the hourly/frontline backfill: publisher API, free (Talroo pays a per-click fee), zip + radius + commute-time filters, pay data. Clicks must route through Talroo's tracking URL, which fits the link-out model. Talent.com and Careerjet are similar second-tier options.
- **Dead ends, verified:** Indeed (publisher API retired 2023, XML feeds cut March 2026), ZipRecruiter (publisher API ended March 2025), LinkedIn, Glassdoor, SimplyHired (no third-party search API); Jooble (500 requests per key, lifetime); Craigslist (terms forbid it with per-day penalties); NLx Research Hub (research-only); Snagajob and Facebook Jobs (real hourly jobs, no publisher feed, so link-outs only).
- **Compliance flag on an existing adapter:** Adzuna's developer terms allow organisational use only under a 14-day trial then a licence, require the "Jobs by Adzuna" logo, and cap free use at 250 calls/day. The current adapter may be outside those terms; one email to Adzuna citing nonprofit use settles it.
- **AEMIS is a legacy name.** WV adult education's live system is LACES (LiteracyPro), and the WIOA plan says it shares participant activities with the MACC in real time. Whether an instructor can *see* a student's MACC applications through it is unverified; Nick Northup (WVDE data coordinator) is the person to ask. Employment outcomes for federal reporting come from UI wage-record matching, not from the MACC.

## AI-first experiences: what to borrow, what to refuse

The best current products (Indeed Career Scout, ChatGPT's job search, LinkedIn's natural-language search) all stop at the same boundary VisionQuest already enforces: search, explain fit, then hand off to apply on the source site. Auto-apply tools (LazyApply, Sonara) show 1–6% response rates, trigger platform bans and CAPTCHAs, and sit under active litigation (Mobley v. Workday). Trackers like Huntr and Teal add a second pipeline, the exact problem VQ-R-017 already names. Google Cloud Talent Solution offers transit-mode commute search, but WV bus data exists only for Charleston (KRT) and Morgantown, so "on a bus line" must degrade to distance plus a question. No commercial product rewrites postings to grade 6 or handles the benefits cliff; both are within reach here (PolicyEngine CliffWatch is open source; WV SNAP uses 200% FPL under BBCE).

## Recommendation, in order

1. **Finish CareerOneStop; add Talroo.** Data supply is solved with those two. (Owner action, then one adapter.)
2. **Build the brokering loop, not a better search.** An `Employer`/`JobLead` pipeline inside VisionQuest (keeps one RLS/FERPA story; Salesforce's free nonprofit seats only if instructors refuse an in-app UI), a per-class job-developer view, and an exit confirm-card that packages the graduate's résumé and an EIP/ESP subsidy pitch for the WV Works case manager and the WorkForce WV business services rep.
3. **SMS nudges through the existing Twilio path.** Opt-in weekly "2 new day-shift jobs near you, reply Y" plus "did you hear back?" prompts that write to the tracker. The one intervention here with RCT evidence, and the cheapest.
4. **Sage job search, designed for this audience.** A read-only `search_jobs` tool returning at most three jobs filtered by distance, availability grid, and pay floor; an `explain_job` tool that rewrites a posting at grade 6 in a fixed template with a read-aloud button; one next step per screen; a benefits check that always says "check with your worker" and notifies the instructor.
5. **Placement-outcome reporting matched to what DoHS is reviewing.** Ask WVDE for the exact SPOKES statistical-report fields and emit them from `SpokesRecord` and the placement bridge.
6. **Do not build:** auto-apply or headless form submission; Indeed/LinkedIn scraping or account automation; a second application tracker; any employer-facing AI ranking score; a benefits number without a human-worker caveat.

## Asks of the state, in priority order

1. Sandra Adkins / Christina Harper (WVDE): the SPOKES statistical-report fields DoHS is using in the FY27 review.
2. Nick Northup (WVDE data): a spec of the LACES ↔ MACC interface — which MACC fields reach LACES, and whether a per-student export exists.
3. WorkForce WV: can SPOKES instructors hold "Staff Member" or partner MACC accounts to see and enter referrals?
4. WorkForce WV business services: a standing referral arrangement for graduate résumés and a recurring hiring event per class.
5. DoHS via Sandra: an EIP/ESP referral protocol at SPOKES exit, one form the instructor triggers to the case manager.
