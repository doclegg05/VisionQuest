---
created: 2026-07-24T12:41:33.753Z
title: Seamless external assessment round-trips
area: integrations
files: []
---

## Problem

Students often need to leave VisionQuest for third-party career tools (example: CareerOneStop Interest Profiler) when Sage recommends an assessment. Today that handoff is a dead end: the student clicks out, completes the assessment elsewhere, and there is no designed path to bring results back so Sage and VisionQuest can update the student profile and stay relevant.

We need a seamless round-trip: VisionQuest/Sage → external site → results returned (or captured) → student profile adapted → Sage recommendations stay grounded in those results.

Processes are still TBD — design must cover links/redirects, return UX, result ingestion (manual upload vs API vs copy/paste vs scrape), consent/privacy, and which assessments map into which profile fields.

## Solution

TBD — work out the processes first. Likely design spikes:

1. **Outbound**: Sage action cards / deep links with context (student id, assessment type, return URL).
2. **Return**: clear “back to VisionQuest” path after completion; optional intermediate “paste or upload results” step when no API exists.
3. **Ingestion**: normalize assessment results into student profile fields Sage already uses for personalization.
4. **Partners to consider first**: CareerOneStop Interest Profiler; generalize to other assessments later.
5. Align with career-grounding planning under `.planning/career-grounding/` when that workstreams touch external tools.
