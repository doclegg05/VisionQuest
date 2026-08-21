# Phase A Inventory — Sage Career-Grounding Ingestion Manifest

**Date:** 2026-07-09 (amended 2026-07-23 — F4 bridge-descriptor comparison)
**Author:** Phase A dedup/manifest synthesizer (subagent)
**Status:** DRAFT — Phase A §6 decisions complete 2026-07-23 (incl. #14 three-layer cert architecture for future sprints; persistence = profile fields + per-student `.md`; WIOA Referral → `teachers/`/TEACHER). Nothing uploaded, synced, or committed. Next: Phase B staging per §1 + decisions.
**Inputs merged:** (1) machine sweep, (2) VisionQuest-orientation-packet worktree scan, (3) live ProgramDocument enumeration (513 rows; full dataset at `C:/Users/INSTRU~1/AppData/Local/Temp/claude/ragrows-out.json` + `ragrows-lines.jsonl`, reproducible via `node tmp-career-a-ragrows.mjs` from the VisionQuest root), (4) repo staging state (docs-upload/, catalog/, allowlist, ingest-pipeline brief).

**Verification performed by this synthesizer (read-only):**
- Fuzzy-matched all high/medium discovered files against the FULL 513-row RAG dataset (not just the 260-row truncated payload) via grep over `ragrows-lines.jsonl`.
- SHA256 + page-count + text-extraction comparison of the two local ECP FY25 renditions (program form — not student PII, permitted to inspect).
- **Amendment 2026-07-23:** SHA256 + text-extract (DOCX) + page-image inspection (PDF) comparison of `Career_Pathways_Bridge_Descriptors2020.docx` vs RAG/staged `IETP Description of Adult Education Bridge Programs.pdf` — program descriptors, not student PII.
- No piiRisk-flagged file contents were opened (FERPA) — path/metadata only.
- **Redaction (2026-07-09):** student-named record paths are withheld from this tracked file; full paths live in `phase-a-pii-appendix.local.md` (untracked, guarded by `.git/info/exclude`).

---

## Summary Counts

| Bucket | Count | Notes |
|---|---|---|
| newCandidates | 15 | genuinely RAG-worthy career-counseling material, absent from RAG and docs-upload |
| alreadyInRag | 18 | incl. the hinted ECP fuzzy duplicate (confirmed) + Bridge Programs PDF (§2.18 / F4) |
| alreadyStaged (only) | 0 | every staged match also has a live ProgramDocument row, so they land in alreadyInRag |
| skipped | 28 entries (some grouped) | each with an explicit reason — no silent drops |
| piiRisk paths (appendix) | 12 | metadata only, never ingestable without Britt's review |

---

## 1. New Candidates (propose for Phase B staging)

Folder names are the REAL docs-upload folders (`students` → bucket `students/resources`; `forms` → `forms`; `presentation` → `presentations` per FOLDER_MAP).

| # | Path | Folder | Slug | Audience | Rationale |
|---|---|---|---|---|---|
| 1 | `C:\Users\Instructor\OneDrive - WV Department of Education\Desktop\Student Folder\New Student Orientation Paperwork\PDF\CFWV Career Exploration Worksheet.pdf` (98,196 B, 2026-04-21) | students | `cfwv-career-exploration-worksheet` | STUDENT | Blank CFWV career-exploration worksheet used at enrollment. No RAG equivalent — closest instrument is `Career_Interest_Activity_FY_22.pdf` (Section 7/ECP), a different doc. |
| 2 | `C:\Users\Instructor\OneDrive - WV Department of Education\Desktop\Student Folder\Career Discovery Prompts.pdf` (4,305,696 B, 2026-03-10) | students | `career-discovery-prompts` | STUDENT | Recent AI-assisted career-discovery prompt set — directly reusable by Sage. Zero "discovery"/"exploration" rows in RAG. |
| 3 | `C:\Users\Instructor\OneDrive - WV Department of Education\Desktop\Britt Legg\End of Month Report Forms\Contacts and Info\Region 1 Demand Occupation List 2024.pdf` (133,944 B) | students | `region-1-demand-occupation-list-2024` | BOTH | Current WIOA Region 1 in-demand occupations — the only labor-market-data document found anywhere; RAG has none ("Occupation"/"Demand" = 0 rows). |
| 4 | `C:\Users\Instructor\OneDrive - WV Department of Education\Desktop\Britt Legg\SPOKES Handbook\SPOKES Life and Employability Skills Curriculum.pdf` (1,923,379 B, 2025-06-05) | students | `spokes-life-employability-skills-curriculum` | BOTH | Full curriculum master. RAG holds only the 1-page Module Descriptor (`lms/certifications/program-info/...Module Descriptor.pdf`) and the Rubric Record — NOT the curriculum itself (verified against all 513 rows). |
| 5 | `C:\Users\Instructor\Dev\curriculum\Employability Skills Curriculum\lesson-employee-accountability\Handouts\Handout_5_Career_Planning.pdf` (36,105 B, 2026-03-24) | students | `handout-5-career-planning` | STUDENT | Career-planning worksheet; latest curriculum-repo copy. No career-planning handout in RAG. |
| 6 | `C:\Users\Instructor\Dev\curriculum\Employability Skills Curriculum\lesson-employee-accountability\Handouts\Handout_4_SMART_Goal.pdf` (37,856 B, 2026-03-24) | students | `handout-4-smart-goal` | STUDENT | SMART-goal worksheet aligned with VisionQuest's goal-setting core loop; RAG goal docs are teacher-facing only (`WVAdultEd_Goal-setting-guidance`, `Goal Setting Connecting the Dots`). |
| 7 | `C:\Users\Instructor\Dev\curriculum\Employability Skills Curriculum\lesson-interview-skills\Handouts\STAR_Interview_Worksheet.pdf` (276,279 B, 2026-03-05) | students | `star-interview-worksheet` | STUDENT | Interview-prep (STAR method) worksheet; RAG has zero interview-prep content ("STAR"/"Interview" student-side = 0). |
| 8 | `C:\Users\Instructor\Dev\curriculum\Employability Skills Curriculum\lesson-interview-skills\Handouts\ChatGPT Interview Practice Prompts.pdf` (453,906 B, 2026-03-05) | students | `ai-interview-practice-prompts` | STUDENT | AI interview-practice prompt set — directly consumable by an AI coach; no equivalent in RAG. |
| 9 | `C:\Users\Instructor\OneDrive - WV Department of Education\Desktop\Student Folder\WIOA\New WIOA Fact Sheet 7.11.24.pdf` (110,643 B) | students | `wioa-fact-sheet-2024` | BOTH | Current student-facing WIOA overview. RAG's only WIOA docs are teacher-side (34 CFR 463.20(d) considerations; 2015 ESOL/WIOA pptx). |
| 10 | `C:\Users\Instructor\OneDrive - WV Department of Education\Desktop\Student Folder\WIOA\WIOA Referral Form.pdf` (103,204 B, blank) | teachers | `wioa-referral-form` | TEACHER | Blank WIOA partner referral form — **instructor profiles only** (Q3). Stage under `teachers/` / TEACHER; students must not retrieve it. |
| 11 | `C:\Users\Instructor\OneDrive - WV Department of Education\Documents\IETP Development\Not needed for presentation\Career_Pathways_Bridge_Descriptors2020.docx` (1,659,576 B, sha256 `5BCC4104…9DB478`) | students | `career-pathways-bridge-descriptors-2020` | BOTH | **Same content as RAG PDF (F4), but the only text-extractable rendition.** Word source of the 8-level bridge continuum (Pre-Bridge → IELCE IET). Keep as candidate because the live RAG copy is an image-only Schoology print with **zero extractable text** — Sage cannot ground on it today. Prefer staging this DOCX (or a fresh text-PDF export) over re-ingesting the image PDF. Filename says 2020; PDF footer is "Revised April 2023" — content structure matches page-for-page; currency delta is revision date only (see §5 F4). |
| 12 | `C:\Users\Instructor\OneDrive - WV Department of Education\Documents\IETP Development\IET Workshop\Nicholas_County_IET_Food_Service_Management_with_CTE_Career_Pathway (1) (1).docx` (41,564 B, 2021) | students | `nicholas-county-iet-food-service-pathway` | BOTH | Concrete LOCAL career-pathway example (Nicholas County = Britt's Summersville site). Dated 2021 — currency check flagged in Open Questions. |
| 13 | `C:\Users\Instructor\Dev\curriculum\Career Pathways and Integrated Education and Training Programs Update\fy27-updates-video\transcripts\fy27-updates-final-transcript.md` (3,746 B, 2026-06-24) | presentation | `fy27-career-pathways-updates-transcript` | BOTH | Text-ready transcript of the FY27 career-pathways/IETP policy update — newest pathway policy content anywhere in the corpus. Supersedes ingesting the pptx draft. |
| 14 | `C:\Users\Instructor\Dev\curriculum\SPOKES Goal Setting Project\Student Portfolios\Certifications\SPOKES\SPOKES_Certifications.docx` (54,743 B) | students | `spokes-certifications-catalog` | BOTH | Single catalog of SPOKES certification tracks — core coaching reference. RAG has per-cert Module Descriptors + `SPOKES Modules 2025` (teacher-side) but no unified student-facing catalog. Must be reconciled with the hardcoded cert list in `src/lib/sage/knowledge-base.ts` (Open Questions). |
| 15 | `C:\Users\Instructor\OneDrive - WV Department of Education\Desktop\Student Folder\WIOA\WIOA Partner Job Trainings\Pub_PathwaySccss_Flier_DEVO_AIM.pdf` (530,232 B) | students | `pathway-to-success-training-flier` | BOTH | WIOA-partner job-training option (Pathway to Success / DEVO AIM) — counseling-relevant training info. Caveat: flier format may yield little extractable text. |

Phase B per candidate: copy into `docs-upload/<folder>/`, author `catalog/documents/<slug>.md` (vq_status: approved), add the `documents: <storageKey>` allowlist key, then Britt executes upload + sync (governed).

---

## 2. Already in RAG (matched ProgramDocument rows)

| # | Discovered path | Matched title (storageKey) | Match basis | Confidence |
|---|---|---|---|---|
| 1 | `...\Britt Legg\Fillable Forms\SPOKES_ECP_FY25_-_Fillable.pdf` (1,387,019 B) | **ECP AE and SPOKES** (`teachers/guides/Handbook Appendix/Section 7/ECP/ECP_AE_and_SPOKES_Fillable_FY25.pdf`) | fuzzy-title + content-verified (see §5) | HIGH on purpose; bytes NOT identical |
| 2 | `...\New Student Enrollment Forms\ECP AE and SPOKES FY 25.docx` (102,727 B) | ECP AE and SPOKES (same row) | fuzzy-title (near-exact token match; Word source) | HIGH |
| 3 | `...\New Student Orientation Paperwork\(10)SPOKES_ECP_FY25.pdf` (1,310,013 B) | ECP AE and SPOKES (same row) | fuzzy: same form, different rendition | HIGH |
| 4 | `C:/Users/Instructor/Dev/VisionQuest-orientation-packet/(10)SPOKES_ECP_FY25.pdf` (1,310,013 B) | ECP AE and SPOKES (same row) | fuzzy + sha256-verified DIFFERENT bytes, content-equivalent (see §5) | HIGH |
| 5 | `...\SPOKES Handbook\SPOKES Life and Employability Module Rubric Record-2.pdf` (722,000 B) | SPOKES Life and Employability Module Rubric Record (`students/resources/...` active; `forms/...` inactive, 687,818 B) | fuzzy-name ("-2" suffix); size close but unequal — likely minor revision | HIGH on purpose, MEDIUM on revision parity |
| 6 | `...\SPOKES Handbook\Creating a WorkKeys Account for Students -1.pdf` (589,850 B) | Creating Student WorkKeys Account (`teachers/guides/...`) | fuzzy-title | HIGH |
| 7 | `...\Dev\curriculum\...\ACT WorkKeys\Creating_Student_WorkKeys_Accounts.docx` (21,362 B) | Creating Student WorkKeys Account (same row; Word source) | fuzzy-title | HIGH |
| 8 | `...\Employability Skills Background\Employability_Skills_Framework_Checklist.pdf` (69,919 B) | Employability Skills Framework Checklist (Section 7 IETP + Section 8 rows) | exact-name (bytes unverified — OneDrive copy) | HIGH |
| 9 | `...\IETP Development\IET Workshop\Employability_Skills_Framework_AE_Poster.pdf` (345,265 B) | Employability Skills Framework AE Poster (Section 7 IETP + Section 8 rows) | exact-name | HIGH |
| 10 | `...\Dev\curriculum\...\Portfolio Blank Forms\Employment_Portfolio_Checklist_FY25_Fillable.pdf` (131,834 B) | Employment Portfolio Checklist FY26 Fillable (`orientation/...` active, 131,842 B) | fuzzy: FY26 supersedes FY25; near-identical size | HIGH |
| 11 | `...\Dev\curriculum\...\Portfolio Blank Forms\Support_Services_Fact_Sheet_Rev_6-22.pdf` (214,050 B) | Support Services Fact Sheet Rev 6 22 (`forms/...`, 214,050 B) | exact-name + exact size | HIGH |
| 12 | `...\Dev\curriculum\SPOKES Goal Setting Project\Student Portfolios\Prospective_Employer_Letter_ESP_EIP.docx.pdf` (265,250 B) | Prospective Employer Letter ESP EIP.docx (`forms/...`, 265,250 B) | exact-name + exact size | HIGH |
| 13 | `...\Certifications\Ready to Work\Documentation_Benchmarks_-_Ready_to_Work.docx` (23,989 B) | Checklist for Documentation of Benchmarks Certificate of Ready to Work (`lms/Ready to Work/...`) | fuzzy-title + purpose | HIGH-MEDIUM |
| 14 | `...\Certifications\Certificate of Achievement\Documentation_Benchmarks_-_Achievement.docx` (23,460 B) | Checklist for Documentation of Benchmarks Certificate of Achievement (`lms/Ready to Work/...`) | fuzzy-title + purpose | HIGH-MEDIUM |
| 15 | `...\Certifications\Ready to Work\Ready_To_Work_Certificate_Sample.docx` (277,564 B) | Ready to Work Certficate (`lms/Ready to Work/...`, 214,507 B) | fuzzy: same sample-certificate purpose | MEDIUM |
| 16 | `...\Certifications\SPOKES\Sample_SPOKES_Schedule_Class_Management_Options.docx` (31,079 B) | Sample SPOKES Schedule Class Management Options (`lms/certifications/program-info/...`) | exact-title, different format | HIGH |
| 17 | `...\Certifications\Customer Service\Customer_Service_Part_1_and_2.docx` (184,934 B) | TTCE suite: Part 1/2 Descriptors + Customer Service Part 1 and 2 Certificate (`lms/Through the Customer's Eyes.../...`) | fuzzy: cert-track content fully covered by the TTCE row set | MEDIUM |
| 18 | `docs-upload\teachers\Handbook Appendix\Section 7\Integrated Education and Training Program\IETP Description of Adult Education Bridge Programs.pdf` (1,715,367 B, sha256 `FED2B82D…EBE9AE`; staged mirror of live bucket) | **IETP Description of Adult Education Bridge Programs** (`teachers/guides/Handbook Appendix/Section 7/Integrated Education and Training Program/IETP Description of Adult Education Bridge Programs.pdf`, id `cmmyyeoje00byeadksh1l0zrq`, TEACHER_GUIDE / TEACHER, active) | exact-title + staged path; content-verified identical to candidate #11 Word source (see §5 F4) | HIGH on identity; **LOW on RAG usability** (image-only PDF — no text layer) |

---

## 3. Already Staged (docs-upload only, no RAG row)

**None.** Every discovered file found under `docs-upload/` also has a live ProgramDocument row (docs-upload mirrors the bucket post-PR #110), so all such matches are classified in §2. Noted so the empty bucket is explicit, not a silent drop.

---

## 4. Skipped (with reasons — no silent drops)

| # | Path | Reason |
|---|---|---|
| 1 | `...\Sub Project\SPOKES_ECP_FY23_-_Fillable.pdf` | Superseded — FY25 ECP already in RAG (§2.1). |
| 2 | `...\Substitute Folder\Student Folder\Enrollment Forms\SPOKES_ECP_FILLABLE_FY22.pdf` | Superseded FY22 version; RAG also holds the WV SDT ECP FY22 variants. |
| 3 | `...\New Student Orientation Paperwork\CFWV Career Exploration Worksheet.docx` | Word source of candidate #1 — ingest one canonical rendition (the 2026-04-21 PDF). |
| 4 | `C:\Users\Instructor\Dev\curriculum\_student-records\...\Student Resumes_AI\Career_Discovery_Gemini_Prompts.docx` | piiRisk path (under `_student-records`); contents NOT opened (FERPA). Likely duplicate of candidate #2 — Britt must confirm it is generic before any use. |
| 5 | `...\WIOA Partner Job Trainings\Region-1-Demand-Occupation-List-2022.pdf` | Superseded by the 2024 list (candidate #3). |
| 6 | `...\Dev\curriculum\...\Certifications\SPOKES\SPOKES_Life_and_Employability_Skills_Curriculum.docx` | Word source of candidate #4; PDF master is canonical. |
| 7 | `...\Dev\curriculum\...\ACT WorkKeys\ACT_WorkKeys_Certificate_Sample.docx` | Sample certificate image — negligible extractable counseling text; WorkKeys/NCRC info already in RAG (lms/Ready to Work suite). |
| 8 | `...\Employee Accountability v2.5\Handout_5_Career_Planning.docx` | Word source of candidate #5. |
| 9 | `...\Employee Accountability v2.5\Fillable PDF Handouts\PDF Handouts\Handout_5_Career_Planning_Fillable.pdf` | Fillable variant of candidate #5 — one canonical rendition proposed. |
| 10 | `...\Student Folder\Student Files\Student Homework\Career_Pathfinder_Day_3_Assignment.docx` | piiRisk (Student Homework folder); NOT opened. Named like a blank assignment — Britt must confirm blank before staging. |
| 11 | `...\IETP Development\Not needed for presentation\Documenting_Adult_Career_Pathways_and_IETP_in_LACES_FY22.docx` | LACES admin/reporting guidance — not counseling material. |
| 12 | `...\Dev\curriculum\Restuarant Management IETP\...\CCRS Alignment Table – Food & Hospitality Pathway (Summersville Adult Education).docx` | Standards-alignment curriculum-design artifact, not counseling content. |
| 13 | `...\IETP Development\Not needed for presentation\Side-by-Side_WIA_WIOA.pdf` | 2015-era policy comparison; superseded by the WIOA fact sheet (candidate #9). |
| 14 | `...\Monthly Report Guidance\WIOA Effectiveness in Serving Employers.pdf` | Employer-metrics reporting guidance — teacher/admin-side only. |
| 15 | `...\WIOA\Partner Meetings\WIOA Partner Meeting 12.23.docx` | Meeting notes, low relevance, piiRisk (may name individuals); NOT opened. |
| 16 | `...\Ready to Work Certification\Blank_Employability Skills Certificate.docx` | Blank certificate template; RAG already carries the full certificate suite. |
| 17 | `...\lesson-interview-skills\Handouts\Interview Skills Lesson Plan.pdf` | Teacher delivery plan, not counseling source; the student-facing handouts are candidates #7–8. |
| 18 | `...\lesson-employee-accountability\Handouts\Employee_Accountability_Module_Lesson_Plan_4.7.pdf` | Same reason as #17. |
| 19 | `C:\Users\Instructor\Dev\curriculum\SPOKES Goal Setting Project\SPOKES_Goal_Tracker.xlsx` | piiRisk (may hold live student names; NOT opened) AND xlsx has no text-extraction path in ingest (pdf/docx/txt/md only). |
| 20 | `...\Career Pathways and Integrated Education and Training Programs Update\Sources\FY27 Updates video draft.pptx` | Deck superseded by its final transcript (candidate #13); pptx bodies are not chunk-extracted by ingest. |
| 21 | `...\Student Portfolios\<student-redacted>\Healthcare_Career_Guide.docx` (full path: local PII appendix) | piiRisk — inside a named student's portfolio, possibly personalized; NOT opened. If Britt confirms generic, it is a strong occupation-guide candidate (Open Questions). |
| 22 | `...\lesson-communicating-with-the-public\Teacher-Resources\Communicating_With_the_Public_Teachers_Guide.pdf` | Teacher module guide (10 MB) — employability curriculum, not career counseling. |
| 23 | `...\lesson-time-management\Handouts\SPOKES_Time_Management_Self_Assessment.pdf` | Employability-module self-assessment, not career counseling. Noted as the closest on-disk thing to an interest instrument — the real gap is flagged in Open Questions. |
| 24 | GROUP: `...\lesson-problem-solving...\Problem_Solving_Styles.pdf`, `...\lesson-controlling-anger\Styles-of-Anger-Assessment-Handout.pdf` | Low-relevance soft-skill style assessments (per sweep). |
| 25 | GROUP: `...\Obsidian Vault\Projects\Employability Skills Curriculum.md`, `...\ACE 508\Career_Readiness_Paper_COLOR.pdf` | Low relevance: project meta-note; Britt's personal coursework — not program source material. |
| 26 | GROUP (real student records — FERPA, metadata only, NEVER ingestable): 7 files (WIOA referral forms + WorkKeys results) | Student-named filenames/paths withheld from this tracked manifest — see the untracked local PII appendix. |
| 27 | `C:/Users/Instructor/Dev/VisionQuest-orientation-packet/JOURNAL.md` + `handoff.md` | Agent decision journal / session handoff — repo docs, not counseling source. |
| 28 | GROUP: orientation-worktree low-relevance repo files (`CLAUDE.md`, `AGENTS.md`, `README.md`, `DEPLOY.md`, `.impeccable.md`, `docs/VisionQuest_Annual_Cost_Analysis_2026.pdf`, `docs/VisionQuest_Regional_Rollout_Report.pdf`) | Project docs / internal reports — not orientation/career source material. |

Inherited exclusions from the discovery agents (VUB financial-readiness records, ~35 unitemized lesson handouts, ~15 cert descriptors represented by two entries, Substitute-Folder/_student-records/dist mirrors, filename-only search limits) remain in force and are documented in their outputs; nothing further was dropped by this synthesis.

---

## 5. Fuzzy-Duplicate Findings (the hunt Britt asked for)

**F1 — CONFIRMED: the SPOKES ECP FY25 packet is already in the RAG under a different filename and title.**
- RAG row: id `cmmyyedu000b7eadkgzzxdfjb`, title **"ECP AE and SPOKES"**, storageKey `teachers/guides/Handbook Appendix/Section 7/ECP/ECP_AE_and_SPOKES_Fillable_FY25.pdf`, category TEACHER_GUIDE, audience **TEACHER**, active.
- Local staged copy: 320,361 B, **1 page**, sha256 `2A3D4E541BE72AB8CE680411CDDD7A10D9317A17DC39AF06228396437B12759D`.
- Discovered orientation rendition (worktree `(10)SPOKES_ECP_FY25.pdf`): 1,310,013 B, **2 pages**, sha256 `6E96B678B64BD4C0F95502AA5A2826E6423D01935B26CF6653A2C3AA2C2CDA9A` — NOT byte-identical.
- Text extraction of the staged 1-pager confirms it carries the SAME content: HOW YOU SEE YOURSELF self-assessment, CAREER CHOICE (dream job / preparation / job outlook / average salary / career cluster), portfolio checklist, and a **CareerOneStop interest-profiler pointer** (`www.careeronestop.org`). Content-equivalent; layout/rendition differs.
- Consequence: none of the four discovered ECP FY25 copies is new content. BUT the only RAG copy is filed **TEACHER_GUIDE / audience TEACHER** — Sage's student-context retrieval may never surface it (Open Question Q1).

**F2 — Section 7/ECP already contains a career-instrument suite.** `Career Interest Activity`, `Strengths Inventory`, `Transferable Skills`, `Work Values`, `Know what you want to learn chart`, `Instructions for Completing the ECP` are all live rows — all audience TEACHER. The machine sweep's "no interest instruments exist" finding is true for O*NET/RIASEC but the ECP suite partially fills the role, on the wrong audience side.

**F3 — Other fuzzy matches** (details in §2): FY25 portfolio checklist → FY26 row (#10); "Rubric Record-2" → Rubric Record rows (#5); WorkKeys account guides docx/pdf → one teacher row (#6–7); Documentation Benchmarks docx pair → "Checklist for Documentation of Benchmarks..." rows (#13–14); Customer Service Part 1&2 docx → TTCE suite (#17).

**F4 — CORRECTED (2026-07-23): same document, two renditions — prior "different doc" call was wrong.**

Side-by-side of the two files Britt asked to compare:

| | Local Word source (candidate #11) | Staged / RAG PDF (§2.18) |
|---|---|---|
| Path | `...\IETP Development\Not needed for presentation\Career_Pathways_Bridge_Descriptors2020.docx` | `docs-upload\teachers\...\IETP Description of Adult Education Bridge Programs.pdf` (+ live ProgramDocument row) |
| Size / hash | 1,659,576 B · sha256 `5BCC410434AEB335148ADE20CEAD1E574DA3C90B3E1678FC5DFB532DA29DB478` | 1,715,367 B · sha256 `FED2B82D2599AAA622B417562B1DB01C5E95BFB76409E216CFC8F4416FEBE9AE` |
| Format | DOCX (full extractable text — 201 non-empty lines) | PDF, **8 pages, image-only** (Chrome/Skia print from Schoology "WVAdultEd Teacher Group - Resources"; each page = one 816×1056 RGB image; `pypdf` text extract = empty) |
| Title on face | "Descriptions of Adult Education Bridge programs" | "DESCRIPTIONS OF ADULT EDUCATION BRIDGE PROGRAMS" (same string) |
| Revision cue | Filename says 2020; filesystem mtime 2021-11-29 | Footer on every page: **"Revised April 2023"**; PDF CreationDate 2026-03-18 (download/print date, not content date) |
| Structure | Pre-Bridge → Bridge Prep → Bridge I → Bridge II → IETP → IELCE IET | Same continuum, one level per page (pp. 1–8); p.8 ends on Jefferson County IELCE IETP Healthcare Careers |
| Sample identity checks | Intro sentence, Pre-Bridge EFL 1–6 / ESL 7–12 entry points, Bridge Prep "Earn by Day Learn by Night" / "The Details of Retail", Bridge II county LPN models, IELCE close | Page-image OCR of pp. 1–2 + 8 matches those passages verbatim |

**Verdict:** content-equivalent descriptor set (not two different docs). The PDF is the newer-dated *layout* (Apr 2023); the DOCX is the older-named *text source*. Bytes are not identical (expected — Word vs image PDF).

**Consequence for Phase B:**
1. Do **not** treat candidate #11 as net-new counseling prose — it is the text twin of §2.18.
2. **Do** still stage the DOCX (or export a text PDF from it) because the live RAG PDF contributes **no extractable text** today — Sage cannot retrieve bridge-level / EFL / next-step facts from it.
3. Audience gap mirrors F1: RAG row is TEACHER_GUIDE / TEACHER; student-facing coach grounding wants a STUDENT (or BOTH) row under `students/`.
4. Catalog node `catalog/documents/career-pathways-bridge-descriptors2020.md` still says the PDF is "a different, shorter description document" — that claim is stale and should be corrected when Phase B touches the OKF node (governed; not edited in this Phase A pass).

---

## 6. Open Questions for Britt

1. **ECP audience gap (from F1):** ~~the only ECP FY25 row is TEACHER_GUIDE/TEACHER. For career grounding of a *student-facing* coach, should Phase B stage the 2-page fillable ECP under `students/` (or `orientation/`) as a student-audience row, rather than relying on the teacher-side copy?~~
   - **DECIDED (2026-07-23, affirmed later same day):** Students need access to `ECP_AE_and_SPOKES_Fillable_FY25`. Stage under **both** `students/` (ongoing recall/update throughout the class) **and** `orientation/` (cohort kickoff). Main career-and-education exploration document — present at cohort start; student-retrievable and updatable across the term. Do not rely on the teacher-side RAG copy alone.
2. **piiRisk confirmations / Sage interview wiring:** `Career_Discovery_Gemini_Prompts.docx`, `Career_Pathfinder_Day_3_Assignment.docx`, `Healthcare_Career_Guide.docx`, `SPOKES_Goal_Tracker.xlsx`.
   - **DECIDED (2026-07-23):** All four cleared of piiRisk (blank/generic/template). Wire interview instruments into the Sage interview flow.
   - **Persistence (2026-07-23):** **Both, roles split.** Structured **profile fields** for anything queried later (career cluster, interest codes, ECP answers, goals, cert preferences). Plus **one per-student `.md` narrative** on the profile that Sage appends after interviews (coaching summary: what we learned, open questions, next steps). Fields = system of record; `.md` = human-readable story — not the reverse.
   - **Career-cluster scaffolding (2026-07-23):** Each student is scaffolded into interest/career-cluster **buckets** from the interest profiler + career-cluster identifier on the **CareerOneStop pathway**. Sage matches the student to a cluster first; occupation guides are **gated by that match** — e.g. `Healthcare_Career_Guide` is used **only when** the student matched the Healthcare career cluster (not as a generic always-on RAG doc). Same pattern expected for other cluster-specific guides as they appear. **Depends on Q5 / COS–O*NET access** for the profiler + cluster identifier; until then, cluster bucketing cannot run live.
3. **WIOA Referral Form folder / audience:** proposed `forms/` (beside STUDENT_REFERRAL DFA rows)?
   - **DECIDED (2026-07-23, revised same day):** **Instructor profiles only.** Not a student form — student profiles must not retrieve or see it. Sage may use it only in instructor-designated sessions. **Stage under `teachers/` with TEACHER audience** (not `forms/` — avoids sitting beside student-facing referral blanks and picking up the wrong audience default).
4. **Audience mechanics:** folder-derived vs per-doc by purpose?
   - **DECIDED (2026-07-23, revised same day):** Audience follows **document purpose / user type**, not a blind folder map. Drill-down for the former BOTH candidates:
     | Doc | Audience / use |
     |---|---|
     | Region 1 Demand Occupation List | **BOTH** — student + instructor |
     | WIOA Fact Sheet | **Instructor / policy** only |
     | SPOKES Certifications catalog (#14) | **Primarily Sage reference**; also useful for students + instructors as presentation / course-selection offer material |
     | SPOKES Curriculum master | **Same pattern as cert catalog** — Sage reference + student/instructor presentation / course-selection |
     | Bridge descriptors DOCX (#11) | **IETP-only** — not general SPOKES career counseling; use only in IETP course context |
   - Phase B: place/folder + `vq_audience` must match the row above (override folder defaults when they disagree).
5. **Interest-assessment gap:** O*NET / RIASEC / CareerOneStop?
   - **DECIDED (2026-07-23):** **Skip for now** until O*NET / CareerOneStop access is available. ECP pointer remains; no printable instrument in Phase B.
6. **Bridge descriptors / overlaps (F4):** candidate #11 vs RAG Bridge-Programs PDF; candidate #14 vs `SPOKES Modules 2025` + `src/lib/sage/knowledge-base.ts`.
   - **#11 DECIDED (2026-07-23):** Same continuum as image-only RAG PDF — **stage DOCX under `students/`**; Phase B corrects stale catalog "different document" claim.
   - **#14 DECIDED (2026-07-23):** **Option 1 + three-layer cert-offer architecture** (Britt approved; implement across future sprints). Goal: one current-year source of truth; no confusion when other docs still name retired courses; classroom specialization without editing the base list.
     1. **Layer 1 — Base catalog (Phase B now):** Stage `SPOKES_Certifications.docx` as the FY-versioned program-wide offer (core vs elective certs; later revisions add a **Retired** tombstone section with retirement year). Slim `SPOKES_KNOWLEDGE` in `knowledge-base.ts` so the enumerated cert list defers to the catalog — stable program facts stay hardcoded; the churning offer does not. Precedence rule for Sage: *current-year Certifications catalog is authoritative for what is offered; if any other document names a cert not in the current catalog, treat it as historical.* Annual update = revise catalog → upload → sync → deactivate prior-year row (do not delete).
     2. **Layer 2 — Classroom overlay (Phase C / future sprint):** New classroom/site model + instructor UI so a classroom can emphasize or offer electives on top of the core set. Overlay may **add/emphasize, never remove a core cert**. Structured data (not another RAG doc) so instructors don't need the governed upload pipeline and Sage can read it as clean facts. No Classroom/Site model exists in schema today — this is a real build.
     3. **Layer 3 — Student profile:** Interview answers, career-cluster match (CareerOneStop / Q5), goals, records.
     4. **Assignment logic (Phase C, with Layer 2 + COS):** Sage computes `base catalog ∩ classroom overlay`, ranked by student cluster + goals (structured lookup). RAG supplies how-to prose after candidates are chosen — not the decision list itself. `SPOKES Modules 2025` stays teacher-side module planning; it is not the cert-offer catalog.
7. **Currency check:** candidate #12 (Nicholas County IET food-service pathway) dated 2021?
   - **DECIDED (2026-07-23):** **Still valid.** Keep as local pathway example for Summersville/Nicholas County counseling.
8. **Rubric Record revision:** discovered "-2" rubric (722,000 B) vs RAG copy (687,818 B)?
   - **DECIDED (2026-07-23):** **Yes — refresh** the bucket with the "-2" revision (supersedes the live RAG copy).

---

## 6a. Decision log (2026-07-23) — open questions

| Q | Outcome | Follow-up still needed? |
|---|---|---|
| 1 ECP audience | Students need `ECP_AE_and_SPOKES_Fillable_FY25`; dual-stage `students/` + `orientation/` | Phase B staging |
| 2 piiRisk ×4 + interview | Cleared; wire interview instruments; **profile fields + per-student `.md`** (fields = SoR, `.md` = coaching narrative); occupation guides gated by COS career-cluster match | COS/O*NET access (Q5) before live cluster bucketing; convert Goal Tracker if still xlsx |
| 3 WIOA Referral | **Instructor only**; stage under **`teachers/` / TEACHER** | Phase B staging |
| 4 Audience mechanics | Purpose-based: Demand list BOTH; WIOA Fact Sheet instructor/policy; Cert catalog + Curriculum = Sage ref + student/instructor presentation; Bridge descriptors **IETP-only** | Phase B set folder/`vq_audience` to match; may need per-doc override |
| 5 Interest assessment | Skip until O*NET / COS access | Resume when access lands |
| 6 Overlaps #11 / #14 | #11 stage DOCX under `students/`; **#14 = Option 1 + 3-layer cert offer** (FY catalog now; classroom overlay + assignment logic in future sprints; KB slim-down; precedence for retired certs) | Phase B: stage catalog + slim KB + precedence note; Phase C: Classroom model + overlay UI + assignment |
| 7 Nicholas County 2021 | Still valid — keep | Phase B staging |
| 8 Rubric "-2" | **Refresh** bucket with "-2" | Phase B replace live RAG copy |

---

## 7. Governed Steps NOT Executed

Per the Phase A contract, this synthesis was **read-only except for this manifest file**. Explicitly NOT done (all await Britt / Phase B gates):
- No files copied into `docs-upload/` (staging is Phase B).
- No Supabase upload (`scripts/upload-to-supabase.mjs`) and no sync (`POST /api/teacher/documents/sage-context/sync`) — LIVE/governed.
- No `catalog/documents/*.md` OKF nodes authored; no `config/catalog-allowlist.json` edits; no `catalog/sync.mjs --apply`.
- No ProgramDocument rows created, updated, or deactivated.
- No git writes of any kind (no add/commit/branch); the `sage-career-grounding` worktree received only this `.planning/` file.
- No secret values read or printed (env key NAMES only, quoted from discovery briefs).
- No piiRisk file contents opened.

---

## Appendix A — piiRisk-Flagged Paths (metadata only; contents never opened)

| Path | Size (B) | Modified | Disposition |
|---|---|---|---|
| `C:\Users\Instructor\Dev\curriculum\_student-records\SPOKES Goal Setting Project\Student Portfolios\Student Resumes_AI\Career_Discovery_Gemini_Prompts.docx` | 13,138 | 2026-02-10 | Skipped #4 — confirm generic (Q2) |
| `C:\Users\Instructor\OneDrive - WV Department of Education\Desktop\Student Folder\Student Files\Student Homework\Career_Pathfinder_Day_3_Assignment.docx` | 21,206 | 2026-01-20 | Skipped #10 — confirm blank (Q2) |
| `C:\Users\Instructor\OneDrive - WV Department of Education\Desktop\Student Folder\WIOA\Partner Meetings\WIOA Partner Meeting 12.23.docx` | 14,151 | 2023-12-17 | Skipped #15 |
| `C:\Users\Instructor\Dev\curriculum\SPOKES Goal Setting Project\SPOKES_Goal_Tracker.xlsx` | 19,193 | 2026-03-02 | Skipped #19 — confirm (Q2) |
| *(8 further rows withheld)* | | | Student-named record paths (1 confirm-generic candidate + 7 real student records, incl. the whole `_student-records` tree) — full metadata in `phase-a-pii-appendix.local.md` (untracked, `.git/info/exclude`-guarded) |

RAG-side caution note (from the live enumeration): rows titled "IDP Report Mike Johnson" and "Individual Profile Sample" are handbook SAMPLE forms per their `Handbook Appendix/Section 6` storage paths — flagged out of caution, not treated as student PII.
