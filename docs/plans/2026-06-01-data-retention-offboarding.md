# Data Retention & Offboarding Policy

**Status:** decided (alpha posture) — 2026-06-01
**Source gap:** production-readiness completeness-critic #4 — "No backup/PITR/retention posture for FERPA records; `Student` delete is a hard cascade."

---

## TL;DR

The audit premise was largely stale: **no hard student-delete path exists in the app**, and **non-destructive offboarding already works** (deactivate + auto-archive). The decisions below set the retention policy (**5 years**) and the alpha backup posture (**Supabase free tier, no paid PITR yet**), and defer the optional code hardenings until a larger cohort.

---

## Decided posture (alpha — no live students yet)

| Question | Decision |
|----------|----------|
| Backups / PITR | **Stay on Supabase free tier; no paid PITR for now.** Revisit before pushing a larger/real cohort. |
| Retention window | **Inactive student records are kept for 5 years** (per policy). |
| Code hardenings (durable auto-archive, `deactivatedAt` column) | **Deferred** until a larger cohort can be pushed. |

---

## Two separate concerns (don't conflate them)

1. **Retention — "don't delete records for 5 years."**
   Fully satisfied today and on the free tier:
   - **Offboarding = deactivate, never delete.** `PATCH /api/teacher/students/[id]/status` sets `isActive=false`, bumps `sessionVersion` (forces logout), writes an audit log, and auto-archives the student's files. Records remain intact for grant reporting and FERPA.
   - There is **no hard-delete path** anywhere in `src/app` (`prisma.student.delete()` appears only in test cleanup). The `onDelete: Cascade` relations are a *latent* risk, triggered only by a manually-added delete route or a direct DB operation.
   - Policy control: **never add a `student.delete()` in app code; deactivate instead.** Any true erasure (e.g. a legal request) is a deliberate, audited, admin-only manual operation — not a UI action.

2. **Disaster recovery — "restore after corruption / accidental loss."**
   **Not covered on the free tier** — Supabase free provides no automated database backups. During alpha this is an accepted risk because there is no irreplaceable live data yet, and offboarded students additionally have a downloadable ZIP archive of their files. This is the gap that the "revisit before a larger cohort" trigger is meant to close.

---

## Trigger to revisit (before onboarding a real/larger cohort)

When live student data becomes irreplaceable, do the following **before** the cohort starts:
1. **Move Supabase to a plan with daily backups** (Pro), and decide then whether PITR's ~2-minute recovery window justifies the add-on for FERPA data.
2. **Land the two deferred hardenings:**
   - **`deactivatedAt` (+ `deactivatedBy`) on `Student`** — small additive migration. Best done *before* the first cohort so every exit has a clean timestamp to anchor the 5-year clock (otherwise exit dates live only in audit logs). Enables a future "purge candidates older than 5 years post-exit" report.
   - **Durable offboarding auto-archive** — today the archive is fire-and-forget in the status route; move it to the background job queue (or wrap with `retryWithBackoff` + loud `alert:`) so a failed export surfaces instead of silently leaving a deactivated student with no archive.
3. Record the chosen backup tier + retention window in `DEPLOY.md`.

## Explicitly NOT planned
A full soft-delete refactor (`deletedAt` filters across every query). There is no hard-delete to replace; `isActive` already provides the soft-state the app filters on. It would be churn without payoff.
