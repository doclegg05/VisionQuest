---
created: 2026-07-24T12:41:33.753Z
title: Seamless external assessment round-trips
area: integrations
files:
  - .planning/research/2026-07-24-assessment-round-trips.md
---

## Problem

Students often need to leave VisionQuest for third-party career tools (example: CareerOneStop Interest Profiler) when Sage recommends an assessment. Today that handoff is a dead end: the student clicks out, completes the assessment elsewhere, and there is no designed path to bring results back so Sage and VisionQuest can update the student profile and stay relevant.

We need a seamless round-trip: VisionQuest/Sage → external site → results returned (or captured) → student profile adapted → Sage recommendations stay grounded in those results.

## Solution

**Research complete (2026-07-24).** Full brief:

→ [`.planning/research/2026-07-24-assessment-round-trips.md`](../../research/2026-07-24-assessment-round-trips.md)

**Verdict (summary):** CareerOneStop’s Interest Assessment page has no return API. Prefer **Path A — native O\*NET Mini Interest Profiler** via O\*NET Web Services into existing `CareerDiscovery` fields (after provenance + score-scale work). Keep **Path B — deep-link + guided import** for true external partners. Do not confuse with CareerOneStop **Skills Matcher** (already in Sage as `career_skills_match`).

**Blocked on Britt decisions** listed in brief §6 (Path A vs B-first, score scale, clobber policy, consent, v1 scope, brand copy, audit timing).

**Related later todo:** one-button student audit evidence pack — [`.planning/todos/pending/2026-07-24-one-button-student-audit-evidence-pack.md`](./2026-07-24-one-button-student-audit-evidence-pack.md). Assessment writes should leave audit-stable snapshots (see research brief §5b), not only live Career DNA fields.
