// =============================================================================
// The intervention-queue student SELECT — moved out of dashboard.ts
// (2026-09-05, benchmark suite B5) so it is importable outside a Next.js
// server-component context.
//
// dashboard.ts opens with `import "server-only"`, which throws unconditionally
// unless the importer is bundled under Next's "react-server" condition — a
// plain `tsx` script (scripts/bench/suites/query-plans.mjs) has no such
// condition and hits that throw immediately on import. This file has no
// server-only guard because it does nothing server-only: it is a pure
// function building a Prisma `select` object, no I/O, exactly like the
// existing `-shared.ts` split this codebase already uses for pure logic
// (matching-shared.ts, schedule-shared.ts, flags-shared.ts, ...).
//
// dashboard.ts re-exports this for backward compatibility — no other call
// site changes.
// =============================================================================

/**
 * Select for the intervention-queue student query. A builder rather than a
 * constant because `now` is embedded in the overdue-task filter. `as const`
 * keeps the literal types Prisma needs for payload inference.
 */
export function interventionQueueStudentSelect(now: Date) {
  return {
    id: true,
    studentId: true,
    displayName: true,
    email: true,
    createdAt: true,
    updatedAt: true,
    progression: { select: { state: true } },
    goals: {
      select: { level: true, status: true, updatedAt: true, lastReviewedAt: true, pathwayId: true },
    },
    orientationProgress: {
      select: { completed: true, completedAt: true },
    },
    alerts: {
      where: { status: "open" },
      select: {
        id: true,
        type: true,
        severity: true,
        title: true,
        summary: true,
        sourceType: true,
        sourceId: true,
        detectedAt: true,
      },
    },
    assignedTasks: {
      where: {
        status: { not: "completed" },
        dueAt: { lt: now },
      },
      select: { id: true },
    },
    conversations: {
      select: { updatedAt: true },
      orderBy: { updatedAt: "desc" },
      take: 1,
    },
    portfolioItems: { select: { updatedAt: true } },
    files: { select: { uploadedAt: true } },
    formSubmissions: {
      select: { updatedAt: true },
      orderBy: { updatedAt: "desc" },
      take: 1,
    },
    applications: {
      select: { updatedAt: true },
      orderBy: { updatedAt: "desc" },
      take: 1,
    },
    eventRegistrations: {
      select: { updatedAt: true },
      orderBy: { updatedAt: "desc" },
      take: 1,
    },
    certifications: {
      select: {
        status: true,
      },
    },
    resumeData: { select: { id: true } },
    publicCredentialPage: { select: { isPublic: true } },
    classEnrollments: {
      select: {
        enrolledAt: true,
        status: true,
        class: { select: { programType: true } },
      },
      orderBy: { enrolledAt: "desc" },
    },
  } as const;
}
