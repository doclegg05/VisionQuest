# What Other Organizations Do: AI + Student/Client PII (2026 Survey)

Research date: 2026-09-06. Compiled from public web sources; URLs and short quotes included per section. Distinguishes **documented fact** (D) from **inference/synthesis** (I).

---

## 1. Universities — contracted enterprise tools + data classification tiers

The dominant pattern across essentially every university surveyed: **a tiered data-classification scheme (public/low → internal/moderate → confidential/restricted/high) maps directly to a short allowlist of AI tools, and unsupported "consumer" AI accounts are explicitly forbidden for FERPA-covered education records.**

- **University of Michigan** — U-M has four data sensitivity tiers (Low, Moderate, High, Restricted). U-M GPT, U-M Maizey, and the U-M GPT Toolkit (built on Azure OpenAI) are approved up to **Moderate** sensitivity, which includes FERPA data; Michigan Medicine's instance is also cleared for ePHI. "All data shared with U-M's AI services is private and will not be used to train AI models." (D)
  - https://safecomputing.umich.edu/protect-the-u/safely-use-sensitive-data/AI-and-UM-Data
  - https://er.educause.edu/articles/2024/2/how-and-why-the-university-of-michigan-built-its-own-closed-generative-ai-tools

- **Arizona State University** — First OpenAI university partnership (Feb 2024, ChatGPT Enterprise), expanded to ChatGPT Edu with GPT-5 for every student/faculty/staff at no cost. Status evolved: initially ChatGPT Enterprise was *not* approved for FERPA data under ASU's own proposal guidelines; ChatGPT Edu is now stated as approved for "ASU non-regulated, internal, and FERPA-protected data," with student conversations "never used to train OpenAI's models." (D)
  - https://ai.asu.edu/chatgpt-edu ; https://www.insidehighered.com/news/tech-innovation/artificial-intelligence/2024/05/21/unpacking-asus-openai-partnership-and

- **California State University system** — Partnered with OpenAI (announced Feb 4, 2025) to give **460,000+ students and 63,000+ staff/faculty** ChatGPT Edu access — "the largest implementation of ChatGPT by any single organization ... anywhere in the world" (OpenAI). Enterprise protections: SAML SSO, domain verification, custom retention windows, SOC 2 Type 2, encryption at rest/in transit; OpenAI does not train on CSU workspace data. Notably, **adoption outran governance**: a joint legislative hearing found CSU campuses "adopted AI tools without consistent guidance or training," and students reported preferring the free consumer ChatGPT over the sanctioned Edu tool out of fear their activity was monitored — a real-world instance of policy/behavior gap. (D)
  - https://calmatters.org/education/2026/05/california-state-university-open-ai-chatgpt-contract/
  - https://genai.calstate.edu/ai-tools

- **Harvard (HUIT AI Sandbox)** — Harvard has numbered data classification levels; both the HUIT AI Sandbox and ChatGPT Edu are approved for **Level 3** data. "Any data entered into a GAI tool may not exceed the approved data classification level for that tool." Chat data lives in a HUIT-managed database; vendors "do not store any user input or generated responses" and don't train on it. (D)
  - https://www.huit.harvard.edu/ai-sandbox-privacy

- **Stanford** — Third-party consumer tools (ChatGPT, Claude) are "low risk data only, ... avoid inputting materials containing students' personal information." Stanford's own AI Playground + Google Gemini + NotebookLM are approved for low/moderate risk; AI Playground alone is cleared for high-risk data. As of June 30, 2026 all Stanford affiliates got ChatGPT Edu. (D)
  - https://uit.stanford.edu/news/new-ai-tools-stanford-arrive-june-30

- **University of Florida (NaviGator)** — UF built its *own* AI platform on its HiPerGator supercomputer specifically because of "student records under FERPA, clinical data, unpublished research, export-controlled work." Every one of NaviGator's ~104 models "carries a tag saying which classes of data it's allowed to receive." This is the clearest documented example of **per-model data-classification tagging** as an architectural pattern, not just a policy document. (D)
  - https://aiadopters.club/p/how-a-university-made-ai-safe
  - https://ai.ufl.edu/guidelines/

- **University of California system-wide** — Explicit numeric risk tiers: institutional data may go into generative AI tools only if classified **Minimal Risk (P1) or Low Risk (P2)**; FERPA-protected student records and P3/P4 (moderate/high risk) data are prohibited from generative AI without prior security/privacy review. (D)
  - https://ai.universityofcalifornia.edu/governance-transparency/applicable-law-and-policy.html

- **University of Wisconsin–Madison, University of Chicago, Georgia State, U Penn, others** — Same shape repeated: "Sharing sensitive, restricted, or otherwise protected institutional data, including that covered by FERPA, with generative AI tools is prohibited under UW–Madison policy unless the tool has undergone appropriate review." U Chicago: "confidential data with publicly available generative AI tools is prohibited ... without prior security and privacy review, including FERPA-covered student data." (D)
  - https://registrar.wisc.edu/ferpa-and-artificial-intelligence-ai/
  - https://genai.uchicago.edu/about/generative-ai-guidance

- **The FERPA mechanism, stated plainly by a legal/compliance summary**: "ChatGPT Free, Plus, and Pro consumer accounts cannot satisfy school-official requirements because they have no written contract restricting data use, no direct-control commitment, and no FERPA-aligned terms. FERPA-protected education records cannot be sent to ChatGPT, Claude, or Gemini without either prior written consent ... or a properly documented 'school official' designation under 34 CFR § 99.31(a)(1)." This is the legal hook institutions use to justify contracted-Enterprise-only rules. (D, secondary legal-explainer source, cites the regulation directly)
  - https://sonomos.ai/blog/ferpa-ai-chatgpt-claude-schools-edtech-2026/

**Common pattern across all of the above (I, synthesized from the above facts):**
1. A data classification scheme (public/internal/confidential/restricted, or numbered P1–P4/Level 1–4) predates and is reused for AI governance rather than invented for it.
2. FERPA-covered student records sit at the second-highest or highest tier, never the lowest.
3. Exactly one class of tool is cleared for that tier: an **institutionally contracted** enterprise product (ChatGPT Edu/Enterprise, Azure OpenAI-backed in-house app, Gemini for Education/Workspace) with a signed data-processing agreement stating no training on institutional data and defined retention.
4. Free/personal/consumer accounts of the *same underlying model* are explicitly banned for that data even when the enterprise tier is allowed, because the contract — not the model — is what confers the FERPA "school official" exception.

---

## 2. K-12 and state guidance, federal guidance, and trust frameworks

- **West Virginia Department of Education** has issued its own guidance since May 2024, now at **version 1.2** (per WVDE's site and eLearning/rural-ed coverage): "Guidance, Considerations, & Intentions for the Use of Artificial Intelligence in West Virginia Schools." WV deliberately chose **checklist-style, non-mandatory guidance** over a strict policy, "in order to keep up with artificial software that's changing rapidly," with a companion Canvas resource hub. WV's state superintendent (Michele Blatt) testified to Congress that states need flexibility on AI, not federal mandates. WVDE is reported (2026) to be building "the nation's first comprehensive statewide framework" for AI in public schools, targeting rollout by the 2027-28 school year. **This is K-12 guidance; SPOKES (adult ed/workforce) is not covered by WVDE's K-12 framework, and no WV-specific adult-education or workforce AI guidance was found.** (D — WVDE guidance; I — SPOKES coverage gap is an absence-of-evidence inference, not a confirmed "no policy exists")
  - https://wvde.us/educator-staff-development/artificial-intelligence
  - https://wvde.us/media/1608/wvde-ai-guidance-12-march-2025pdf
  - https://eric.ed.gov/?id=ED655373

- **State department of education AI guidance is now near-universal.** As of 2026, at least 25 states' education departments have issued AI guidance that includes data-privacy provisions, per AI for Education's tracker: Alabama, Arizona, California, Colorado, Connecticut, Delaware, Georgia, Hawaii, Indiana, Kentucky, Louisiana, Minnesota, Mississippi, New Jersey, North Carolina, North Dakota, Ohio, Oklahoma, Oregon, Utah, Virginia, Washington, West Virginia, Wisconsin, Wyoming. North Carolina DPI's guidance explicitly names "data privacy and cybersecurity" as one of its five pillars (alongside leadership/vision, human capacity, curriculum/instruction, tech infrastructure). (D)
  - https://www.aiforeducation.io/ai-resources/state-ai-guidance
  - https://ballotpedia.org/AI_guidance_issued_by_state_departments_of_education

- **Federal — U.S. Dept. of Education**:
  - May 2023: OET report "Artificial Intelligence and the Future of Teaching and Learning" (Biden admin) — early risk framing, said to "build on prior accomplishments ... on student privacy and school data security." (D)
  - October 2024: follow-on toolkit, **"Empowering Education Leaders: A Toolkit for Safe, Ethical, and Equitable AI Integration"** — addresses "mitigating risks while safeguarding students' privacy, security and civil rights." This is the closest match to the "2024 developer guide" referenced in the task; note it's framed for K-12 *leaders*, not strictly "developers." (D)
    - https://www.ed.gov/about/news/press-release/us-department-of-education-releases-guidance-responsible-use-of-education-technology-classroom
  - **2025, new administration**: President Trump signed an Executive Order, **"Advancing Artificial Intelligence Education for American Youth,"** dated April 23, 2025. ED then issued a **Dear Colleague Letter (July 22, 2025)** from Secretary Linda McMahon setting out **five principles for federally-funded AI use in education: educator-led, ethical, accessible, transparent, and protective of student data.** The letter "encourages a focus on instructional value over recreational engagement" and requires districts using federal funds for AI to adhere to these principles, "particularly with regard to data privacy, accessibility, and stakeholder engagement." **This confirms the task's premise that both the EO and the Dear Colleague Letter exist and are real, dated 2025.** (D)
    - https://www.f3law.com/insights/fed-govt-provides-guidance-on-ai-funding/
    - https://www.aalrr.com/newsroom-alerts-4159

- **Student Privacy Pledge — retired.** The Future of Privacy Forum retired the decade-old Student Privacy Pledge (studentprivacypledge.org) on **April 25, 2025**, "in response to the changing technological and policy landscape regarding education technology." Vendors that cite the Pledge today (e.g., Brisk, below) are referencing a now-defunct certification; **1EdTech's TrustEd Apps program and Common Sense Privacy ratings are the live successors.** (D)
  - https://fpf.org/student-privacy-pledge/

- **CoSN** — publishes an annual National Student Data Privacy Report; the 2026 State of EdTech report specifically flags "a return to security and governance as priorities while districts grapple with integrating generative AI into everyday operations," and survey data shows **~20-24% of districts want a state-curated approved-AI-tool list**, mirroring the university allowlist pattern at the K-12 level. (D)
  - https://www.cosn.org/wp-content/uploads/2026/05/U.S.-State-of-EdTech-2026.pdf

---

## 3. Ed-tech products already coaching students on FERPA data

Common shape: **cloud-model backend (mostly OpenAI/Azure or Google), contractual no-training clause, and either full anonymization/pseudonymization of the input or a strict "no PII in prompt" architectural constraint.**

- **Khan Academy Khanmigo** — Built on **Azure OpenAI** (Microsoft donated infrastructure/compute in 2024). Khan Academy "does not allow OpenAI to train its LLMs on student or teacher data provided through the use of Khanmigo." Khan Academy: **"we anonymize all the information that is sent to their model."** For the lighter "Khanmigo Lite" tier, Khan states they don't even receive names/emails, and don't store those conversations. This is the clearest documented example in the survey of **pseudonymization/anonymization applied before the model call**, matching what the task asked to look for. (D)
  - https://support.khanacademy.org/hc/en-us/articles/22396485532173-Khanmigo-Lite-Privacy-Notice
  - https://publicservicesalliance.org/2025/10/22/student-data-privacy-and-security-khan-academys-khanmigo/

- **Google Gemini for Education** — Under Workspace for Education terms, contractually prohibits use of school data for model training or human review; holds a Common Sense Privacy Seal. Important documented caveat: **personal Google accounts do not carry these protections** — "if you write a prompt including any personally identifiable information about students [on a personal account], it keeps that data and is a possible FERPA violation" — same institutional-vs-consumer split as the university section. (D)
  - https://www.controlaltachieve.com/2025/08/gemini-data-privacy.html

- **Microsoft Copilot for Education** — Can operate under FERPA's "school official" exception for legitimate educational interest, but a documented operational tension exists: Copilot's core design (surfacing anything the signed-in user has access to via natural language) is described as "on a collision course with FERPA's fundamental requirement to restrict access to student education records to those with legitimate educational interest" — i.e., contractual compliance doesn't automatically prevent an access-control failure mode. Also generally not licensed for under-13 users (COPPA). (D)
  - https://e2eagenticbridge.com/blog/copilot-for-education-risks

- **MagicSchool AI** — SOC 2 certified, states FERPA/COPPA compliance. "MagicSchool does not allow any large language model provider, including OpenAI, to store or train on educator or student data, and its providers are contractually required to delete data immediately after processing and are prohibited from storing or using it to train their models." Retention: "only as long as necessary to provide its services or as required by law." (D)
  - https://www.magicschool.ai/privacy-security/student-data-policy

- **Brisk Teaching** — Holds "EdTech TrustED" certification (1EdTech's live program), is/was a signatory to the now-retired Student Data Privacy Pledge, states FERPA/COPPA compliance, and "does not train on user inputs." (D)
  - https://edtechindex.org/articles/magicschool-and-brisk-teaching-balancing-implementation-with-privacy

- **Instructure (Canvas) IgniteAI** — Ships "AI Nutrition Facts" labels per feature (transparency mechanism): "clearly listing which models are in use, what data is accessed and how privacy is protected." States "AI interactions occur securely within the institution's environment; data is not shared with OpenAI or other providers or used to train external models," with opt-in enablement at institution/department/course level. This "nutrition label" disclosure pattern is a notable transparency mechanism worth naming to Britt. (D)
  - https://www.instructure.com/press-release/instructure-launches-igniteai-simplify-and-seamlessly-transform-ai-integration

- **Coursera Coach** — Documented data flow is the *opposite* direction of most examples above: Coursera's privacy notice states it "may share course progress, completion status, and other analytics or usage information with OpenAI for purposes of monitoring the App's performance, evaluating course engagement, and improving integration between the App and ChatGPT" — i.e., some learner activity data flows *to* OpenAI as part of a ChatGPT-app integration, a different and more permissive posture than the K-12/higher-ed no-training contracts above. (D, but worth flagging as the outlier)
  - No dedicated public architecture doc found on Duolingo's model-vendor/pseudonymization practices in this pass; not confirmed either way — do not assert a specific practice for Duolingo.

---

## 4. Workforce / adult-education / public-benefits (WIOA, TANF, SNAP)

This is the most directly comparable sector to VisionQuest, and it is the **least mature** in publicly documented AI-specific data-privacy practice — most guidance so far is about AI *literacy training content*, not about routing case-management/PII data through AI models.

- **U.S. Department of Labor / ETA, TEGL 03-25 (August 2025)** — Directs states/local workforce boards to use **WIOA funding for AI literacy training** for youth, adults, dislocated workers — teaching *about* AI, not yet a data-handling standard for AI systems that touch participant records. Explicitly names WIOA's Adult and Dislocated Worker individualized career services as the vehicle. (D)
  - https://oecd.ai/en/dashboards/policy-initiatives/dol-ai-workforce-guidance-tegl-03-25
- **DOL AI Literacy Framework (Feb 2026)** — Broadened applicability to "state and local agencies (including WIOA grantees), education and training providers, employers, and individual workers," with "foundational content areas" and "delivery principles." Still a literacy/skills framework, **not a data-governance rule for case data**, per the sources found. (D)
  - https://www.dol.gov/newsroom/releases/eta/eta20260213
- **No DOL/ACF guidance specific to TANF or SNAP E&T AI-coaching data handling was found** in this pass. (I — absence of evidence, not evidence of absence)
- **Massachusetts** — announced (Feb 2026) a ChatGPT-powered AI assistant across the executive branch (which includes its workforce agency functions), explicitly "within a walled-off, secure environment that protects state data and ensures that employee chat inputs do not train public AI models" — the state-government analogue of the university enterprise-contract pattern, though this is described as employee-facing, not confirmed as touching case-participant PII. (D)
  - https://mass.gov/news/governor-healey-announces-massachusetts-to-become-first-state-to-deploy-chatgpt-across-executive-branch
- **USDA Food and Nutrition Service — "Framework for State, Local, Tribal, and Territorial Use of Artificial Intelligence for Public Benefit Administration."** This is a directly relevant federal framework for AI touching SNAP administration specifically; its existence was confirmed by search result title but its detailed contents were not fetched in this pass — **flagged as the single most relevant document to read in full before finalizing VisionQuest's approach**, since it is the one federal artifact naming SNAP + AI + governance together. (D — existence confirmed; content — not yet verified, recommend a follow-up fetch)
  - https://www.fns.usda.gov/framework-artificial-intelligence-public-benefit
- **Code for America × Anthropic — "SNAP Policy Navigator."** The most concrete, documented AI-coaching deployment touching a benefits program found in this survey. Key architectural/privacy choices, stated by Code for America: built on **MCP (Model Context Protocol)** for "secure, two-way connections between trusted data sources and AI applications"; "every response is grounded in verified federal, state, and county policies"; the tool answers **policy questions**, not individual eligibility determinations — "The user 'gets clarity on policy, not a decision on overall eligibility. The decision stays with [them].'" This is a **caseworker-facing tool answering policy questions from official documents**, deliberately not an end-client chatbot given access to a specific person's case file — a scope-limiting design choice directly relevant to how VisimQuest might further constrain what Sage can see/say. (D)
  - https://codeforamerica.org/news/anthropic-partnership/
  - https://www.edtechinnovationhub.com/news/code-for-america-and-anthropic-build-ai-tools-to-help-snap-caseworkers-process-benefits-faster
- **Benefits Data Trust × Nava Public Benefit Corp** (funded by Gates Foundation and Google.org) — exploring generative/predictive AI to support **benefit navigators** (caseworkers/community health workers), not a direct-to-client chatbot; framed around freeing up navigator time and reducing call-center load. No specific data-handling/model-vendor architecture was found publicly documented for this initiative in this pass. (D for the partnership's existence and framing; I/not found for specific privacy architecture)
  - https://www.navapbc.com/news/nava-ai-public-benefits
- **Jobs for the Future (JFF)** — runs a "Center for Artificial Intelligence & the Future of Work" and published "AI for Economic Opportunity and Advancement: A Call to Action" (2025); the search pass found general framing (bias/discrimination risk, safety/privacy for students named as a general concern) but no TANF/SNAP-E&T-specific privacy architecture recommendation. (D for report's existence; I for lack of TANF-specific privacy content — may exist in the full report, not surfaced by search snippets)
  - https://www.jff.org/work/jfflabs-artificial-intelligence/

**Synthesis for this sector (I):** Documented practice in the WIOA/TANF/SNAP space in 2026 is concentrated on (a) using program funds to teach AI *literacy* to participants, and (b) narrow, scope-limited, caseworker-facing tools that answer policy questions from official documents rather than touching an individual's own case record end-to-end. **VisionQuest's design — a student-facing AI coach with read/write access to the student's own record — does not have a close, well-documented peer in this specific sector**; it sits closer in shape to the higher-ed/K-12 AI-coaching pattern (Khanmigo, Copilot) than to anything found in workforce/TANF/SNAP practice.

---

## 5. Small nonprofits handling sensitive client data

- **TechSoup — "Benchmark Report: The State of AI in Nonprofits 2025."** Data privacy is the top cited barrier: **48% of nonprofits cite data privacy as a top challenge**, 41% cite limited in-house expertise. (D)
  - https://page.techsoup.org/ai-benchmark-report-2025
- **NTEN** — Runs an "AI for Nonprofits" resource hub and professional certificate covering "responsible AI policies" and "how privacy principles apply to AI," plus a six-month "Nonprofit Tech Readiness" cohort **sponsored by Anthropic**. NTEN functions as the closest thing to a small-nonprofit AI-privacy playbook publisher found in this survey, but no single downloadable "playbook" document with concrete technical controls (e.g., pseudonymization steps, model routing rules) was surfaced — its content is course/cohort-based rather than a static published standard. (D for program existence; I — no evidence of a specific prescriptive technical playbook document)
  - https://www.nten.org/learn/resource-hubs/artificial-intelligence
- **Fast Forward — "Playbook on AI for Humanity"** (2025) — covers "how nonprofits can build with AI responsibly, from aligning AI use with mission and values to practical applications," per its own framing; general responsible-AI-adoption guidance rather than a PII-routing technical spec. (D for existence; content not deeply verified)
  - https://www.ffwd.org/blog/the-playbook-on-ai-powered-nonprofits
- **Legal Services Corporation (LSC) / legal aid sector** — LSC's 2024-2025 Tech Summit report, "The Next Frontier: Harnessing Technology to Close the Justice Gap," names technology recommendations for legal aid; separately, the **ABA's Formal Opinion 512 (July 2024)** is the most concrete cross-sector-relevant guidance found: lawyers (a stand-in profession for any sensitive-data-handling advisor role) must "understand the capacity and limitations of AI," "know how AI uses data and put in place adequate safeguards," and specifically **understand whether an AI system is self-learning and will send confidential information as feedback to the system's database** — i.e., a professional-duty-level confirmation of "check whether your vendor trains on your input" as the load-bearing question, matching the university/ed-tech "no-training clause" pattern found everywhere else in this survey. Notably, the same source found that **79% of lawyers used AI in 2024 but only 10% of firms had a governing policy** — a stark adoption/governance gap, structurally similar to the CSU finding above (campuses adopted tools "without consistent guidance"). (D)
  - https://www.leanlaw.co/blog/what-are-the-data-privacy-implications-of-using-ai-tools-with-confidential-client-information/
- **Aspen Tech Policy Hub** — no specific nonprofit-AI-privacy playbook was surfaced in this search pass; not confirmed as having published one. (I — not found, do not assert)

---

## Synthesis

### The five things every serious institution documents doing
1. **Contracted enterprise terms, not consumer accounts, for any protected data.** Every university and ed-tech vendor surveyed draws this exact line — the same underlying model (GPT-4/5, Gemini) is fine under an enterprise/Edu contract with a signed no-training, defined-retention agreement, and prohibited under a free/personal account, because FERPA's "school official" exception is a contractual state, not a technical one (34 CFR § 99.31(a)(1)).
2. **A data-classification tier maps to an explicit allowed-tool list.** UC (P1–P4), Harvard (Level 1–4 with 3 as the AI ceiling), Michigan (Low/Moderate/High/Restricted, Moderate ceiling), Stanford (low/moderate/high risk) — the classification scheme is reused from existing security governance, not invented for AI, and the outcome is a short allowlist rather than a long banlist.
3. **An explicit, written ban on consumer AI tools for protected records** — stated in nearly every university policy in almost identical language, and echoed in the ABA's lawyer-facing guidance and the FERPA-legal-explainer sources.
4. **Human decision-authority is preserved** — the one concretely-documented workforce/benefits example (Code for America's SNAP Policy Navigator) is explicit that the tool gives "clarity on policy, not a decision on overall eligibility. The decision stays with [the caseworker]." This mirrors VisionQuest's own confirm-card / human-verification pattern already in place for goals, orientation, and certifications.
5. **Transparency/notice, though weakest in practice.** Instructure's per-feature "AI Nutrition Facts" label is the most concrete disclosure mechanism found. Federal K-12 guidance (the 2025 Dear Colleague Letter) explicitly names "transparent" as one of five required principles for AI paid for with federal education funds. But the CSU case shows a real gap between policy and behavior: students distrusted the sanctioned tool and used the unsanctioned one instead — notice alone did not build trust; it required visible, credible technical guarantees.

### Where VisionQuest sits relative to peers
VisionQuest's architecture — cloud (Gemini) for general chat, **local-only Ollama models for `student_record`/`staff_entered` data** — is, based on this survey, **stricter than the median documented institutional practice, and stricter than every ed-tech product surveyed except University of Florida's NaviGator.**
- No university surveyed keeps FERPA-tier data fully off any cloud vendor; all of them route it to a cloud vendor (OpenAI, Google, Microsoft) under a no-training contract. VisionQuest's local-only routing for student records is a stronger technical guarantee than a contractual one — it removes the vendor-trust question for that data class entirely rather than relying on a DPA.
- UF's NaviGator (self-hosted, per-model data tagging) is the closest documented peer in *architecture*, though NaviGator still appears to use hosted/institutional infrastructure rather than fully local inference per request.
- Khan Academy's "anonymize all information sent to their model" is the closest documented peer in *intent* (keep PII out of the cloud call) but achieves it via anonymization/pseudonymization rather than VisionQuest's routing-by-sensitivity-class approach — a technique VisionQuest does not currently use for the general-chat (cloud) path.
- No workforce/TANF/SNAP peer found in this survey implements anything as strict as VisionQuest's local-only rule for student records; the sector's practice (literacy training, caseworker-facing policy-only tools) hasn't yet produced a directly comparable student-facing case-record AI coach to benchmark against.

**Caveat already flagged in VisionQuest's own memory**: the fail-open behavior in `resolveAiProvider` (falls back to cloud when local is unavailable) is a real gap relative to this "local-only" claim and is exactly the kind of silent-policy-violation risk the CSU and ABA findings above warn about — a written rule with a real exception path is functionally a different rule.

### What peers do that VisionQuest could adopt cheaply
1. **A written, signed data-classification-to-tool mapping document** (even one page): "Student record / staff-entered data → local Ollama only. General chat / non-identifying career content → Gemini (cloud), under Google's [no-training terms for the applicable API tier — verify Gemini API/AI Studio vs. Vertex/Workspace terms, they differ]." This is the single cheapest, highest-value artifact — every peer surveyed has one, and VisionQuest's `.claude/rules/sage-ai.md` already encodes the routing rule in code/policy but likely doesn't exist as a student/staff/owner-facing disclosure document.
2. **A visible per-feature disclosure, Instructure's "AI Nutrition Facts" pattern** — a short "What Sage does with your data" surface (even a static page linked from the student `/memory` page VisionQuest already ships) naming: which parts of a conversation go where, whether it's used for training (no), and retention. Cheap because VisionQuest already has the `/memory` surface and the local/cloud routing to describe accurately.
3. **Close the fail-open gap or document it as an accepted, time-boxed risk with monitoring** — matching the "know whether your AI system is self-learning / sends data back" duty language in ABA Formal Op. 512, and matching CSU's cautionary tale that a policy nobody verifies in production becomes decorative.
4. **Borrow Code for America's scope discipline**: keep any tool that touches multi-student or program-wide data (vs. the student's own record) strictly to grounded, policy/document-citation answers rather than case-specific inference, the same "clarity on policy, not a decision" line SNAP Policy Navigator draws — directly applicable to VisionQuest's `search_jobs`/`explain_job` tools and to the teacher-facing Connect console.
5. **Read the USDA FNS "Framework for State, Local, Tribal, and Territorial Use of AI for Public Benefit Administration" in full** before finalizing anything — it is the one federal document found that names AI + SNAP + governance together, and SPOKES sits inside a SNAP E&T program context, so it may carry requirements more specific than anything else surveyed. (Flagged as a follow-up read, not yet fetched in full.)

---

## Sources index (all URLs cited above)
- https://safecomputing.umich.edu/protect-the-u/safely-use-sensitive-data/AI-and-UM-Data
- https://er.educause.edu/articles/2024/2/how-and-why-the-university-of-michigan-built-its-own-closed-generative-ai-tools
- https://ai.asu.edu/chatgpt-edu
- https://www.insidehighered.com/news/tech-innovation/artificial-intelligence/2024/05/21/unpacking-asus-openai-partnership-and
- https://calmatters.org/education/2026/05/california-state-university-open-ai-chatgpt-contract/
- https://genai.calstate.edu/ai-tools
- https://www.huit.harvard.edu/ai-sandbox-privacy
- https://uit.stanford.edu/news/new-ai-tools-stanford-arrive-june-30
- https://aiadopters.club/p/how-a-university-made-ai-safe
- https://ai.ufl.edu/guidelines/
- https://ai.universityofcalifornia.edu/governance-transparency/applicable-law-and-policy.html
- https://registrar.wisc.edu/ferpa-and-artificial-intelligence-ai/
- https://genai.uchicago.edu/about/generative-ai-guidance
- https://sonomos.ai/blog/ferpa-ai-chatgpt-claude-schools-edtech-2026/
- https://wvde.us/educator-staff-development/artificial-intelligence
- https://wvde.us/media/1608/wvde-ai-guidance-12-march-2025pdf
- https://eric.ed.gov/?id=ED655373
- https://www.aiforeducation.io/ai-resources/state-ai-guidance
- https://ballotpedia.org/AI_guidance_issued_by_state_departments_of_education
- https://www.ed.gov/about/news/press-release/us-department-of-education-releases-guidance-responsible-use-of-education-technology-classroom
- https://www.f3law.com/insights/fed-govt-provides-guidance-on-ai-funding/
- https://www.aalrr.com/newsroom-alerts-4159
- https://fpf.org/student-privacy-pledge/
- https://www.cosn.org/wp-content/uploads/2026/05/U.S.-State-of-EdTech-2026.pdf
- https://support.khanacademy.org/hc/en-us/articles/22396485532173-Khanmigo-Lite-Privacy-Notice
- https://publicservicesalliance.org/2025/10/22/student-data-privacy-and-security-khan-academys-khanmigo/
- https://www.controlaltachieve.com/2025/08/gemini-data-privacy.html
- https://e2eagenticbridge.com/blog/copilot-for-education-risks
- https://www.magicschool.ai/privacy-security/student-data-policy
- https://edtechindex.org/articles/magicschool-and-brisk-teaching-balancing-implementation-with-privacy
- https://www.instructure.com/press-release/instructure-launches-igniteai-simplify-and-seamlessly-transform-ai-integration
- https://oecd.ai/en/dashboards/policy-initiatives/dol-ai-workforce-guidance-tegl-03-25
- https://www.dol.gov/newsroom/releases/eta/eta20260213
- https://mass.gov/news/governor-healey-announces-massachusetts-to-become-first-state-to-deploy-chatgpt-across-executive-branch
- https://www.fns.usda.gov/framework-artificial-intelligence-public-benefit
- https://codeforamerica.org/news/anthropic-partnership/
- https://www.edtechinnovationhub.com/news/code-for-america-and-anthropic-build-ai-tools-to-help-snap-caseworkers-process-benefits-faster
- https://www.navapbc.com/news/nava-ai-public-benefits
- https://www.jff.org/work/jfflabs-artificial-intelligence/
- https://page.techsoup.org/ai-benchmark-report-2025
- https://www.nten.org/learn/resource-hubs/artificial-intelligence
- https://www.ffwd.org/blog/the-playbook-on-ai-powered-nonprofits
- https://www.leanlaw.co/blog/what-are-the-data-privacy-implications-of-using-ai-tools-with-confidential-client-information/
