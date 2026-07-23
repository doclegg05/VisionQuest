---
type: program_document
title: SPOKES Certifications
description: >-
  The unified FY certification-offer catalog for SPOKES — which credentials are
  currently offered, how each is accessed, who issues it, and who can earn it
  (Ready to Work, Achievement, Participation, NCRC/WorkKeys, IC3, MOS,
  QuickBooks, Adobe, Cybersecurity, and related tracks). Source of truth for
  what is offered; superseded yearly.
resource: students/resources/SPOKES_Certifications.docx
tags:
  - certifications
  - spokes
  - ready-to-work
  - ncrc
  - certiport
  - catalog
  - offer
timestamp: '2026-07-23'
vq_id: spokes-certifications
vq_audience: STUDENT
vq_category: STUDENT_RESOURCE
vq_storage_key: students/resources/SPOKES_Certifications.docx
vq_status: approved
---
## When to use
**Primary source of truth for the current certification offer** (Phase A Q6/#14 three-layer architecture). Use when asking which certifications a SPOKES student can earn and HOW each is issued — Wufoo request forms, Certiport class setup and proctoring, WorkKeys exam scheduling, and which certificates are limited to SPOKES or SPOKES-blended students. Also useful for student/instructor presentation and course-selection offers. Per this document, the NCRC WorkKeys exams are Workplace Documents, Applied Math, and Graphic Literacy.

**Precedence:** If any other document names a certification not listed in the current catalog, treat that mention as **historical** (retired or obsolete) — do not present it as currently offered.

## When NOT to use
- NOT the corpus document "SPOKES Modules 2025" — that is teacher-side module planning; this is the certification-access / offer catalog.
- NOT a substitute for the hardcoded always-on baseline in `src/lib/sage/knowledge-base.ts` until post-sync KB slim-down lands — after slim-down, this catalog wins for offer detail; the prompt keeps only stable program facts + a pointer here.
- Issuance contacts name specific staff — confirm currency before a student relies on a named contact.

## Architecture (future sprints)
- **Layer 1 (now):** this FY catalog — annual revise → upload → sync; deactivate prior-year row (do not delete). Later revisions should add a **Retired** tombstone section.
- **Layer 2 (Phase C):** classroom/site overlay — instructors may emphasize/add electives on top of core; never remove a core cert.
- **Layer 3:** student profile (cluster, goals, interview). Assignment = `base catalog ∩ classroom overlay`, ranked by cluster/goals; RAG supplies how-to prose after candidates are chosen.

## Related
Module completion that feeds these certificates: [SPOKES Life and Employability Skills Curriculum](./spokes-life-and-employability-skills-curriculum.md).
