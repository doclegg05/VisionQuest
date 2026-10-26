# VisionQuest — Legal Framework for Cloud AI Processing of SPOKES Student Data

**Research date:** 2026-09-06. **Author:** research pass, not legal advice.
**Evidence discipline:** every claim below is tagged **[STATUTE]**, **[REGULATION]**, **[GUIDANCE]** (agency
sub-regulatory material — persuasive, not binding), **[FACT]** (verifiable non-legal fact), or **[INFERENCE]**
(my reasoning, which a lawyer must confirm). Items I could not verify are marked **[UNVERIFIED]**.

**Bottom line up front:** Nothing in FERPA prohibits sending student education records to a cloud AI vendor.
FERPA *conditions* it. The conditions are satisfiable by contract, and the Department of Education has said so
repeatedly and recently. The two things most likely to actually sink VisionQuest are (1) using the **free/unpaid
tier** of the Gemini API, whose terms expressly permit Google to train on submitted content and let human
reviewers read it, and (2) a **West Virginia statute that appears to prohibit schools from collecting data
through "affective computing"** — which is a plausible description of mood check-ins and crisis flags. Neither
is a FERPA problem. Both are more concrete than the FERPA question everyone worries about.

---

## 1. Does FERPA apply to SPOKES at all?

### 1.1 The statutory/regulatory test

FERPA applies to an "educational agency or institution." **[REGULATION]** 34 CFR 99.1(a):

> "Except as otherwise noted in § 99.10, this part applies to an educational agency or institution to which
> funds have been made available under any program administered by the Secretary, if— (1) The educational
> institution provides educational services or instruction, or both, to students; or (2) The educational agency
> is authorized to direct and control public elementary or secondary, or postsecondary educational
> institutions."
> — https://www.ecfr.gov/current/title-34/subtitle-A/part-99/subpart-A/section-99.1

"Funds made available" includes subgrants and subcontracts. **[REGULATION]** 34 CFR 99.1(c)(1): funds are made
available if they "are provided to the agency or institution by grant, cooperative agreement, contract,
subgrant, or subcontract."

**[FACT]** AEFLA (WIOA Title II) is administered by the Secretary of Education. **[FACT]** SPOKES is delivered
under contract between the WVDE Office of Adult Education and WV DHHR/DoHS, through regional educational
cooperatives and county adult education programs
(https://www.epicresa8.org/spokes; http://www.wvadulted.org/spokes.html).

### 1.2 The Department's own answer — this is the key source

ED and DOL jointly published **"Joint Guidance on Data Matching to Facilitate WIOA Performance Reporting and
Evaluation"** (70 pp.), which contains the only on-point federal analysis of FERPA's application to AEFLA
providers I could locate. **[GUIDANCE]**
— https://rsa.ed.gov/sites/default/files/subregulatory/final-ferpa-tegl-report.pdf

The operative passage (p. 15) **splits the answer by provider type**:

> "LEAs and postsecondary institutions providing AEFLA adult education and literacy services are generally
> considered to be educational agencies or institutions subject to FERPA as most are recipients of Federal funds
> under a program administered by the Secretary of Education. However, non-educational eligible providers
> delivering AEFLA adult education and literacy services, such as community- or faith-based organizations,
> volunteer organizations, public or private nonprofit agencies, libraries, public housing authorities, and
> other nonprofit entities, typically would not be considered to be entities covered by FERPA. Although these
> non-educational entities receive Federal funds under a program administered by the Secretary of Education to
> provide AEFLA services, they do not typically meet the definition of an educational agency or institution
> and, therefore, FERPA does not directly apply to such eligible providers."

And on whether the *records* are education records (p. 16):

> "If an eligible provider is an educational agency or institution and eligible individuals are students in
> attendance at the educational agency or institution, the records of the participants would be education
> records subject to FERPA."

Critically, **FERPA follows the data even when it does not follow the entity** (p. 15):

> "While FERPA does not directly apply to these eligible providers, FERPA's 'redisclosure' provisions at 34 CFR
> 99.33 would apply when the non-educational eligible providers have been provided PII from education records
> that was originally maintained by an educational agency or institution without the parent's or eligible
> student's prior written consent."

Note also that FERPA's own definitions already contemplate this sector. **[REGULATION]** 34 CFR 99.3,
"Education program":

> "any program that is principally engaged in the provision of education, including, but not limited to, early
> childhood education, elementary and secondary education, postsecondary education, special education, job
> training, career and technical education, and adult education."

### 1.3 Reasoning it through for VisionQuest

**[INFERENCE]** The chain is:

1. Is the specific SPOKES provider a county board of education, a public school system adult-ed program, a RESA
   /educational cooperative, or a community/technical college? → FERPA very likely applies directly. Is it a
   free-standing community-based nonprofit? → FERPA likely does **not** apply directly to it, but 34 CFR 99.33
   redisclosure limits still bind any education-record PII it received from an LEA/college.
2. Because SPOKES is delivered through **WVDE Office of Adult Education** and regional educational cooperatives,
   the "educational agency or institution" branch is the more probable answer for most sites — but this is
   **provider-by-provider**, not program-wide.
3. If FERPA applies, VisionQuest's database is squarely within the definition. **[REGULATION]** 34 CFR 99.3,
   "Education records" means records "(1) Directly related to a student; and (2) Maintained by an educational
   agency or institution **or by a party acting for the agency or institution**." A vendor holding the records
   is inside the definition, not outside it. PTAC says so explicitly **[GUIDANCE]**: "any of these records
   maintained by a third party acting on behalf of a school or district are also considered education records"
   (PTAC Vendor FAQ, Aug 2015, p. 1,
   https://studentprivacy.ed.gov/sites/default/files/resource_document/file/Vendor%20FAQ.pdf).
4. Because SPOKES students are adults, **all FERPA rights are the students' own**. **[REGULATION]** 34 CFR
   99.3: "Eligible student means a student who has reached 18 years of age or is attending an institution of
   postsecondary education." 34 CFR 99.5(a)(1): "When a student becomes an eligible student, the rights
   accorded to, and consent required of, parents under this part transfer from the parents to the student."
   This materially simplifies the consent route (§7 below) and removes PPRA and COPPA from the picture.

### 1.4 What a lawyer must confirm

- **The legal identity of each SPOKES delivery site** and whether ED funds flow to it by grant/subgrant/contract.
  This single fact decides direct FERPA coverage. **[UNVERIFIED]** — cannot be determined from public sources.
- Whether students are "in attendance" at that entity within 34 CFR 99.3 (the joint guidance makes attendance a
  separate, load-bearing condition).
- Whether the WVDE–DoHS SPOKES contract itself imposes FERPA-equivalent terms by its own force, which would
  moot the coverage question. **[UNVERIFIED]** — contract not public.
- Note that even where FERPA does not attach, **the TANF/SNAP/state-law regimes in §4 and §6 still do**, and for
  this population they are arguably the sharper constraint.

---

## 2. The "school official" exception, cloud vendors, and generative AI

### 2.1 The rule

Consent is the default. **[REGULATION]** 34 CFR 99.30(a): "The parent or eligible student shall provide a signed
and dated written consent before an educational agency or institution discloses personally identifiable
information from the student's education records, except as provided in § 99.31."

The contractor exception, verbatim. **[REGULATION]** 34 CFR 99.31(a)(1)(i)(B):

> "A contractor, consultant, volunteer, or other party to whom an agency or institution has outsourced
> institutional services or functions may be considered a school official under this paragraph provided that the
> outside party— (1) Performs an institutional service or function for which the agency or institution would
> otherwise use employees; (2) Is under the direct control of the agency or institution with respect to the use
> and maintenance of education records; and (3) Is subject to the requirements of § 99.33(a) governing the use
> and redisclosure of personally identifiable information from education records."

The redisclosure/use limitation it incorporates. **[REGULATION]** 34 CFR 99.33(a):

> "(1) An educational agency or institution may disclose personally identifiable information from an education
> record only on the condition that the party to whom the information is disclosed will not disclose the
> information to any other party without the prior consent of the parent or eligible student. (2) The officers,
> employees, and agents of a party that receives information under paragraph (a)(1) of this section may use the
> information, but only for the purposes for which the disclosure was made."

And the school must *tell* the vendor this. **[REGULATION]** 34 CFR 99.33(d): "An educational agency or
institution must inform a party to whom disclosure is made of the requirements of paragraph (a) of this section."

A fourth condition comes from the annual-notice rule, and it is the one most often missed. **[REGULATION]** 34
CFR 99.7(a)(3)(iii): the annual notification must include "If the educational agency or institution has a policy
of disclosing education records under § 99.31(a)(1), a specification of criteria for determining who constitutes
a school official and what constitutes a legitimate educational interest."

Access control is also mandatory. **[REGULATION]** 34 CFR 99.31(a)(1)(ii): "An educational agency or institution
must use reasonable methods to ensure that school officials obtain access to only those education records in
which they have legitimate educational interests."

### 2.2 PTAC on cloud/online service providers

PTAC's **"Protecting Student Privacy While Using Online Educational Services: Requirements and Best Practices"**
(February 2014) is the controlling ED guidance for exactly this fact pattern. **[GUIDANCE]**
— https://studentprivacy.ed.gov/sites/default/files/resource_document/file/Student%20Privacy%20and%20Online%20Educational%20Services%20(February%202014)_0.pdf

Its four-element restatement (p. 4):

> "Under the school official exception, schools and districts may disclose PII from students' education records
> to a provider as long as the provider: 1. Performs an institutional service or function for which the school
> or district would otherwise use its own employees; 2. Has been determined to meet the criteria set forth in
> the school's or district's annual notification of FERPA rights for being a school official with a legitimate
> educational interest in the education records; 3. Is under the direct control of the school or district with
> regard to the use and maintenance of education records; and 4. Uses education records only for authorized
> purposes and may not re-disclose PII from education records to other parties (unless the provider has specific
> authorization from the school or district to do so and it is otherwise permitted by FERPA)."

**No written contract is technically required** — this surprises people (p. 4):

> "While FERPA regulations do not require a written agreement for use in disclosures under the school official
> exception, in practice, schools and districts wishing to outsource services will usually be able to establish
> direct control through a contract signed by both the school or district and the provider."

Use limitation, stated as plainly as it gets (p. 5):

> "Any PII from students' education records that the provider receives under FERPA's school official exception
> may only be used for the specific purpose for which it was disclosed... Further, under FERPA's school official
> exception, the provider may not share (or sell) FERPA-protected information, or re-use it for any other
> purposes, except as directed by the school or district and as permitted by FERPA."

Student access must survive the outsourcing (p. 5):

> "Whenever a provider maintains a student's education records, the school and district must be able to provide
> the requesting parent (or eligible student) with access to those records."

PTAC's parallel **Vendor FAQ** (Aug 2015) restates the same four conditions for the vendor's own audience and
adds a data-mining caution **[GUIDANCE]**:

> "While data mining or scanning may sometimes be a necessary component of online services (e.g., for malware or
> spam detection or for personalization tools), mining or scanning for other purposes (e.g., targeted
> advertising directed to students or their parents) will likely violate federal or state privacy laws."

### 2.3 Generative AI specifically (2023–2026)

**[GUIDANCE]** **ED "Designing for Education with Artificial Intelligence: An Essential Guide for Developers"**
(Office of Educational Technology, July 2024). Its privacy chapter's framing is notable for what it does *not*
say — it announces no new AI-specific privacy rule:

> "Privacy and data security are the aspects of edtech where the strongest guidelines and guardrails already
> exist. Most participants in the edtech marketplace have been actively addressing privacy and cybersecurity for
> many years before generative AI became widely available and will continue to require strong safeguards."

> "SPPO resources include information on the Family Educational Rights and Privacy Act (FERPA) and the
> Protection of Pupil Rights Amendment (PPRA), which apply to educational agencies and institutions receiving
> Department funds... Developers must know these laws."
> — https://files.eric.ed.gov/fulltext/ED661949.pdf (ERIC ED661949)

**[FACT/UNVERIFIED]** This guide was published by ED's Office of Educational Technology, which was eliminated in
the 2025 Department reorganization. The ERIC copy above is stable; whether the document remains ED's operative
position, or is still hosted on tech.ed.gov, I could not confirm. Treat it as persuasive-but-possibly-orphaned.

**[GUIDANCE]** **Dear Colleague Letter, "Guidance on the Use of Federal Grant Funds to Improve Education
Outcomes Using Artificial Intelligence," Secretary Linda E. McMahon, July 22, 2025.** This is the most recent
Department-level AI statement and it is *permissive*:
— https://www.ed.gov/media/document/opepd-ai-dear-colleague-letter-7222025-110427.pdf

> "This guidance outlines how AI may be used across key educational functions and affirms that such uses are
> allowable under existing federal education programs, provided they align with applicable statutory and
> regulatory requirements."

It names VisionQuest's exact use case as a fundable category:

> "3. AI for College and Career Pathway Exploration, Advising, and Navigation — Funds may also be directed
> toward: Platforms that leverage AI to help students identify career interests, explore pathways, and make
> informed choices. Virtual advising systems that guide students through course planning, financial aid, and
> transitions to postsecondary education or careers."

And its privacy principle is a single sentence with no AI-specific carve-out:

> "Data-protective: Systems must comply with federal privacy laws including the Family Educational Rights and
> Privacy Act."

**[UNVERIFIED]** I searched studentprivacy.ed.gov for a dedicated PTAC AI FAQ or AI-specific FERPA guidance
document and **found none**. The site search returned no AI-specific guidance; the only AI artifact located was a
PTAC training scenario deck, "AI Tutoring Platform Data Leak"
(https://studentprivacy.ed.gov/sites/default/files/resource_document/file/AI_Tutoring_Platform_Data_Leak_Final_508.pptx),
which is a tabletop exercise, not guidance. **If someone tells you PTAC has issued binding AI rules, ask for the
citation.** As of this research date I could not find one.

### 2.4 Direct answer to the question asked

**Is there anything in FERPA that prohibits sending education records to a cloud AI vendor under a proper
contract? No.** **[INFERENCE, well supported]** FERPA is a disclosure-consent statute, not a technology statute.
It contains no prohibition on cloud hosting, no data-locality rule, no model-architecture rule, and no mention
of AI. A generative-AI coach is an "institutional service or function for which the agency or institution would
otherwise use employees" — advising and coaching are indisputably such functions, and the July 2025 DCL names
"virtual advising systems" as an allowable use of federal education funds. The gating questions are contractual
and organizational, not technical.

**The one AI-specific FERPA landmine is training.** **[INFERENCE]** If the vendor uses education-record content
to train or improve its models, that is a use "for [a purpose] other than the purpose for which it was
disclosed," which 34 CFR 99.33(a)(2) forbids and which breaks the 99.31(a)(1)(i)(B)(3) condition. It may also be
an unauthorized redisclosure. This is not a novel AI doctrine — it is the ordinary use-limitation rule applied
to a new use.

**This is where VisionQuest has a concrete, verifiable exposure.** **[FACT]** Google's Gemini API Additional
Terms of Service (https://ai.google.dev/gemini-api/terms) draw a hard line between tiers:

- **Unpaid Services:** "Google uses the content you submit to the Services and any generated responses to
  provide, improve, and develop Google products and services"; "human reviewers may read, annotate, and process
  your API input and output"; and, explicitly, **"Do not submit sensitive, confidential, or personal information
  to the Unpaid Services."**
- **Paid Services:** "Google doesn't use your prompts or responses to improve our products," with logging "for a
  limited period of time, solely for detecting and preventing violations."

**[INFERENCE]** Running SPOKES student chat transcripts through the **free tier** would violate the school-official
use limitation, would contradict Google's own express instruction not to submit personal information, and would
be very difficult to defend. Running them through the **paid tier** is consistent with the FERPA conditions,
assuming the rest of the checklist in §10 is met. **Confirm which tier the deployed `GEMINI_API_KEY` bills
against before anything else on this list.** This is the highest-value single action in this document.

---

## 3. De-identification — does stripping name/email/phone/DOB work?

### 3.1 The rule

**[REGULATION]** 34 CFR 99.31(b)(1):

> "An educational agency or institution, or a party that has received education records or information from
> education records under this part, may release the records or information without the consent required by
> § 99.30 after the removal of all personally identifiable information provided that the educational agency or
> institution or other party has made a reasonable determination that a student's identity is not personally
> identifiable, whether through single or multiple releases, and taking into account other reasonably available
> information."

But "personally identifiable information" is defined far more broadly than direct identifiers. **[REGULATION]**
34 CFR 99.3, PII "includes, but is not limited to":

> "(a) The student's name; (b) The name of the student's parent or other family members; (c) The address of the
> student or student's family; (d) A personal identifier, such as the student's social security number, student
> number, or biometric record; (e) Other indirect identifiers, such as the student's date of birth, place of
> birth, and mother's maiden name; **(f) Other information that, alone or in combination, is linked or linkable
> to a specific student that would allow a reasonable person in the school community, who does not have personal
> knowledge of the relevant circumstances, to identify the student with reasonable certainty**; or (g)
> Information requested by a person who the educational agency or institution reasonably believes knows the
> identity of the student to whom the education record relates."

### 3.2 PTAC's answer, which is unusually blunt

**[GUIDANCE]** PTAC, "Data De-identification: An Overview of Basic Terms" (Oct 2012, updated May 2013), p. 3
— https://studentprivacy.ed.gov/sites/default/files/resource_document/file/data_deidentification_terms_0.pdf

> "It is important to note that PII may include not only direct identifiers, such as names, student IDs or social
> security numbers, but also any other sensitive and non-sensitive information that, alone or combined with other
> information that is linked or linkable to a specific individual, would allow identification. Therefore, **simple
> removal of direct identifiers from the data to be released DOES NOT constitute adequate de-identification.**
> Properly performed de-identification involves removing or obscuring all identifiable information until all data
> that can lead to individual identification have been expunged or masked."

And on the standard to meet:

> "de-identification is considered successful when there is no reasonable basis to believe that the remaining
> information in the records can be used to identify an individual."

Plus a cumulative-risk requirement:

> "when making a determination as to whether the data have been sufficiently de-identified, it is necessary to
> take into consideration cumulative re-identification risk from all previous data releases and other reasonably
> available information."

### 3.3 Applied to a VisionQuest chat transcript

**Does stripping name/email/phone/DOB de-identify a chat transcript? No — not reliably, and not for this
population.** **[INFERENCE, high confidence]**

A SPOKES coaching transcript is close to a worst case for de-identification, because the *substance* of the
conversation is the identifier:

- **County** is in the SPOKES case data. West Virginia has 55 counties, several with populations under 10,000;
  a SPOKES cohort in one county is a handful of adults.
- The combination *(county + TANF recipient + specific employment barrier + occupational goal + cohort timing)*
  is very plausibly unique, and it is exactly the "alone or in combination... linked or linkable" catch-all in
  99.3(f), judged from the standpoint of "a reasonable person in the school community" — i.e. a SPOKES
  instructor, who would recognize a student from a two-line narrative.
- Free-text chat is self-identifying by nature: students narrate employer names, family circumstances, health
  events, criminal history, and their own names in passing. No redaction pass over free text is sound enough to
  support a "reasonable determination" under 99.31(b)(1).
- Résumés are, by design, dossiers of indirect identifiers.

**[INFERENCE]** Practical consequence: **do not build the compliance story on de-identification.** The
school-official route (§2) or consent (§7) is far more defensible than asserting that a redacted transcript is
no longer an education record. De-identification remains genuinely useful for *aggregate* analytics, benchmark
corpora, and metrics — and note that PTAC treats properly de-identified metadata as outside FERPA entirely:
"Metadata that have been stripped of all direct and indirect identifiers are not considered protected
information under FERPA because they are not PII" (PTAC Feb 2014, p. 3). But per-student transcripts sent to a
model are not that.

---

## 4. TANF and SNAP confidentiality

### 4.1 TANF — the surprise is how little federal law there is

**[STATUTE]** The federal TANF confidentiality requirement is a single clause, and it delegates to the state.
42 U.S.C. § 602(a)(1)(A)(iv) — the State plan must outline how the State intends to:

> "Take such reasonable steps as the State deems necessary to restrict the use and disclosure of information
> about individuals and families receiving assistance under the program attributable to funds provided by the
> Federal Government."
> — https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title42-section602&num=0&edition=prelim

**[REGULATION]** 45 CFR 205.50 is the older, far more prescriptive AFDC-era rule. It opens: "A State plan for
financial assistance under title IV-A of the Social Security Act, must provide that: (1) Pursuant to State
statute which imposes legal sanctions: (i) The use or disclosure of information concerning applicants and
recipients will be limited to purposes directly connected with: (A) The administration of the plan..."
— https://www.ecfr.gov/current/title-45/subtitle-B/chapter-II/part-205/section-205.50

Two provisions matter most here:

> "(a)(2)(i) Types of information to be safeguarded include but are not limited to: (A) The names and addresses
> of applicants and recipients and amounts of assistance provided...; (B) Information related to the social and
> economic conditions or circumstances of a particular individual...; (C) Agency evaluation of information about
> a particular individual; (D) Medical data, including diagnosis and past history of disease or disability,
> concerning a particular individual."

> "(a)(2)(ii) The release or use of information concerning individuals applying for or receiving financial
> assistance is restricted to persons or agency representatives who are **subject to standards of confidentiality
> which are comparable to those of the agency** administering the financial assistance programs."

**[UNVERIFIED — flag for counsel]** Whether 45 CFR 205.50 still binds **TANF** post-PRWORA is genuinely
contested. By its terms it governs "title IV-A" state plans, and TANF is title IV-A; but TANF's own regulations
sit at 45 CFR Parts 260–265, and the statutory scheme replaced the prescriptive AFDC state-plan model with the
"as the State deems necessary" delegation above. ACF's 2026 TANF NPRM is captioned as amending "45 CFR parts
205, 260, 261, and 263," which suggests ACF does regard Part 205 as live for TANF
(https://acf.gov/ofa/outreach-material/nprm-tanf-regulations-45-cfr-parts-205-260-261-and-263). **A lawyer must
resolve this.** Fortunately, for VisionQuest it may not matter much, because West Virginia has legislated
directly (§6.3) and the state rule is stricter and clearer than either federal candidate.

**Does "TANF recipient status" itself count as protected?** **[INFERENCE, high confidence] Yes.** Under 45 CFR
205.50(a)(2)(i)(A) the protected categories include "the names and addresses of applicants and recipients and
amounts of assistance provided" — the fact of recipiency is the protected fact, not merely the details. Under
West Virginia law the point is beyond argument: W. Va. Code §9-9-20(a) makes "all records and information of the
department regarding any beneficiary" confidential (§6.3), and W. Va. Code §18-2-5h(b)(11) independently
classifies "whether the person or their family are or were recipients of financial assistance from a state or
federal agency" as **"confidential student information"** (§6.1). Every VisionQuest student is a TANF or SNAP
recipient, so **the mere existence of a student record in this app encodes protected status.** That is a
meaningful architectural fact: the roster is sensitive even before any field is populated.

### 4.2 SNAP

**[REGULATION]** 7 CFR 272.1(c)(1): "Use or disclosure of information obtained from SNAP applicant or recipient
households shall be restricted to:" — followed by an exhaustive list of permitted purposes, all of which concern
program administration, enforcement, IEVS verification, immigration status verification, child support, audit,
law enforcement, and school meal certification.
— https://www.ecfr.gov/current/title-7/subtitle-B/chapter-II/subchapter-C/part-272/section-272.1

> "(c)(2) Recipients of information released under paragraph (c)(1) of this section must adequately protect the
> information against unauthorized disclosure to persons or for purposes not specified in this section."

**[INFERENCE]** 7 CFR 272.1(c) is a **closed list**, and "operating an AI coaching app" is not on it. The
defensible reading is that VisionQuest is acting as an agent of the administering agency/provider in
administering an employment-and-training program connected to the plan — i.e., it fits (c)(1)(i) "persons
directly connected with the administration... of other Federal assistance programs, federally-assisted State
programs providing assistance on a means-tested basis to low income individuals" — rather than that a new
disclosure purpose has been created. That characterization should be **stated in the contract**, not assumed.
Note the practical asymmetry with FERPA: SNAP's rule binds the *recipient* of the information directly
(272.1(c)(2)), so VisionQuest inherits the obligation by operation of regulation, not only by contract.

### 4.3 What this means structurally

**[INFERENCE]** The benefits-program regimes are **purpose-limitation** regimes, closely parallel to FERPA's
school-official use limitation. The same contract clause set satisfies all three. But note one divergence that
matters for AI: 45 CFR 205.50(a)(2)(ii) requires recipients to be "subject to standards of confidentiality which
are **comparable to those of the agency**." That is a stronger flow-down standard than FERPA's, and it is the
provision most likely to be read as reaching Google as a subprocessor.

---

## 5. WIOA participant data

**[REGULATION]** 20 CFR 683.220(a) is the WIOA PII rule:

> "Recipients and subrecipients of WIOA title I and Wagner-Peyser Act funds must have an internal control
> structure and written policies in place that provide safeguards to protect personally identifiable
> information, records, contracts, grant funds, equipment, sensitive information, tangible items, and other
> information that is readily or easily exchanged in the open market, or that the Department or the recipient or
> subrecipient considers to be sensitive, consistent with applicable Federal, State and local privacy and
> confidentiality laws."
> — https://www.ecfr.gov/current/title-20/chapter-V/part-683/subpart-B/section-683.220

**[INFERENCE — important scoping point]** By its own terms 683.220 applies to **"WIOA title I and Wagner-Peyser
Act funds."** SPOKES is **Title II (AEFLA)**, administered by ED, not DOL. So 20 CFR 683.220 does **not**
directly bind a Title II-funded SPOKES provider. The analogous obligations for a Title II grantee arrive through
EDGAR / 2 CFR Part 200 internal-controls requirements and through FERPA. People routinely cite 683.220 as "the
WIOA privacy rule" without noticing it is title-scoped; do not repeat that error in a compliance memo.

**[REGULATION]** 20 CFR Part 677 (performance accountability, including the individual-record reporting that
feeds PIRL) contains **no vendor or AI confidentiality provisions**. I read the whole part. The only privacy
language is 20 CFR 677.175(c), making the Governor's designated agency responsible for "(3) Protection against
disaggregation that would violate applicable privacy standards," and 677.235 on individual-record reporting for
**title I / Wagner-Peyser / title IV** programs.

**[GUIDANCE]** The ED/DOL joint guidance (§1.2) is the substantive WIOA-privacy document, and its subject is
wage-record matching, not vendors or AI. It contains **no** discussion of AI, cloud providers, or the school
official exception — I searched; the phrase "school official" does not appear in its 70 pages.

**[INFERENCE]** Net: WIOA adds little to VisionQuest's obligations beyond what FERPA and the benefits regimes
already impose. Its main relevance is that PIRL/state reporting creates *outbound* disclosure paths (provider →
WVDE → state UC agency) that need their own basis — the joint guidance's answer for AEFLA is consent (§7.2).

---

## 6. West Virginia state law

### 6.1 W. Va. Code §18-2-5h — Student Data Accessibility, Transparency and Accountability Act (SDATAA)

**[STATUTE]** Enacted 2014 (HB 4316), amended 2016 and 2017.
— https://code.wvlegislature.gov/18-2-5h/

**Scope.** The Act is built around the "**Student data system**," defined at §18-2-5h(b)(3) as "the West Virginia
Department of Education statewide longitudinal data system." Most of its duties run to the Department. But the
definition of "school district" is broader than it first appears — §18-2-5h(b)(9):

> "'School district' means a county board of education, the West Virginia Schools for the Deaf and Blind **and
> the West Virginia Department of Education with respect to the education programs under its jurisdiction that
> are not in the public schools**."

**[INFERENCE]** That final clause is a plausible hook for **WVDE-administered adult education**, which is
precisely an education program under WVDE's jurisdiction that is not in the public schools. Whether SDATAA
therefore reaches SPOKES is **[UNVERIFIED]** and is a real question for counsel — I found no case law, AG
opinion, or WVDE interpretation resolving it. Do not assume SDATAA is a K-12-only statute merely because it is
usually discussed that way.

**Three provisions that matter enormously if SDATAA does reach SPOKES:**

**(a) "Confidential student information" expressly covers this population's most sensitive fields.**
§18-2-5h(b)(11) defines it to include:

> "whether the person or a member of their household owns or possesses a firearm, whether the person or their
> family are or were **recipients of financial assistance from a state or federal agency**, **medical,
> psychological or behavioral diagnoses**, criminal history, criminal history of parents, siblings or any members
> of the person's household..."

And §18-2-5h(c)(9) directs the Department to "**Prohibit the collection of confidential student information** as
defined in subdivision ten of subsection (b) of this section."

**[INFERENCE — drafting defect]** Note the cross-reference is **wrong**: subdivision (b)(10) is "directory
information"; "confidential student information" is (b)(11). A court would very likely read this as a scrivener's
error and apply it to (11), but the ambiguity is real and worth flagging to counsel rather than papering over.

**(b) The affective-computing prohibition — the most significant WV finding in this report.**
§18-2-5h(b)(12) defines:

> "'Affective computing' means human-computer interaction in which the device has the ability to detect and
> appropriately respond to its user's emotions and other stimuli."

And §18-2-5h(e):

> "**Data Inventory -- School Responsibilities. -- Schools shall not collect the following individual student
> data:** (1) Political affiliation and beliefs; (2) Religion and religious beliefs and affiliations; **(3) Any
> data collected through affective computing;** (4) Any data concerning the sexual orientation or beliefs about
> sexual orientation of the student or any student's family member; and (5) Any data concerning firearm's
> ownership by any member of a student's family."

**[INFERENCE]** VisionQuest's **mood check-ins** and **crisis flags** are, on the statute's own definition, a
strong candidate for "data collected through affective computing": an AI coach that detects a student's
emotional state and responds to it is close to a textbook instance of the defined term. This is a
**prohibition on collection**, not a consent-or-contract condition — consent does not cure it, and no vendor
agreement can. Three mitigating arguments exist, all of which need a lawyer:

1. **Scope.** Subsection (e) binds "Schools," which the Act does not separately define; if "school" means a
   public K-12 school, adult education may fall outside it — but see the (b)(9) hook above.
2. **Mechanism.** A student *self-reporting* a mood on a form is arguably not data "collected through affective
   computing"; the prohibition may target *inference* by the device rather than *disclosure* by the user. A
   crisis flag produced by a keyword/regex detector is a harder call — it is detection by the device.
3. **Safety.** A crisis-detection safety net serves an interest the Legislature plainly did not intend to
   forbid, and §18-2-5h(d) separately bars districts from *reporting* medical/health records to the state
   without barring their existence locally.

**[INFERENCE]** Regardless of how this resolves, the architecture implication is clear and cheap to act on:
**keep mood and crisis data local, minimally retained, never sent to a cloud model, and never transmitted to the
WVDE longitudinal data system.** That posture is defensible under every reading of §18-2-5h and costs almost
nothing. VisionQuest's existing `student_record` local-only AI routing rule already points this direction; this
statute is a strong independent reason to extend it explicitly to mood and crisis content.

**(c) A direct vendor-contract mandate.** §18-2-5h(c)(6) requires the Department to:

> "Ensure that any contracts that govern databases, assessments or instructional supports that include student
> or redacted data and are outsourced to private vendors include express provisions that safeguard privacy and
> security and **include penalties for noncompliance**."

**[INFERENCE]** "Penalties for noncompliance" is a *contract term requirement*, and it is not in FERPA. If SDATAA
applies, a VisionQuest agreement without a liquidated-damages or penalty clause is non-conforming. Cheap to add;
add it regardless.

Also note §18-2-5h(c)(4), which mandates a data security plan including "(D) Breach planning, notification and
procedures; (E) Data retention and disposition policies; and (F) Data security policies including electronic,
physical, and administrative safeguards, such as data encryption and training of employees" — a useful,
free-standing template for VisionQuest's own security documentation.

### 6.2 WV breach notification — W. Va. Code §46A-2A-101 et seq.

**[STATUTE]** — https://code.wvlegislature.gov/46A-2A-101/

The definition is **narrow**. §46A-2A-101(6):

> "'Personal information' means the first name or first initial and last name linked to any one or more of the
> following data elements that relate to a resident of this state, when the data elements are neither encrypted
> nor redacted: (A) Social security number; (B) Driver's license number or state identification card number
> issued in lieu of a driver's license; or (C) Financial account number, or credit card, or debit card number in
> combination with any required security code, access code or password that would permit access to a resident's
> financial accounts."

And the trigger requires a fraud/identity-theft nexus. §46A-2A-101(1) defines breach as unauthorized acquisition
"that causes the individual or entity to reasonably believe that the breach of security has caused or will cause
identity theft or other fraud to any resident of this state." §46A-2A-102(a) imposes notice "without unreasonable
delay." Enforcement is exclusively by the Attorney General, §46A-2A-104(b), with civil penalties only on "a
course of repeated and willful violations" and capped at "$150,000 per breach of security of the system or series
of breaches of a similar nature."

**[INFERENCE]** Almost none of VisionQuest's genuinely sensitive data is covered. Chat transcripts, mood entries,
crisis flags, résumés, addresses, DOB, phone, and TANF/SNAP status are **not** "personal information" under this
statute. A catastrophic dump of every SPOKES coaching transcript in West Virginia would likely trigger **no**
notification duty under §46A-2A-102 — because it contains no SSNs or financial account numbers and produces no
identity-theft nexus. Two consequences:

1. **Do not treat the WV breach statute as your breach-response standard.** It is a floor set for a different
   kind of harm. FERPA has no breach-notification requirement either. **[INFERENCE]** Your real obligations here
   will come from the *contract* (§10) and from SDATAA §18-2-5h(c)(8) if applicable ("Notify the Governor upon
   the suspicion of a data security breach or confirmed breach... The parents shall be notified as soon as
   possible"), which is far broader than §46A-2A-101 because it is not limited to SSN/financial data.
2. Encryption is a safe harbor by definition — §46A-2A-101(6) applies only when elements are "neither encrypted
   nor redacted," and §46A-2A-101(3) defines encryption.

### 6.3 W. Va. Code §9-9-20 — WV WORKS confidentiality (the sharpest state constraint)

**[STATUTE]** W. Va. Code §9-9-20, "Confidentiality, fines and penalties," within the WV WORKS Act.
— https://code.wvlegislature.gov/9-9-20/

> "(a) Except as otherwise provided in this code or rules, **all records and information of the department
> regarding any beneficiary or beneficiary's family members**, including food stamps, child support and Medicaid
> records, are confidential and shall not be released, except under the following circumstances: (1) If
> permissible under state or federal rules or regulations; (2) Upon the express written consent of the
> beneficiary or his or her legally authorized representative; (3) Pursuant to an order of any court...; or
> **(4) To a department or division of the state or other entity, pursuant to the terms of an interagency or
> other agreement: Provided, That any agreement specifically references this section and extends its
> requirements for confidentiality to the other entity receiving the records or information, its agents and
> employees.**"

> "(b) Any person who knowingly and willfully releases or causes to be released the confidential records and
> information described in this section, except under the specific circumstances enumerated in this section, is
> guilty of a **misdemeanor** and, upon conviction thereof, shall be fined not more than $500 or confined in the
> county or regional jail for not more than six months, or both."

West Virginia's own **FFY 2024 TANF State Plan** cites this section as the state's implementation of 42 U.S.C.
§602(a)(1)(A)(iv): "West Virginia restricts the use and disclosure of confidential information on families
receiving WV WORKS assistance consistent with state and federal law. West Virginia state law specifically
provides confidentiality provisions for WV WORKS confidential information. ● §9-9-20..." **[GUIDANCE/FACT]**
— https://bfa.wv.gov/media/39875/download?inline=

**[INFERENCE] This is the most operationally demanding provision in this entire report, and it is the one most
likely to be overlooked**, for four reasons:

1. It carries **criminal penalties**. FERPA does not; its sanction is loss of federal funds.
2. Route (4) is not a general "we have a contract" exception. The agreement must **specifically reference
   §9-9-20 by name** and must **extend its confidentiality requirements to the receiving entity, its agents and
   employees**. A generic confidentiality clause does not satisfy this. **[INFERENCE]** "Agents" naturally
   reaches VisionQuest's subprocessors — meaning Google, Supabase, and Render must be brought inside the
   flow-down, or the arrangement is arguably outside route (4).
3. It reaches **DoHS records**, so it bites precisely on the SPOKES case data (employment, wages, barriers,
   county) that originates with the benefits agency — the data least likely to be covered by FERPA if the
   provider turns out not to be an educational agency. **The two regimes cover for each other's gaps**, which is
   why you cannot pick one and ignore the other.
4. Route (2) — "express written consent of the beneficiary" — is available and is the cleanest path for an
   adult-only population. See §7.

**[UNVERIFIED]** Whether §9-9-20 attaches to data VisionQuest collects *directly from the student* (as opposed
to receiving from DoHS) turns on whether such data become "records and information of the department." Given
that SPOKES operates under a DoHS contract and reports outcomes back to DoHS, a cautious reading treats the
SPOKES case data as departmental. Counsel should resolve; the conservative posture is cheap.

### 6.4 WVDE AI guidance

**[GUIDANCE]** WVDE, "Guidance, Considerations, & Intentions for the Use of Artificial Intelligence in West
Virginia Schools," **Version 1.2, March 2025** (44 pp.), successor to v1.0 (2024) and v1.1 (May 2024, ERIC
ED655373). — https://wvde.us/sites/default/files/2025-03/WVDE%20AI%20Guidance%201.2%20March%202025.pdf

**[FACT]** It is explicitly scoped to "West Virginia PK-12 schools," so it does **not** govern adult education
by its own terms. **[INFERENCE]** It nonetheless states WVDE's institutional posture, and a WVDE-contracted
program should expect to be measured against it informally. Two passages matter:

> "Obtaining parental consent is crucial, but it is also important to recognize that even with consent, **using
> identifiable data in public AI models is not advisable**. Any data information inputted into the AI model,
> including prompts, has the potential to be incorporated into the model's future iterations and potentially
> shared with other users."

> "Staff and students are **prohibited from entering confidential or personally identifiable information into
> unauthorized AI tools, such as those without approved data privacy agreements**."

**[INFERENCE]** Read together: WVDE's stated position is that identifiable data may go to AI tools **only** under
an approved data privacy agreement, and that "public" models (i.e. consumer/free-tier services that train on
input) are off-limits even with consent. That maps exactly onto the paid-vs-free Gemini tier distinction in §2.4
and is independent corroboration of the single most important action item. Note the guidance's reasoning is
about *training on prompts* — which the paid tier contractually forecloses.

### 6.5 Comprehensive consumer privacy statute

**[FACT] West Virginia has no comprehensive consumer data privacy statute in force as of September 2026.** The
"West Virginia Consumer Privacy Act of 2026," HB 4868, was introduced and **referred to House Judiciary on
January 28, 2026, where it remains — not enacted.**
— https://www.wvlegislature.gov/bill_status/bills_text.cfm?billdoc=hb4868+intr.htm&yr=2026&sesstype=RS&i=4868

Earlier attempts (HB 3453 in 2023, HB 5338 in 2024, HB 2987 in 2025) likewise did not pass. **[INFERENCE]** So
there is no WV analogue to VCDPA/CPA obligations — no DPIA mandate, no consumer rights regime, no
"sensitive data" opt-in. Watch the 2027 session; if a WV CPA passes it will likely carry a sensitive-data
category covering health/mental-health inferences, which would reach mood and crisis data directly.

---

## 7. Consent as a route

### 7.1 What a valid FERPA consent requires

**[REGULATION]** 34 CFR 99.30:

> "(b) The written consent must: (1) Specify the records that may be disclosed; (2) State the purpose of the
> disclosure; and (3) Identify the party or class of parties to whom the disclosure may be made."

> "(c)(1) If a parent or eligible student so requests, the educational agency or institution shall provide him
> or her with a copy of the records disclosed."

> "(d) 'Signed and dated written consent' under this part may include a record and signature in electronic form
> that— (1) Identifies and authenticates a particular person as the source of the electronic consent; and
> (2) Indicates such person's approval of the information contained in the electronic consent."

**[INFERENCE]** Four practical consequences for VisionQuest:

- **Signed and dated** is mandatory, and **electronic signature is expressly permitted** by 99.30(d) — but it
  must *authenticate the person*. A checkbox on an unauthenticated page does not; a click by a logged-in,
  password-authenticated student with a server-side timestamp and an immutable audit record does. VisionQuest's
  existing auth stack can meet this.
- The consent must **identify the party or class of parties**. "Third-party AI service providers used to operate
  the coaching feature, currently Google LLC (Gemini API)" satisfies 99.30(b)(3) as a class-plus-named-party.
  A bare "our vendors" likely does not.
- **99.30(c)(1) creates an on-request duty to give the student a copy of what was disclosed.** For a chat app
  this is non-trivial — it implies retaining a record of what content was sent to the model. VisionQuest's
  existing `SageOperation` ledger and `/memory` student-facing page are the right shape for this; make sure they
  actually cover model inputs, not only writes.
- Consent is **revocable in practice** and per-student, so the system must tolerate a student who declines —
  which means a working non-cloud path (the local Ollama route) is not just a FERPA nicety but the fallback that
  makes consent genuinely voluntary rather than a condition of receiving services.

### 7.2 Is consent workable for adult SPOKES students? Yes — and there is precedent in this exact program.

**[REGULATION]** All rights are the students' own: 34 CFR 99.5(a)(1) (rights transfer at 18) and 34 CFR 99.3
("Eligible student"). There is no parent in the loop, no PPRA (K-12 only), and no COPPA (under-13 only). This is
the single biggest legal advantage VisionQuest has, and it is underused.

**[GUIDANCE]** The ED/DOL joint guidance records that **AEFLA already runs on a consent model** (p. 30):

> "While these options focus on using an exception to prior written consent under FERPA... educational agencies
> and institutions, VR agencies, ETPs, and other service providers are **encouraged to obtain prior written
> consent from program participants when feasible. One program that is successfully relying on a consent model
> is the AEFLA program**, where providers currently obtain written consent from program participants prior to
> disclosing PII from education records for the purpose of conducting cross-data matching with UC wage data."

> "The Departments recommend that participants of programs under WIOA, including the VR and AEFLA programs, be
> made aware that their information is being disclosed, how their information is being used, and how it is being
> protected from further disclosure."

**[INFERENCE]** So: an AEFLA provider asking an adult student for written consent is doing an ordinary thing it
already does, not inventing a new burden. Better still, **one well-drafted consent instrument can discharge
several regimes at once** — FERPA §99.30, W. Va. Code §9-9-20(a)(2) ("express written consent of the
beneficiary"), and the §205.50(a)(2)(iii) expectation that "the family or individual is informed whenever
possible of a request for information from an outside source, and permission is obtained to meet the request."
That is a strong argument for building consent **in addition to**, not instead of, the school-official route.

**Recommended posture [INFERENCE]:** **belt and braces.** Rely on the school-official exception as the primary
basis (it survives a student who forgets to sign, and it is what PTAC expects for an operational system), and
obtain §99.30-compliant written consent as an independent, documented basis that also satisfies §9-9-20(a)(2).
Do **not** rely on consent alone — a consent-only model means any withdrawal breaks the service, and it puts
the compliance weight on the least sophisticated party in the transaction.

### 7.3 SOPIPA-style vendor laws — and whether West Virginia has one

**[FACT]** California's SOPIPA (Cal. Bus. & Prof. Code §22584) and the ~20–40 state laws modeled on it prohibit
covered **operators** from: targeted advertising to students; **amassing a profile** of a student except for
authorized educational purposes; **selling or renting** student information; and **disclosing** covered
information except in enumerated circumstances — and typically impose affirmative security and deletion duties.
These bind the vendor **directly**, independent of any contract, which is what makes them different from FERPA.

**[FINDING — moderate confidence, partially unverified] West Virginia does not appear to have enacted a
SOPIPA-style operator statute.** Its student privacy law is §18-2-5h, which is a **state data-governance** law of
the 2014 wave — it regulates WVDE, districts, and schools, and reaches vendors only *indirectly* through the
contract mandate at §18-2-5h(c)(6). I searched the WV Code and two student-privacy law trackers and located no
WV provision imposing SOPIPA-style duties (no "operator," no "school service provider," no targeted-advertising
or profiling prohibition). **[UNVERIFIED]** I could not obtain a WV-specific entry from the Public Interest
Privacy Center or Parent Coalition trackers to confirm negatively; treat this as "no such statute located,"
not as a proven negative. A 15-minute check by WV counsel would settle it.

**[INFERENCE]** Practical effect: the profiling and no-sale prohibitions that would bind VisionQuest
automatically in California must, in West Virginia, be **written into the contract** — which is precisely why
they appear in the checklist at §10. Note that if VisionQuest ever serves students in a SOPIPA state, those
duties attach directly to VisionQuest as operator regardless of what the SPOKES contract says.

---

## 8. Health-adjacent data — mood check-ins and crisis flags (short, as requested)

**[INFERENCE] HIPAA does not apply.** VisionQuest is not a covered entity (not a health plan, clearinghouse, or
healthcare provider transmitting standard transactions) and not a business associate of one. Confirmed as the
owner assumed.

**[REGULATION] 42 CFR Part 2 does not apply.** Part 2 attaches only to a "part 2 program," defined at 42 CFR
2.11 as "A person (other than a general medical facility) that **holds itself out as providing, and provides,
substance use disorder diagnosis, treatment, or referral for treatment**." VisionQuest holds itself out as a
career coach. The federal-assistance prong at 42 CFR 2.12(b) is easily met, but it is not sufficient on its own —
both the "program" and the SUD-purpose conditions must be satisfied. **[INFERENCE]** One caution: if VisionQuest
ever adds an explicit SUD **referral** feature, re-run this analysis — "referral for treatment" is in the
definition, and the federal-assistance prong is already satisfied, so a referral feature is the one change that
could pull the app inside Part 2.

**[STATUTE/INFERENCE] W. Va. Code §27-3-1** (confidentiality of mental-health information) is keyed to
information obtained in the course of treatment at a mental health facility, which VisionQuest is not. Not
applicable. **[UNVERIFIED]** I was unable to extract the full current text of §27-3-1 from the legislature's
site (the section body did not render); a lawyer should read it directly rather than rely on this line.

**[INFERENCE] The real constraint on mood and crisis data is not health law at all — it is W. Va. Code
§18-2-5h(e)(3), the affective-computing collection prohibition, and §18-2-5h(b)(11), which classifies "medical,
psychological or behavioral diagnoses" as confidential student information.** See §6.1. That is a state
education statute, not a health statute, which is exactly why it is easy to miss.

---

## 9. What is actually required vs. what is folklore

### Folklore

| Claim | Reality |
|---|---|
| **"FERPA prohibits putting student data in the cloud / in AI."** | False. FERPA has no technology, hosting, or AI provisions whatsoever. 34 CFR 99.31(a)(1)(i)(B) expressly contemplates outsourcing to contractors, and PTAC's Feb 2014 guidance is fourteen pages of *how to do it*, not whether. The July 2025 Dear Colleague Letter affirms AI uses "are allowable under existing federal education programs." |
| **"FERPA requires a signed written contract with the vendor."** | False as a matter of law. PTAC, Feb 2014, p. 4: "While FERPA regulations do not require a written agreement for use in disclosures under the school official exception..." A contract is the *practical* way to prove direct control, and PTAC recommends one — but a Terms of Service can suffice, and the actual legal requirement is direct control, not paper. **Get a contract anyway**; §6.1 and §6.3 independently require contract terms even where FERPA does not. |
| **"Strip names, emails, phones and DOB and it's de-identified."** | False, emphatically. PTAC: "simple removal of direct identifiers from the data to be released **DOES NOT** constitute adequate de-identification." 34 CFR 99.3(f)'s "linked or linkable... reasonable person in the school community" catch-all defeats naive redaction, and free-text coaching transcripts about TANF recipients in small WV counties are close to the worst case. |
| **"US data residency is legally required."** | **No federal requirement located.** Neither FERPA, 7 CFR 272.1(c), 42 U.S.C. §602, nor W. Va. Code §18-2-5h/§9-9-20 imposes a data-localization rule. It is a sound *procurement* requirement and a good contract term — it simplifies subpoena exposure and satisfies reviewers — but calling it legally mandatory is folklore. **[UNVERIFIED]** as to any WV procurement rule that might impose one independently. |
| **"We must notify students of any data breach."** | Not under WV law for most of this data. W. Va. Code §46A-2A-101(6) covers only name + SSN / driver's license / financial account, and only with an identity-theft nexus. FERPA has no breach-notification provision at all. Your notification duties will come from **contract** and, if SDATAA applies, from §18-2-5h(c)(8). |
| **"HIPAA covers the mood and crisis data."** | No. Not a covered entity. The actual constraint is a state *education* statute, §18-2-5h(e)(3). |
| **"20 CFR 683.220 is the WIOA privacy rule that applies to us."** | It applies to **WIOA title I and Wagner-Peyser** funds. SPOKES is **title II (AEFLA)**. Commonly miscited. |
| **"Adult students' records aren't education records because they're adults."** | Backwards. Being adults changes *who holds the rights* (34 CFR 99.5(a)(1)), not whether FERPA applies. It makes compliance *easier*, not unnecessary. |
| **"TANF has a comprehensive federal confidentiality rule."** | Weak. 42 U.S.C. §602(a)(1)(A)(iv) delegates to "such reasonable steps as the State deems necessary." The binding rule here is **West Virginia's** §9-9-20 — which is stricter than people expect and criminally enforced. |

### Actually required

1. **[REGULATION]** If FERPA applies: the vendor must perform a function the institution would otherwise use
   employees for; be under **direct control** as to use and maintenance of records; and be bound by the
   §99.33(a) use-and-redisclosure limits. 34 CFR 99.31(a)(1)(i)(B).
2. **[REGULATION]** The provider must be **named in the institution's annual FERPA notification criteria** for
   who is a "school official" with a "legitimate educational interest." 34 CFR 99.7(a)(3)(iii). *This is an
   institutional homework item, not a vendor one, and it is the most frequently skipped condition.* If the
   SPOKES provider's annual notice does not describe contractors as school officials, the exception is not
   available no matter how good the contract is.
3. **[REGULATION]** Students must be able to inspect and review their records **including those held by the
   vendor**, within 45 days. 34 CFR 99.7(a)(2)(i); PTAC Feb 2014 p. 5.
4. **[REGULATION]** No use of the data for any purpose other than the disclosed one — which **rules out model
   training** on education records. 34 CFR 99.33(a)(2).
5. **[REGULATION]** Access controls limiting each school official to records in which they have a legitimate
   educational interest. 34 CFR 99.31(a)(1)(ii). (VisionQuest's RLS + `withRlsContext` design is exactly this
   control; it is a compliance artifact, not just engineering hygiene.)
6. **[STATUTE]** If DoHS beneficiary records are involved: an agreement that **specifically references W. Va.
   Code §9-9-20** and extends confidentiality to the entity, **its agents and employees**. §9-9-20(a)(4).
   Criminal penalty for violation, §9-9-20(b).
7. **[REGULATION]** SNAP data used only for purposes in 7 CFR 272.1(c)(1), and recipients must "adequately
   protect the information against unauthorized disclosure to persons or for purposes not specified,"
   7 CFR 272.1(c)(2).
8. **[STATUTE]** If SDATAA reaches adult ed: no collection of confidential student information or
   affective-computing data, §18-2-5h(c)(9), (e)(3); vendor contracts must carry privacy/security provisions
   **with penalties for noncompliance**, §18-2-5h(c)(6).
9. **[FACT]** Paid-tier Gemini API, not free tier — because the free tier's own terms authorize training and
   human review and instruct users not to submit personal information.

---

## 10. Minimum contract/policy checklist — qualifying a cloud AI vendor as a FERPA school official for VisionQuest

Each item is tagged with what makes it necessary. Items marked **[BEST PRACTICE]** are not legally compelled by
any source I found but are recommended by PTAC or are prudent.

### A. Status and purpose

- [ ] **Designate the vendor a "school official" with a "legitimate educational interest,"** in the contract
      *and* in the institution's **annual FERPA notification**. — 34 CFR 99.31(a)(1)(i)(B); **34 CFR
      99.7(a)(3)(iii)**. *Both halves. The annual notice is the half that gets forgotten.*
- [ ] **Recite that the vendor performs an institutional service the provider would otherwise use employees
      for** — here, career advising and coaching support. — 34 CFR 99.31(a)(1)(i)(B)(1). *Supported by the July
      2025 DCL's "virtual advising systems" category.*
- [ ] **Direct-control clause**: the institution directs the use and maintenance of education records; the
      vendor acts only on documented instructions. — 34 CFR 99.31(a)(1)(i)(B)(2); PTAC Feb 2014 p. 4
      ("establish direct control through a contract").
- [ ] **Purpose limitation**: education records used solely to deliver the contracted service. — 34 CFR
      99.33(a)(2). Extend expressly to SNAP (7 CFR 272.1(c)) and WV WORKS (§9-9-20) data.
- [ ] **Institution's written acknowledgment to the vendor of the §99.33(a) restrictions** — this is an
      affirmative duty on the *institution*. — 34 CFR 99.33(d).

### B. AI-specific terms (the ones a generic edtech DPA will miss)

- [ ] **No training, fine-tuning, grounding, evaluation, or model improvement** on student data, by the vendor
      or any subprocessor, **without prior written authorization**. — 34 CFR 99.33(a)(2). *Google's paid-tier
      terms already say "Google doesn't use your prompts or responses to improve our products"; the contract
      should bind the SPOKES-facing party to procure and maintain that tier.*
- [ ] **Contractually require the paid Gemini tier (or equivalent non-training tier)** and prohibit routing any
      student data through free/consumer tiers. — Gemini API Additional ToS, "Unpaid Services" vs "Paid
      Services"; corroborated by WVDE AI Guidance 1.2 ("using identifiable data in public AI models is not
      advisable"). **Verify current billing tier before anything else.**
- [ ] **No human review** of student content except as strictly necessary for security/abuse investigation
      under the institution's instruction. — *The free tier's "human reviewers may read, annotate, and process
      your API input and output" is disqualifying.*
- [ ] **Bound retention of prompts/outputs at the model provider**, with the retention period stated.
      **[BEST PRACTICE]** *Google states paid-tier logging is "for a limited period of time, solely for detecting
      and preventing violations" — get the number in writing.*
- [ ] **No profiling, targeted advertising, or sale of student information.** — PTAC Feb 2014 p. 5 (provider "may
      not share (or sell)"); PTAC Vendor FAQ (data mining for targeted advertising "will likely violate federal
      or state privacy laws"). **[INFERENCE]** *Must be contractual in WV, since no SOPIPA-style statute imposes
      it directly (§7.3).*
- [ ] **Route mood check-ins, crisis flags, and any behavioral/psychological content to the local model only —
      never to a cloud provider**, and exclude it from any state reporting. — W. Va. Code §18-2-5h(e)(3),
      (b)(11), (d); **[INFERENCE]**. *Extends VisionQuest's existing `student_record` local-only rule; note the
      standing open item that `resolveAiProvider` currently fails **open** to cloud, which would breach this.*
- [ ] **No secondary use of de-identified derivatives without authorization**, and a **contractual ban on
      re-identification** by any transferee. — **[BEST PRACTICE]**, PTAC Vendor FAQ p. 3.

### C. Redisclosure, subprocessors, residency

- [ ] **No redisclosure to any third party** without institutional authorization and a FERPA-permitted basis.
      — 34 CFR 99.33(a)(1).
- [ ] **Named subprocessor list** (Google, Supabase, Render, Twilio, Sentry, etc.), advance notice of changes,
      and **full flow-down of every obligation in this checklist**. — 34 CFR 99.33(a)(2) reaches "officers,
      employees, and **agents**"; W. Va. Code §9-9-20(a)(4) requires extension to "its agents and employees";
      45 CFR 205.50(a)(2)(ii) requires recipients be "subject to standards of confidentiality which are
      **comparable to those of the agency**."
- [ ] **Specifically reference W. Va. Code §9-9-20 by name** in the agreement covering DoHS-sourced data, and
      extend its confidentiality requirements to the entity, its agents, and employees. — §9-9-20(a)(4). *A
      generic confidentiality clause does not satisfy this. Name the section.*
- [ ] **US data residency and US-based processing/support.** — **[BEST PRACTICE]**; *not required by any source
      located (see Folklore). Include it as procurement hygiene, and do not represent it as legally mandated.*

### D. Student rights

- [ ] **Access/inspection support**: vendor must produce a student's records so the institution can meet the
      45-day deadline. — 34 CFR 99.7(a)(2)(i), 99.10; PTAC Feb 2014 p. 5.
- [ ] **Amendment support**: mechanism to correct records the student successfully challenges. — 34 CFR 99.20–99.22.
- [ ] **Copy-of-disclosure support** where consent is the basis. — 34 CFR 99.30(c)(1). *Implies logging what
      content was sent to the model, not only what was written back.*
- [ ] **Consent instrument** meeting 34 CFR 99.30(b)(1)–(3) and (d): specifies records, states purpose, names
      the party/class, signed and dated, electronically authenticated to the individual. Drafted to **also**
      serve as §9-9-20(a)(2) "express written consent." — §7.1.

### E. Security, retention, breach

- [ ] **Security program** with technical, physical, and administrative safeguards; encryption **at rest and in
      transit**. — PTAC Written Agreement Checklist ("maintaining the data in a secure manner by applying
      appropriate technical, physical, and administrative safeguards... both at rest and in transit"); W. Va.
      Code §18-2-5h(c)(4)(F). *Encryption is also the §46A-2A-101(6) breach safe harbor.*
- [ ] **Retention limits and deletion schedule.** — PTAC Written Agreement Checklist ("Set terms for data
      destruction"); W. Va. Code §18-2-5h(c)(4)(E).
- [ ] **Return and certified destruction on termination**, with method specified per media type. — PTAC Written
      Agreement Checklist ("approved destruction methods for each specific type of media (e.g., data wiping,
      degaussing, shredding)"); PTAC Vendor FAQ ("Providing certification of data destruction is a best
      practice").
- [ ] **Breach notification to the institution without unreasonable delay**, with content and timing specified.
      — **[BEST PRACTICE]** as to FERPA (which has no breach rule); required in substance by W. Va. Code
      §18-2-5h(c)(8) if SDATAA applies; note §46A-2A-102 will rarely be triggered by this data (§6.2). *Set the
      contractual trigger at "any unauthorized access to student data," not at the narrow §46A-2A-101(6)
      definition.*
- [ ] **Audit rights** for the institution. — PTAC Written Agreement Checklist ("Maintain the right to audit").
- [ ] **Penalties for noncompliance.** — **W. Va. Code §18-2-5h(c)(6)** (express statutory requirement if SDATAA
      applies — this is not merely a best practice).
- [ ] **Data ownership stated**: records remain the institution's. — PTAC Written Agreement Checklist ("State
      ownership of PII").
- [ ] **Named points of contact / data custodians.** — PTAC Written Agreement Checklist.
- [ ] **Public posting of the agreement and the shared data-element list.** — **[BEST PRACTICE]**, PTAC Vendor
      FAQ p. 3 ("both the provider and the school or district should post contracts or agreements on their
      public facing websites, including a list of data elements shared"); redact security details first, per the
      Written Agreement Checklist.

> **Caveat on the PTAC Written Agreement Checklist**: it states the mandatory elements for the **studies**
> (34 CFR 99.31(a)(6)(iii)(C)) and **audit-or-evaluation** (34 CFR 99.35(a)(3)) exceptions — **not** the school
> official exception, which mandates no written agreement at all. I have used its items above as
> **best practices**, which is what they are in this context. Do not cite it as imposing legal requirements on a
> school-official vendor agreement; that is a common and checkable error.

---

## 11. Priority actions

1. **Determine the Gemini API billing tier now.** Free tier = training + human review + an express instruction
   not to submit personal information. This is the one item that is both binary and currently unknown.
   *(§2.4)*
2. **Get the legal identity of each SPOKES delivery site** and its ED funding path. This decides whether FERPA
   attaches directly. *(§1.4)*
3. **Take W. Va. Code §9-9-20 to counsel.** Criminal penalties, a name-the-section contract requirement, and it
   covers the DoHS case data that FERPA might not. Most under-appreciated item in this report. *(§6.3)*
4. **Take the §18-2-5h(e)(3) affective-computing question to counsel**, and in the meantime keep mood and crisis
   data local-only, out of cloud prompts and out of state reporting. Also fix the `resolveAiProvider`
   fail-open-to-cloud behavior, which currently contradicts this posture. *(§6.1)*
5. **Check the SPOKES provider's annual FERPA notification** for school-official criteria. No contract can cure
   its absence. *(§9, required item 2)*
6. **Build the §99.30 consent instrument** as a second, independent basis that also serves §9-9-20(a)(2).
   *(§7.1)*

---

## Appendix — sources consulted

**Statutes:** 20 U.S.C. §1232g (FERPA); 42 U.S.C. §602(a)(1)(A)(iv) (TANF state plan); W. Va. Code §18-2-5h
(SDATAA); §9-9-20 (WV WORKS confidentiality); §46A-2A-101 to -105 (breach); §27-3-1 (mental health, partially
unverified).
**Regulations:** 34 CFR Part 99 (99.1, 99.3, 99.5, 99.7, 99.30, 99.31, 99.33); 45 CFR 205.50; 7 CFR 272.1(c);
20 CFR 677.175, 683.220; 42 CFR 2.11, 2.12.
**Federal guidance:** ED/DOL *Joint Guidance on Data Matching to Facilitate WIOA Performance Reporting and
Evaluation*; PTAC *Protecting Student Privacy While Using Online Educational Services* (Feb 2014); PTAC
*Responsibilities of Third-Party Service Providers under FERPA* (Aug 2015); PTAC *Written Agreement Checklist*
(Apr 2012, rev. Jul 2015); PTAC *Data De-identification: An Overview of Basic Terms* (Oct 2012, upd. May 2013);
ED OET *Designing for Education with Artificial Intelligence: An Essential Guide for Developers* (Jul 2024);
Secretary's *Dear Colleague Letter* on AI and federal grant funds (Jul 22, 2025).
**State materials:** WVDE *AI Guidance* v1.2 (Mar 2025); WV FFY 2024 TANF State Plan; WV HB 4868 (2026) bill status.
**Vendor terms:** Gemini API Additional Terms of Service (https://ai.google.dev/gemini-api/terms).

**Not legal advice.** Every **[INFERENCE]** above is my reasoning from primary text and should be confirmed by
West Virginia counsel with education-law and public-benefits experience.
