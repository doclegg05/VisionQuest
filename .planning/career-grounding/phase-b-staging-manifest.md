# Phase B Staging Manifest — Sage Career Grounding

**Date:** 2026-07-09
**Author:** Phase B ingest-prep agent (subagent)
**Contract:** `.planning/career-grounding/phase-a-inventory.md` (§1 15 candidates; Q1–Q8 honored, not resolved)
**Status:** staged + cataloged + allowlisted on Windows (2026-07-09); **decision delta 2026-07-23** below — re-path before upload. NOTHING uploaded, synced, or committed. Governed steps: `docs/runbooks/career-grounding-sync.md`.

## 0. Decision delta (2026-07-23) — re-stage before upload

Phase A §6 closed on Mac; these change the 2026-07-09 staging layout:

| # | Change | New staged path | New storageKey | Audience |
|---|--------|-----------------|----------------|----------|
| 10 | WIOA Referral: instructor-only | `teachers/WIOA Referral Form.pdf` | `teachers/guides/WIOA Referral Form.pdf` | TEACHER |
| 9 | WIOA Fact Sheet: instructor/policy | `teachers/New WIOA Fact Sheet 7.11.24.pdf` | `teachers/guides/New WIOA Fact Sheet 7.11.24.pdf` | TEACHER |
| — | ECP FY25 (Q1) | dual-stage `students/` + `orientation/` | TBD at staging | STUDENT |
| — | Rubric Record "-2" (Q8) | refresh existing RAG object | existing Rubric Record key | (keep) |

Catalog nodes + allowlist already updated for #9/#10 path moves. Binary moves still need the Windows `docs-upload/` tree (or a copy onto this Mac).

**Mac blockers (2026-07-23):** career-batch binaries not present in this checkout's `docs-upload/`; `STORAGE_ACCESS_KEY` / `STORAGE_SECRET_KEY` / `STORAGE_ENDPOINT` empty in `.env.local`. Upload/sync remain Britt-governed per runbook.

## 1. Staged files — sha256 verified against sources (15/15)

Copies only; no source file was moved or modified. `docs-upload/` is gitignored (worktree-local by design).

| # | Staged path (docs-upload/) | Bucket storageKey | Bytes | sha256 (source == staged, verified) |
|---|---|---|---|---|
| 1 | students/CFWV Career Exploration Worksheet.pdf | students/resources/CFWV Career Exploration Worksheet.pdf | 98,196 | 24BDD07328183678967074D507F6EC1758B87924F8B9B475DCBABADB689F0260 |
| 2 | students/Career Discovery Prompts.pdf | students/resources/Career Discovery Prompts.pdf | 4,305,696 | 039C25BC3F8B641D21E56BBF367AF30C7503518EBEA318CE399681172D1FE53B |
| 3 | students/Region 1 Demand Occupation List 2024.pdf | students/resources/Region 1 Demand Occupation List 2024.pdf | 133,944 | CFEC27198CB96447C9D768A57312321FF9A0E1C91D9A059DAD41E2FAEB823BCB |
| 4 | students/SPOKES Life and Employability Skills Curriculum.pdf | students/resources/SPOKES Life and Employability Skills Curriculum.pdf | 1,923,379 | 59DDF921ECFAF3A1CAF6F21FCC52CAEBDA0470838FC7A9740007F01140D9C87B |
| 5 | students/Handout_5_Career_Planning.pdf | students/resources/Handout_5_Career_Planning.pdf | 36,105 | C7220B80F02F4CF004D7F1D44C40A0C7873125D6951716E16F63FF841B397531 |
| 6 | students/Handout_4_SMART_Goal.pdf | students/resources/Handout_4_SMART_Goal.pdf | 37,856 | EF98717B22EE7DABBDC869772446D0D65D12AF821CEAF6D13F770FFC202FE5A2 |
| 7 | students/STAR_Interview_Worksheet.pdf | students/resources/STAR_Interview_Worksheet.pdf | 276,279 | ADFC2661AACE8BB16EFA62E58B1F5BA5356BEDB56D29D8E84B3637838673F158 |
| 8 | students/ChatGPT Interview Practice Prompts.pdf | students/resources/ChatGPT Interview Practice Prompts.pdf | 453,906 | EB45C8CCD3CF9D3B26225C665CD1E83E2536A031241FB37D560BC24FA0131DA0 |
| 9 | students/New WIOA Fact Sheet 7.11.24.pdf | students/resources/New WIOA Fact Sheet 7.11.24.pdf | 110,643 | 3AD9A379CEC0FF90302533DE4C6C5BC9C142999D3A50B32B36CA6A550F42230A |
| 10 | forms/WIOA Referral Form.pdf | forms/WIOA Referral Form.pdf | 103,204 | 693C043F79DF07B0047E11C0877820C89A092FD69A03B6F03BA8EA961751CEA1 |
| 11 | students/Career_Pathways_Bridge_Descriptors2020.docx | students/resources/Career_Pathways_Bridge_Descriptors2020.docx | 1,659,576 | 5BCC410434AEB335148ADE20CEAD1E574DA3C90B3E1678FC5DFB532DA29DB478 |
| 12 | students/Nicholas_County_IET_Food_Service_Management_with_CTE_Career_Pathway.docx | students/resources/Nicholas_County_IET_Food_Service_Management_with_CTE_Career_Pathway.docx | 41,564 | BB7787FD510B33CF4AD2E3559AFF04FC5EBEE347B549EE0AFAF7364B21B2A891 |
| 13 | presentation/fy27-updates-final-transcript.md | presentations/fy27-updates-final-transcript.md | 3,746 | E8752161EB8FC61048328931F1FB8DEF4973CA91B20792B92310120372BDB73C |
| 14 | students/SPOKES_Certifications.docx | students/resources/SPOKES_Certifications.docx | 54,743 | B7A97353D538F07DA4E71953A0680451A9EC1145717F350195E0A8C07EDC55C5 |
| 15 | students/Pub_PathwaySccss_Flier_DEVO_AIM.pdf | students/resources/Pub_PathwaySccss_Flier_DEVO_AIM.pdf | 530,232 | 92486746EFBBB8C102DE85D0A5059228E1784D3D4CB666B077899DA0A3011D1B |

**Parity: 15/15 staged + sha256-verified. 15 catalog nodes. 15 allowlist keys.**

## 2. Journal — decisions and deviations

- **[#12 rename]** DECISION: staged `Nicholas_County_IET_...Career_Pathway (1) (1).docx` as `..._Career_Pathway.docx` (dropped the ` (1) (1)` download-duplicate suffix) | WHY: task directive; the suffix is a browser-download artifact, and bucket keys/slugs derive from the filename | ALTERNATIVES: keep suffix (ugly key, ugly slug) | REVERSIBLE: rename the staged copy; source untouched.
- **[#1 path correction]** Phase A's path for the CFWV worksheet omitted a folder segment. Actual source: `...\Desktop\Student Folder\New Student Enrollment Forms\New Student Orientation Paperwork\PDF\CFWV Career Exploration Worksheet.pdf`. Size (98,196 B) and mtime (2026-04-21) match Phase A's metadata exactly — same file, mis-transcribed path. No content substitution.
- **[Slug convention]** DECISION: `vq_id` and node filenames use the validator's mechanical rule (`slugifyStorageKey` = staged filename, lowercased, non-alphanumerics → `-`), NOT Phase A's proposed slugs | WHY: `scripts/catalog/validate.mjs` derives allowlist ids via `slugifyStorageKey` and fails parity otherwise | REVERSIBLE: rename staged files (changes bucket keys too). Deviations from Phase A's proposed slugs (8):
  | # | Phase A proposed | Actual (validator-derived) |
  |---|---|---|
  | 4 | spokes-life-employability-skills-curriculum | spokes-life-and-employability-skills-curriculum |
  | 8 | ai-interview-practice-prompts | chatgpt-interview-practice-prompts |
  | 9 | wioa-fact-sheet-2024 | new-wioa-fact-sheet-7-11-24 |
  | 11 | career-pathways-bridge-descriptors-2020 | career-pathways-bridge-descriptors2020 |
  | 12 | nicholas-county-iet-food-service-pathway | nicholas-county-iet-food-service-management-with-cte-career-pathway |
  | 13 | fy27-career-pathways-updates-transcript | fy27-updates-final-transcript |
  | 14 | spokes-certifications-catalog | spokes-certifications |
  | 15 | pathway-to-success-training-flier | pub-pathwaysccss-flier-devo-aim |
- **[Audience]** DECISION: node `vq_audience` records what the ingest will mint from the folder (students/ → STUDENT; forms/, presentation/ → BOTH), not Phase A's proposed BOTH for #3/#4/#9/#11/#12/#14/#15 | WHY: post-sync `catalog:validate` parity is byte-exact against DB rows; `sage-overrides.json` cannot override audience | Q4 remains open in the runbook.
- **[Title #13]** The ingest will mint the title `fy27 updates final transcript` (lowercase, from filename). Accepted for parity; rename the staged file pre-upload if Britt wants a prettier title.
- **[Knowledge-base]** DECISION: comments-only annotations plus ONE verified factual fix — NCRC exam list "Business Writing" → "Graphic Literacy" in the two `knowledge-base.ts` occurrences, verified against staged `SPOKES_Certifications.docx` ("...WorkKeys exams in Workplace Documents, Applied Math, and Graphic Literacy") | The same stale phrase in `src/lib/spokes/certifications.ts:~226` is OUTSIDE Phase B ownership — flagged in the runbook §6.1 | No defer-to-RAG restructure pre-sync (zero-regression); steps written into runbook §6.
- **[Extraction previews]** All 15 staged docs text-extracted read-only (program documents, no student PII). Low-text findings recorded in nodes: #10 WIOA Referral Form ≈ no extractable body text; #15 flier extracts ~1.5k fragmented chars; #12 contains a template artifact ("Nursing Assistant" line in a Food Service course description).
- **[.md upload risk]** `scripts/upload-to-supabase.mjs` `MIME_MAP` has no `.md` entry → #13 would upload as `application/octet-stream`; bucket MIME allowlist may reject it (it rejected avi/mp3 on 2026-07-03). Flagged as runbook precondition 1; no script edit made (outside ownership).

## 3. Explicitly NOT done (governed / out of scope)

- No upload, no RAG sync, no catalog `--apply`, no DB writes, no git commands.
- `catalog/log.md` and `catalog/index.md` not touched (outside `catalog/documents/**` ownership) — a log entry for this batch is left to the orchestrator.
- `src/lib/spokes/certifications.ts` NCRC drift not fixed (outside ownership; runbook §6.1).
- Q1/Q2/Q5/Q8 untouched per contract.
