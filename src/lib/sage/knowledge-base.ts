/**
 * Condensed program knowledge bases for Sage's system prompt.
 * Gives Sage always-available knowledge about each program without
 * needing to retrieve from external sources. Selection is driven by
 * the student's active-enrollment ProgramType (see src/lib/program-type.ts).
 */

/**
 * Three-sentence summary of the SPOKES program for use in stages that do
 * not require the full knowledge base (check-in, goal-setting, etc.).
 * Keeps Sage oriented without injecting ~5,000 tokens of certification detail.
 * The full block is still available via getRelevantContent() keyword matching.
 */
export const SPOKES_BRIEF = `SPOKES PROGRAM OVERVIEW (brief): SPOKES (Skills, Preparation, Opportunities, Knowledge, Employment, Success) is a West Virginia workforce training program for adults receiving TANF/SNAP benefits, focused on employment and self-sufficiency. Students can earn industry certifications including IC3 Digital Literacy, Microsoft Office Specialist, QuickBooks, ACT WorkKeys, and more through platforms like GMetrix, Essential Education, and Khan Academy. If you need detailed certification requirements, platform setup steps, or program forms, just ask — full program details are available.`;

import type { ProgramType } from "@/lib/program-type";

export const SPOKES_KNOWLEDGE = `SPOKES PROGRAM KNOWLEDGE BASE
You have detailed knowledge of the SPOKES program. Use this to answer specific questions.

WHAT IS SPOKES?
SPOKES stands for Skills, Preparation, Opportunities, Knowledge, Employment, Success. It is a workforce training program operated under West Virginia Adult Education for adults receiving TANF/SNAP benefits through WV Works. The goal is employment and self-sufficiency.

CERTIFICATIONS AVAILABLE (students can earn these):
1. IC3 Digital Literacy (Internet and Computing Core Certification)
   - 3 levels: Level 1 (Computing Fundamentals), Level 2 (Key Applications), Level 3 (Living Online)
   - GS6 standard. Master Certification requires passing all 3 levels.
   - Practice tests on GMetrix, training via LearnKey videos
   - Exams administered through Certiport Compass software
2. Microsoft Office Specialist (MOS)
   - Word, Excel, PowerPoint, Outlook, Access (2016 editions)
   - Practice tests on GMetrix. Exams through Certiport.
   - Voucher request form available for exam fees
3. Adobe Certified Associate (ACA)
   - Photoshop, Illustrator, InDesign modules
4. Intuit Certifications
   - QuickBooks Certified User
   - Intuit Bookkeeping Professional
   - Intuit Personal Finance
   - Intuit Design for Delight Innovator
   - Free QuickBooks Online available for educators
5. ACT WorkKeys National Career Readiness Certificate (NCRC)
   - Tests: Applied Math, Workplace Documents, Business Writing
   - Score levels: Bronze, Silver, Gold, Platinum
   - Maps to O*NET occupations (Silver = 35% of profiled jobs, Gold = 65%, Platinum = 93%)
   - Students create accounts at act.org
6. IT Specialist - Cybersecurity
   - Entry-level cybersecurity certification through Certiport
7. Customer Service (Through the Customer's Eyes)
   - Part 1 and Part 2
   - Training at learn.skillpath.com
   - Account request via Wufoo form
8. Critical Career Skills - Generative AI Foundations
9. Critical Career Skills - Professional Communications
10. Computer Essentials (Essential Education)
    - Digital literacy program at essentialed.com/start/wvde
11. Work Essentials Certificate
12. Money Essentials Certificate
13. Burlington English Certificate/Certification (for ESL students)
14. Bring Your A Game Certificate
    - Work ethic curriculum covering the 7 A's: Attitude, Attendance, Appearance, Ambition, Accountability, Appreciation, Acceptance
    - Includes video lessons and classroom activities
    - Exam and certificate request via Wufoo forms

SPOKES CERTIFICATES (program milestones, not industry certifications):
The Ready to Work Certificate is the standard goal for all students. Lesser certificates exist as fallbacks for students who exit early or don't quite reach all RTW benchmarks.
- Ready to Work Certificate — the target for every student; requires meeting attendance benchmarks, earning core certifications, building an employment portfolio, and demonstrating job readiness skills
- Certificate of Achievement — strong participation with documented benchmarks
- Certificate of Completion — completing core program requirements
- Certificate of Participation — benchmarks documented by instructor
- Certificate of Attendance — based on attendance hours only

LEARNING PLATFORMS (where students do coursework):
1. GMetrix & LearnKey — Certification practice tests and training (IC3, MOS, QuickBooks). Login: gmetrix.net. Register at certiport.pearsonvue.com.
2. Edgenuity — Online courseware for HSE/academic subjects. Student login: auth.edgenuity.com/Login/Login/Student
3. Khan Academy — Free math and academic courses. Login: khanacademy.org
4. Essential Education — Computer Essentials digital literacy. Access: essentialed.com/start/wvde. Use Firefox browser.
5. Burlington English — ESL/English language learning. Login: burlingtonenglish.com
6. USA Learns — Free online English courses for ESL students. Homepage: usalearns.org
7. Aztec — GED/HSE prep software with guides and student handouts
8. CSMlearn — Career skills and soft skills training. Login: csmlearn.com. Account request via Wufoo form.
9. Bring Your A Game Anywhere — Work ethic curriculum (7 A's). Classroom-based with video lessons.
10. Through the Customer's Eyes — Customer service training (2 parts). Login: learn.skillpath.com.
11. WV Tourism Works — WV tourism industry training (external program)

STUDENT ONBOARDING FORMS (FY26, current year):
Required forms for new students:
- Welcome Letter
- SPOKES Student Profile (fillable PDF)
- Personal Attendance Contract (fillable PDF)
- Rights and Responsibilities (fillable PDF)
- Dress Code Policy (fillable PDF)
- Authorization for Release of Information
- DoHS Release of Information (fillable PDF)
- Media Release Form
- Technology Acceptable Use Policy (fillable PDF)
- Employment Portfolio Checklist (fillable PDF)
- Learning Needs Screening Instrument
- CTE Learning Styles Assessment
- Non-Discrimination Notice
- Sign-in Sheet (daily attendance)
- Password Log Template
- WorkKeys Account Creation instructions

DOHS / WV WORKS FORMS:
- DFA-TS-12 — Activity tracking/time sheet (fillable version available)
- DFA-WVW-70 — WV Works participant form
- DFA-WVW-25 — Support services documentation
- DFA-PRC-1 — Program completion record
- DFA-SSP-1 — Support services plan
- Support Services Fact Sheet — overview of available support services
- Prospective Employer Letter — template for ESP/EIP employer outreach
- Dental Services through WV Works (2025) — dental benefit information

PROGRAM STRUCTURE & TIMELINE:
- SPOKES is a 4-to-10-week program (20-35 hours/week, minimum 87% attendance, rolling weekly enrollment)
- The program follows a 4-week rotating SPOKES Cycle where students work on multiple tracks simultaneously: digital literacy, employability skills, certifications, and career preparation
- Phases: Weeks 1-4 SPOKES Cycle (academic skills, job readiness, employability, certifications) → Week 5+ Vocational Training (Customer Service Parts 1 & 2) → 2-4 weeks Intense Job Search → up to 2 weeks Job Retention
- Optimal class size: 8-15 participants
- The Ready to Work Certificate is the standard goal for ALL students — most students who attend consistently meet the requirements
- Students who don't quite reach RTW benchmarks can earn a Certificate of Achievement or Participation instead
- Tracks student progress via SPOKES Student Tracker spreadsheet
- Reports through SPOKES Database (see Database Handbook)
- Curriculum based on SPOKES Life and Employability Skills Curriculum
- Students build an Employment Portfolio documenting their achievements throughout the program

ADMINISTRATOR RESOURCES:
- Educator Evaluation Procedures & Timeline (on Schoology)
- Professional Growth & Development Plan
- Employee Acceptable Use Policy (AUP)
- Personnel Confidentiality Agreement
- Administrative Guide (PY25)
- Request for Training form (Wufoo)`;

export const ADULT_ED_KNOWLEDGE = `ADULT EDUCATION PROGRAM KNOWLEDGE BASE
You have detailed knowledge of the West Virginia Adult Education GED-prep program. Use this to answer specific questions.

WHAT IS ADULT EDUCATION?
West Virginia Adult Education (WV AE) helps adults earn their High School Equivalency (HSE) — the GED — and build the academic foundation to move into further training, college, or employment. The primary goal is credential attainment (the GED), not job placement. Career and workforce conversations are secondary and only surface when the student brings them up.

THE GED TEST:
The GED has four subtests. A student passes by scoring at or above 145 on each. All four are required to earn the credential; students can retake individual subtests without redoing the whole exam.
1. Reasoning Through Language Arts (RLA) — reading comprehension, language conventions, extended response (essay). 150 minutes.
2. Mathematical Reasoning — quantitative + algebraic problem solving, on-screen calculator for part 2. 115 minutes.
3. Science — life, physical, and earth/space science; data/graph interpretation. 90 minutes.
4. Social Studies — civics/government, US history, economics, geography. 70 minutes.

Score bands per subtest:
- Below Passing: <145 (not awarded)
- Passing / High School Equivalency: 145–164
- College Ready: 165–174 (may satisfy some college placement requirements)
- College Ready + Credit: 175–200 (may earn college credit at participating institutions)

PLACEMENT & PROGRESS TRACKING — TABE 11/12:
TABE (Tests of Adult Basic Education) is the standard placement and progress instrument for WV AE. Every new student takes TABE Locator, then the appropriate level.
- Level E (Easy) — ~ABE 2.0–3.9 grade equivalent
- Level M (Medium) — ~ABE 4.0–5.9
- Level D (Difficult) — ~ABE 6.0–8.9
- Level A (Advanced) — ~ABE 9.0–12.9 (GED-ready range)
Subjects: Reading, Language, Math (Computation + Applied). Score reports feed the student's Individual Learning Plan.

NRS EDUCATIONAL FUNCTIONING LEVELS (EFLs):
WV AE reports progress through six NRS EFLs. Advancing one EFL is the headline outcome.
- EFL 1 — Beginning ABE Literacy (GE 0.0–1.9)
- EFL 2 — Beginning Basic Education (GE 2.0–3.9)
- EFL 3 — Low Intermediate Basic Education (GE 4.0–5.9)
- EFL 4 — High Intermediate Basic Education (GE 6.0–8.9)
- EFL 5 — Low Adult Secondary Education (GE 9.0–10.9)
- EFL 6 — High Adult Secondary Education (GE 11.0–12.9) — GED-ready

LEARNING PLATFORMS (GED-focused):
1. Aztec Software — WV AE's primary adaptive courseware for GED/HSE prep across all four subjects. Student-facing dashboards and teacher guides.
2. Essential Education (essentialed.com/start/wvde) — GED Academy + Essential Skills, aligned to the 2014/current GED series.
3. Khan Academy (khanacademy.org) — free math and academic content; often paired with Aztec/Essential for additional math/writing practice.
4. Edgenuity (auth.edgenuity.com/Login/Login/Student) — HSE courseware and credit recovery.
5. GED.com — the official testing portal; where students register for, schedule, and take each subtest.
6. Burlington English / USA Learns — for English Language Learners on a path to the GED.

PROGRAM STRUCTURE & TYPICAL STUDENT JOURNEY:
- Intake → TABE Locator + full TABE → Individual Learning Plan (ILP) with subject priorities and subtest targets.
- Instruction is open-entry / open-exit and adapts to the student's subtests remaining and EFL.
- Progress is measured by (a) EFL gain on re-tested TABE, (b) subtest passes on GED Ready practice tests, (c) actual GED subtest passes, and (d) earning the full credential.
- Typical BHAG framing for an AE student: "Earn my GED" (or "pass the last two subtests," "move from EFL 3 to EFL 4").
- Monthly/weekly goals typically target a specific subtest or TABE benchmark (e.g., "pass GED Ready for Math," "raise TABE Reading one EFL," "finish Aztec Algebra I unit").

POST-GED PATHWAYS (mention only if the student raises career/next-step):
- College enrollment (many WV community & technical colleges waive placement with 165+ GED scores)
- Workforce programs (including SPOKES for TANF/SNAP-eligible adults)
- Registered Apprenticeship / industry certifications
- Direct employment

KEY FORMS & COMPLIANCE (WV AE):
- Student Intake Packet — demographics, goal-setting, FERPA, data release
- Individual Learning Plan (ILP) — subject focus, target scores, review cadence
- TABE Score Report — placement baseline + post-test progress
- GED Ready practice-test results — gate to registering for the official subtest
- Student Attendance Record — WIOA reportable hours`;

// IETP Phase 2 placeholder — specialty career/industry training. Inherits SPOKES
// framing for now (employment-focused); refine once real IETP cohorts exist.
export const IETP_KNOWLEDGE = SPOKES_KNOWLEDGE;

/**
 * Returns the right program-knowledge block for the student's active program.
 * Unknown values fall through to SPOKES to match normalizeProgramType's default.
 */
export function getProgramKnowledge(programType: ProgramType): string {
  switch (programType) {
    case "adult_ed":
      return ADULT_ED_KNOWLEDGE;
    case "ietp":
      return IETP_KNOWLEDGE;
    case "spokes":
    default:
      return SPOKES_KNOWLEDGE;
  }
}

/**
 * @deprecated Use SPOKES_KNOWLEDGE or getProgramKnowledge(programType).
 * Kept for one release cycle so any out-of-tree consumers don't break.
 */
export const SPOKES_PROGRAM_KNOWLEDGE = SPOKES_KNOWLEDGE;

/**
 * Topic-specific detailed content that gets injected when relevant.
 * Keys are topic identifiers, values are detailed content blocks.
 */
export const TOPIC_CONTENT: Record<string, string> = {
  certifications_ic3: `IC3 DIGITAL LITERACY CERTIFICATION (detailed):
IC3 (Internet and Computing Core Certification) is the global standard for digital literacy.
- GS6 Standard with 3 levels:
  Level 1: Computing Fundamentals — hardware, software, OS basics
  Level 2: Key Applications — word processing, spreadsheets, presentations
  Level 3: Living Online — internet, email, social media, digital citizenship
- Master Certification: Pass all 3 levels
- Preparation: LearnKey video training + GMetrix practice tests
- Testing: Certiport Compass software (downloaded to test computers)
- Registration: certiport.pearsonvue.com (both instructors and students)
- Certificates and score reports printed from Certiport portal
- Technical requirements and disability accommodations available through Certiport`,

  certifications_mos: `MICROSOFT OFFICE SPECIALIST (MOS) CERTIFICATION (detailed):
Industry-recognized certification for Microsoft Office proficiency.
- Available exams: Word, Excel, PowerPoint, Outlook, Access (2016 editions)
- Preparation: GMetrix practice tests + LearnKey training videos
- Testing: Certiport Compass software
- Exam voucher request: Wufoo form (provided by program)
- Exam objectives available for each application (PDF documents)
- Required passing scores set by Microsoft
- Full certifications list: docs.microsoft.com/en-us/learn/certifications`,

  certifications_workkeys: `ACT WORKKEYS NATIONAL CAREER READINESS CERTIFICATE (NCRC) (detailed):
Nationally recognized credential measuring workplace skills.
- Three assessments: Applied Math, Workplace Documents, Business Writing
- Certificate levels based on scores:
  Bronze: Foundational workplace skills
  Silver: Qualifies for ~35% of profiled occupations
  Gold: Qualifies for ~65% of profiled occupations
  Platinum: Qualifies for ~93% of profiled occupations
- O*NET occupation mapping shows which jobs match each score level
- Student account creation: act.org (step-by-step guide available)
- Curriculum course outlines available for preparation
- Matching WorkKeys scores to jobs exercise available`,

  certifications_intuit: `INTUIT CERTIFICATIONS (detailed):
Four certification paths through Intuit/Certiport:
1. QuickBooks Certified User — bookkeeping and accounting software proficiency
   - Study guide available from Certiport
   - Free QuickBooks Online access for educators
2. Intuit Bookkeeping Professional — professional bookkeeping skills
3. Intuit Personal Finance — personal financial management
4. Intuit Design for Delight Innovator — design thinking and innovation
- All exams through Certiport
- Free software and resources at intuit.com/partners/education-program`,

  certifications_customer_service: `CUSTOMER SERVICE TRAINING — THROUGH THE CUSTOMER'S EYES (detailed):
Two-part customer service certification program:
- Part 1: Foundations of customer service, communication, professionalism
- Part 2: Advanced customer interactions, conflict resolution, service excellence
- Platform: learn.skillpath.com (SkillPath)
- Account setup: Request student accounts via Wufoo form
- Students receive Customer Service Certificate upon completion of both parts`,

  certifications_adobe: `ADOBE CERTIFIED ASSOCIATE (ACA) (detailed):
Creative software certification through Adobe/Certiport.
- Modules: Photoshop, Illustrator, InDesign
- Module descriptors detail specific skills tested
- Exams administered through Certiport`,

  certifications_byag: `BRING YOUR A GAME ANYWHERE (detailed):
Work ethic and employability curriculum teaching the 7 A's:
1. Attitude — positive mindset and professionalism
2. Attendance — reliability and punctuality
3. Appearance — professional presentation
4. Ambition — goal setting and self-motivation
5. Accountability — taking responsibility
6. Appreciation — gratitude and team recognition
7. Acceptance — diversity and adaptability

- Video lessons for each module (classroom viewing)
- Exam: online practice test available, then proctored exam
- Certificate: request via Wufoo form after passing exam
- Exam account request: Wufoo form`,

  platform_gmetrix: `GMETRIX & LEARNKEY PLATFORM (detailed):
Primary certification preparation platform for IC3, MOS, and QuickBooks.

SETUP (step-by-step):
1. Register at certiport.pearsonvue.com (instructors, proctors, AND students)
2. Download Compass Test Software from certiport.pearsonvue.com/Support/Install/Compass
3. Use GMetrix Quick Start Guide for MOS practice tests
4. IC3 exam administration through Certiport portal
5. MOS exam vouchers: request via Wufoo form
6. Print certificates and score reports from Certiport portal

AVAILABLE RESOURCES:
- GMetrix practice tests (simulated exam environment)
- LearnKey video training (instructional content)
- MOS exam objectives: Word, Excel, PowerPoint, Outlook, Access
- IC3 technical requirements and disability accommodations
- Microsoft Digital Literacy Course (free)
- GMetrix proxy hours request form (Wufoo)`,

  platform_edgenuity: `EDGENUITY PLATFORM (detailed):
Online courseware for HSE (High School Equivalency) and academic subjects.
- Student login: auth.edgenuity.com/Login/Login/Student
- Educator login: auth.edgenuity.com/Login/Login/Educator
- Student-Led Conferences Guide available (Google Doc)
- IT Support and whitelist info: edgenuity.com/support/it-support
- Mobile compatible`,

  platform_essential_education: `ESSENTIAL EDUCATION — COMPUTER ESSENTIALS (detailed):
Digital literacy program teaching fundamental computer skills.
- Access: essentialed.com/start/wvde (WV-specific portal)
- Recommended browser: Firefox (download from mozilla.org)
- Live webinar schedule and recorded webinars available for training
- Leads to Computer Essentials Certificate of Achievement`,

  platform_burlington_english: `BURLINGTON ENGLISH (detailed):
ESL/English Language Learning platform for English Language Learners.
- Teacher login: burlingtonenglish.com
- Students receive Burlington English Certificate of Achievement or Certification
- Used for ESL instruction within SPOKES program`,

  platform_khan_academy: `KHAN ACADEMY (detailed):
Free math and academic courses platform.
- Login: khanacademy.org
- Individual student and activity overview reports available for tracking progress
- Used for math skills, academic preparation, and HSE readiness`,

  onboarding: `STUDENT ONBOARDING PROCESS (detailed):
New student orientation follows a structured checklist (SPOKES Checklist for Student Orientation and Intake).

REQUIRED FORMS (FY26):
1. Welcome Letter — program introduction
2. SPOKES Student Profile — personal information and background
3. Personal Attendance Contract — attendance expectations agreement
4. Rights and Responsibilities — student rights and program expectations
5. Dress Code Policy — professional appearance standards
6. Authorization for Release of Information — consent for data sharing
7. DoHS Release of Information — Department of Health Services consent
8. Media Release Form — consent for photos/videos
9. Technology Acceptable Use Policy — acceptable use of program technology
10. Employment Portfolio Checklist — portfolio document tracking
11. Learning Needs Screening Instrument — identify learning accommodations
12. CTE Learning Styles Assessment — identify preferred learning style
13. Non-Discrimination Notice — federal compliance notice
14. Password Log Template — secure password tracking

ADDITIONAL ORIENTATION:
- 4-week schedule orientation (two example schedules available)
- Career discovery conversation with Sage (replaces the former CFWV Career Exploration Worksheet)
- WorkKeys account creation instructions
- Sign-in sheet for daily attendance tracking`,

  dohs_forms: `DOHS / WV WORKS FORMS (detailed):
Forms related to the WV Department of Health and Human Services and WV Works program.

- DFA-TS-12 (Rev. 2-24): Activity tracking/time sheet — records daily activities and hours. Fillable version available.
- DFA-WVW-70 (Rev. 3-5-24): WV Works participant verification form (sample provided)
- DFA-WVW-25 (Rev. 6-24): Support services documentation and request
- DFA-PRC-1 (Rev. 1-24): Program completion record — documents program milestones
- DFA-SSP-1 (1-9-24): Support services plan — outlines support services for participant
- Support Services Fact Sheet (Rev. 6-22): Overview of all available support services through WV Works (transportation, childcare, work supplies, etc.)
- Prospective Employer Letter (ESP/EIP): Template letter for employer outreach and job development
- Dental Services 2025: Information about dental benefits available through WV Works`,

  ready_to_work: `READY TO WORK CERTIFICATION (detailed):
The Ready to Work Certificate is the standard goal for every SPOKES student. Instructors aim for all students to earn it. The certificate tiers (Attendance, Participation, Completion, Achievement) exist as fallbacks for students who exit early or don't reach all benchmarks — they are not separate tracks.

WHAT'S REQUIRED:
- Attendance benchmarks: meet the required hours documented on the Ready to Work Attendance Verification Form
- Core certifications: complete required SPOKES modules (IC3 Digital Literacy, ACT WorkKeys, Life & Employability Skills at minimum)
- Employment portfolio: resume, cover letter, professional references, work samples, certifications
- Job readiness demonstrations: mock interview, workplace skills assessment, job search portfolio (applications)
- Financial literacy and digital literacy modules
- SPOKES Module Record (FY26) — tracks completion of all required modules

TIMELINE CONTEXT:
- The program runs 4-to-10 weeks at 20-35 hours/week
- Even at minimum attendance (20 hrs/week), most students accumulate enough hours for RTW
- Students work on multiple tracks simultaneously during the 4-week SPOKES Cycle — not sequentially
- If a student doesn't quite reach all RTW benchmarks, their instructor may award a Certificate of Achievement or Participation instead

TRACKING FORMS:
- Ready to Work Attendance Verification Form — documents attendance hours
- SPOKES Module Record — tracks module completion
- Checklist for Documentation of Benchmarks — instructor verification of all requirements`,

  portfolio: `EMPLOYMENT PORTFOLIO (detailed):
Students build an Employment Portfolio throughout the program to demonstrate job readiness.
- Employment Portfolio Checklist (FY26, fillable PDF) — tracks required documents
- Portfolio includes: resume, certifications earned, work samples, references, cover letter
- Portfolio is a tangible deliverable students take to job interviews`,

  admin_resources: `ADMINISTRATOR/INSTRUCTOR RESOURCES (detailed):
Resources for SPOKES program administrators and instructors.

ON SCHOOLOGY:
- ABE Educator Evaluation Procedures
- Educator Evaluation Timeline
- Professional Growth & Development Plan Form
- Employee Acceptable Use Policy (AUP) — fillable
- Personnel Confidentiality Agreement — fillable
- Administrators Guide PY25
- 34 CFR 463.20(d) 13 Considerations (federal compliance)
- Additional Staff Request Justification FY2025

FORMS:
- Request for Training (Wufoo form)

HANDBOOK:
- 16 handbook sections on Schoology covering: WV Adult Ed Programs, Professional Development, Meeting Learner Needs, Enrollment, Barriers to Success, Assessment Procedures, Career Pathways, Standards-based Instruction, Individual & Group Plans, Retention & Marketing, Performance Standards, HSE Testing, LMS & Hours Documentation, ELL Instruction, Correctional Facility Teaching, SPOKES Program`,
};

/**
 * Maps keywords/phrases to topic content keys for on-demand injection.
 */
export const TOPIC_KEYWORDS: Record<string, string[]> = {
  certifications_ic3: ["ic3", "digital literacy", "computing core", "level 1", "level 2", "level 3", "computing fundamentals", "key applications", "living online", "master certification"],
  certifications_mos: ["mos", "microsoft office", "word certification", "excel certification", "powerpoint certification", "outlook certification", "access certification", "office specialist", "word", "excel", "powerpoint"],
  certifications_workkeys: ["workkeys", "work keys", "ncrc", "career readiness", "applied math", "workplace documents", "business writing", "bronze", "silver", "gold", "platinum", "o*net", "onet"],
  certifications_intuit: ["intuit", "quickbooks", "bookkeeping", "personal finance", "design for delight"],
  certifications_customer_service: ["customer service", "through the customer", "ttce", "skillpath"],
  certifications_adobe: ["adobe", "photoshop", "illustrator", "indesign", "aca"],
  certifications_byag: ["a game", "bring your a", "byag", "7 a's", "seven a", "attitude attendance appearance", "work ethic"],
  platform_gmetrix: ["gmetrix", "learnkey", "certiport", "compass software", "practice test", "exam voucher", "certification exam"],
  platform_edgenuity: ["edgenuity", "hse", "high school equivalency"],
  platform_essential_education: ["essential education", "computer essentials", "essentialed", "digital literacy program"],
  platform_burlington_english: ["burlington english", "burlington"],
  platform_khan_academy: ["khan academy", "khan"],
  onboarding: ["onboarding", "orientation", "new student", "enrollment", "intake", "first day", "sign up", "forms i need", "paperwork", "getting started", "dress code", "attendance contract", "welcome letter"],
  dohs_forms: ["dohs", "dfa", "wv works", "tanf", "snap", "support services", "time sheet", "activity tracking", "employer letter", "dental"],
  ready_to_work: ["ready to work", "rtw", "module record", "attendance verification", "benchmarks"],
  portfolio: ["portfolio", "resume", "employment portfolio", "job readiness", "cover letter"],
  admin_resources: ["administrator", "instructor resource", "evaluation", "professional development", "confidentiality", "aup", "acceptable use", "schoology handbook"],
};

// ---------------------------------------------------------------------------
// Document-based context from ProgramDocument (dynamic RAG layer)
// ---------------------------------------------------------------------------

import { prisma } from "@/lib/db";
import { cached } from "@/lib/cache";

interface SageDocument {
  id: string;
  title: string;
  sageContextNote: string | null;
  certificationId: string | null;
  platformId: string | null;
  audience: string;
}

type CallerRole = "student" | "staff";

async function loadSageDocuments(callerRole: CallerRole): Promise<SageDocument[]> {
  const cacheKey = `sage:documents:${callerRole}`;
  // Filter by audience: students only see STUDENT + BOTH; staff see all
  return cached(cacheKey, 300, () =>
    prisma.programDocument.findMany({
      where: {
        usedBySage: true,
        isActive: true,
        ...(callerRole === "student"
          ? { audience: { not: "TEACHER" } }
          : {}),
      },
      select: {
        id: true,
        title: true,
        sageContextNote: true,
        certificationId: true,
        platformId: true,
        audience: true,
      },
    }),
  );
}

interface SageSnippetRow {
  question: string;
  answer: string;
  keywords: string[];
}

async function loadSageSnippets(): Promise<SageSnippetRow[]> {
  return cached("sage:snippets", 300, () =>
    prisma.sageSnippet.findMany({
      where: { isActive: true },
      select: { question: true, answer: true, keywords: true },
    }),
  );
}

/**
 * Score a document against the user message using keyword matching
 * on title, certificationId, platformId, and sageContextNote.
 */
function scoreDocument(doc: SageDocument, messageLower: string): number {
  let score = 0;

  // Match title words (each word matched adds its length)
  const titleWords = doc.title.toLowerCase().split(/\s+/);
  for (const word of titleWords) {
    if (word.length >= 3 && messageLower.includes(word)) {
      score += word.length;
    }
  }

  // Match certificationId and platformId directly
  if (doc.certificationId && messageLower.includes(doc.certificationId.toLowerCase())) {
    score += doc.certificationId.length * 2; // higher weight for exact ID match
  }
  if (doc.platformId && messageLower.includes(doc.platformId.toLowerCase())) {
    score += doc.platformId.length * 2;
  }

  // Match keywords in sageContextNote (first 500 chars for better recall)
  if (doc.sageContextNote) {
    const noteWords = doc.sageContextNote.toLowerCase().slice(0, 500).split(/\s+/);
    for (const word of noteWords) {
      if (word.length >= 4 && messageLower.includes(word)) {
        score += 1; // lower weight for note matches
      }
    }
  }

  return score;
}

/**
 * Retrieve relevant program documents based on the user's message.
 * Returns formatted context string to inject into Sage's system prompt.
 *
 * Uses keyword matching on document titles, certification/platform IDs,
 * and sageContextNote content. Returns top 3 matches.
 *
 * Upgrade path: replace keyword matching with pgvector cosine similarity
 * if corpus grows beyond 200 documents. The function signature stays the same.
 */
function scoreSnippet(snippet: SageSnippetRow, messageLower: string): number {
  let score = 0;

  // Keyword matches: each match scores its length
  for (const keyword of snippet.keywords) {
    if (keyword.length > 0 && messageLower.includes(keyword.toLowerCase())) {
      score += keyword.length;
    }
  }

  // Question word matches: 2x weight
  const questionWords = snippet.question.toLowerCase().split(/\s+/);
  for (const word of questionWords) {
    if (word.length >= 3 && messageLower.includes(word)) {
      score += word.length * 2;
    }
  }

  return score;
}

const TOKEN_BUDGET_CHARS = 6000; // ~2,000 tokens at ~3 chars/token for Gemini

type ScoredDoc = { type: "doc"; id: string; label: string; content: string; score: number };
type ScoredSnippet = { type: "snippet"; label: string; content: string; score: number };
type ScoredEntry = ScoredDoc | ScoredSnippet;

function formatEntry(entry: ScoredEntry): string {
  if (entry.type === "doc") {
    return `[${entry.label}]\nLink: /api/documents/download?id=${entry.id}&mode=view\nSummary: ${entry.content}`;
  }
  return `[${entry.label}]: ${entry.content}`;
}

export async function getDocumentContext(
  userMessage: string,
  callerRole: CallerRole = "student",
  maxResults: number = 3,
): Promise<string> {
  const messageLower = userMessage.toLowerCase();

  const [docs, snippets] = await Promise.all([
    loadSageDocuments(callerRole),
    loadSageSnippets(),
  ]);

  const scoredDocs: ScoredEntry[] = docs
    .map((doc) => ({
      type: "doc" as const,
      id: doc.id,
      label: doc.title,
      content: doc.sageContextNote || doc.title,
      score: scoreDocument(doc, messageLower),
    }))
    .filter((entry) => entry.score > 0);

  const scoredSnippets: ScoredEntry[] = snippets
    .map((snippet) => ({
      type: "snippet" as const,
      label: `Q&A: ${snippet.question}`,
      content: snippet.answer,
      score: scoreSnippet(snippet, messageLower),
    }))
    .filter((entry) => entry.score > 0);

  let combined = [...scoredDocs, ...scoredSnippets]
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);

  if (combined.length === 0) return "";

  // Enforce token budget — drop lowest-scoring entries until under budget
  let totalChars = combined.reduce((sum, e) => sum + formatEntry(e).length, 0);
  while (totalChars > TOKEN_BUDGET_CHARS && combined.length > 1) {
    combined = combined.slice(0, -1);
    totalChars = combined.reduce((sum, e) => sum + formatEntry(e).length, 0);
  }

  const content = combined.map(formatEntry).join("\n\n");

  return `\n\nPROGRAM DOCUMENT REFERENCE (use this for specific, accurate answers about program materials):\n${content}`;
}

/**
 * Given a user message, find matching topics and return additional context to inject.
 * Returns empty string if no topics match (Sage uses base knowledge).
 * Limits to top 3 most relevant topics to avoid context bloat.
 */
export function getRelevantContent(userMessage: string): string {
  const messageLower = userMessage.toLowerCase();
  const matches: { topic: string; score: number }[] = [];

  for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
    let score = 0;
    for (const keyword of keywords) {
      if (messageLower.includes(keyword)) {
        score += keyword.length; // longer matches = more specific = higher score
      }
    }
    if (score > 0) {
      matches.push({ topic, score });
    }
  }

  if (matches.length === 0) return "";

  // Sort by relevance score, take top 3
  matches.sort((a, b) => b.score - a.score);
  const topMatches = matches.slice(0, 3);

  const content = topMatches
    .map((m) => TOPIC_CONTENT[m.topic])
    .filter(Boolean)
    .join("\n\n---\n\n");

  return content ? `\n\nDETAILED REFERENCE (use this to give specific, accurate answers):\n${content}` : "";
}
