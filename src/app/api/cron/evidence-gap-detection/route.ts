import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const isDev = process.env.NODE_ENV === "development";
  // No secret configured → allow only in development; deny in all other environments
  if (!secret) return isDev;
  const authHeader = req.headers.get("authorization");
  return authHeader === `Bearer ${secret}`;
}

/**
 * POST /api/cron/evidence-gap-detection
 *
 * Cron endpoint that scans all students with active class enrollments for
 * unmet required class requirements (certifications, orientation items, forms, courses).
 *
 * For each unmet required item, creates or maintains a StudentAlert with type "evidence_gap".
 * Escalates severity to "high" when the enrollment is 14+ days old and the gap persists.
 * Auto-resolves alerts when the requirement is met.
 *
 * Auth: Bearer CRON_SECRET
 */
export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const start = Date.now();
  const now = new Date();

  try {
    // Fetch all active enrollments with their class requirements
    const enrollments = await prisma.studentClassEnrollment.findMany({
      where: { status: "active" },
      select: {
        studentId: true,
        classId: true,
        enrolledAt: true,
      },
    });

    if (enrollments.length === 0) {
      return NextResponse.json({
        studentsScanned: 0,
        requirementsChecked: 0,
        newAlerts: 0,
        resolvedAlerts: 0,
        timestamp: now.toISOString(),
      });
    }

    const studentIds = [...new Set(enrollments.map((e) => e.studentId))];
    const classIds = [...new Set(enrollments.map((e) => e.classId))];

    // Batch-load all requirements for relevant classes
    const allRequirements = await prisma.classRequirement.findMany({
      where: { classId: { in: classIds } },
      select: {
        id: true,
        classId: true,
        title: true,
        itemType: true,
        itemId: true,
        status: true, // "required" | "optional" | "not_applicable"
      },
    });

    // Only care about required items — optional ones don't generate gaps
    const requiredByClass = new Map<string, typeof allRequirements>();
    for (const req of allRequirements) {
      if (req.status !== "required") continue;
      const list = requiredByClass.get(req.classId) ?? [];
      list.push(req);
      requiredByClass.set(req.classId, list);
    }

    // Batch-load all student completion data in one pass
    const [allCerts, allOrientation, allForms, allProgressions] = await Promise.all([
      prisma.certification.findMany({
        where: { studentId: { in: studentIds } },
        select: { studentId: true, certType: true, status: true },
      }),
      prisma.orientationProgress.findMany({
        where: { studentId: { in: studentIds }, completed: true },
        select: { studentId: true, itemId: true },
      }),
      prisma.formSubmission.findMany({
        where: { studentId: { in: studentIds } },
        select: { studentId: true, formId: true, status: true },
      }),
      prisma.progression.findMany({
        where: { studentId: { in: studentIds } },
        select: { studentId: true, state: true },
      }),
    ]);

    // Index completion data by studentId
    const completedCertsByStudent = new Map<string, Set<string>>();
    for (const c of allCerts) {
      if (c.status !== "completed") continue;
      const set = completedCertsByStudent.get(c.studentId) ?? new Set();
      set.add(c.certType);
      completedCertsByStudent.set(c.studentId, set);
    }

    const completedOrientationByStudent = new Map<string, Set<string>>();
    for (const o of allOrientation) {
      const set = completedOrientationByStudent.get(o.studentId) ?? new Set();
      set.add(o.itemId);
      completedOrientationByStudent.set(o.studentId, set);
    }

    const submittedFormsByStudent = new Map<string, Set<string>>();
    for (const f of allForms) {
      if (f.status !== "approved" && f.status !== "submitted") continue;
      const set = submittedFormsByStudent.get(f.studentId) ?? new Set();
      set.add(f.formId);
      submittedFormsByStudent.set(f.studentId, set);
    }

    const visitedPlatformsByStudent = new Map<string, Set<string>>();
    for (const p of allProgressions) {
      try {
        const state = JSON.parse(p.state);
        if (Array.isArray(state.platformsVisited)) {
          visitedPlatformsByStudent.set(p.studentId, new Set(state.platformsVisited as string[]));
        }
      } catch { /* ignore malformed state */ }
    }

    // Build enrollment lookup: studentId -> { classId, enrolledAt }
    // A student may have only one active enrollment, but use a map for safety
    const enrollmentByStudent = new Map<string, { classId: string; enrolledAt: Date }>();
    for (const e of enrollments) {
      enrollmentByStudent.set(e.studentId, { classId: e.classId, enrolledAt: e.enrolledAt });
    }

    // Collect all alert keys that should be open after this scan
    const activeAlertKeys = new Set<string>();

    // Collect gap records to upsert
    interface GapRecord {
      studentId: string;
      alertKey: string;
      requirementId: string;
      title: string;
      itemType: string;
      severity: "medium" | "high";
    }

    const gaps: GapRecord[] = [];
    let requirementsChecked = 0;

    for (const [sid, enrollment] of enrollmentByStudent) {
      const reqs = requiredByClass.get(enrollment.classId) ?? [];
      if (reqs.length === 0) continue;

      const completedCerts = completedCertsByStudent.get(sid) ?? new Set<string>();
      const completedOrientation = completedOrientationByStudent.get(sid) ?? new Set<string>();
      const submittedForms = submittedFormsByStudent.get(sid) ?? new Set<string>();
      const visitedPlatforms = visitedPlatformsByStudent.get(sid) ?? new Set<string>();

      // Determine severity based on how long the student has been enrolled
      const enrollmentAgeDays = Math.floor(
        (now.getTime() - enrollment.enrolledAt.getTime()) / 86400000,
      );
      const baseSeverity: "medium" | "high" = enrollmentAgeDays >= 14 ? "high" : "medium";

      for (const req of reqs) {
        requirementsChecked += 1;

        let met = false;
        switch (req.itemType) {
          case "certification":
            met = completedCerts.has(req.itemId);
            break;
          case "orientation":
            met = completedOrientation.has(req.itemId);
            break;
          case "form":
            met = submittedForms.has(req.itemId);
            break;
          case "course":
            met = visitedPlatforms.has(req.itemId);
            break;
        }

        if (!met) {
          const alertKey = `evidence_gap:${sid}:${req.id}`;
          activeAlertKeys.add(alertKey);
          gaps.push({
            studentId: sid,
            alertKey,
            requirementId: req.id,
            title: req.title,
            itemType: req.itemType,
            severity: baseSeverity,
          });
        }
      }
    }

    let newAlerts = 0;
    let resolvedAlerts = 0;

    await prisma.$transaction(async (tx) => {
      // Determine which alert keys already exist so we can count net-new ones
      const existingKeys = new Set(
        (
          await tx.studentAlert.findMany({
            where: { alertKey: { in: [...activeAlertKeys] } },
            select: { alertKey: true },
          })
        ).map((a) => a.alertKey),
      );

      // Upsert one alert per unmet requirement
      for (const gap of gaps) {
        const typeLabel = gap.itemType.charAt(0).toUpperCase() + gap.itemType.slice(1);

        await tx.studentAlert.upsert({
          where: { alertKey: gap.alertKey },
          update: {
            severity: gap.severity,
            status: "open",
            title: `Missing ${typeLabel}: ${gap.title}`,
            summary: `Required ${gap.itemType} "${gap.title}" has not been completed.`,
            sourceType: "class_requirement",
            sourceId: gap.requirementId,
          },
          create: {
            studentId: gap.studentId,
            alertKey: gap.alertKey,
            type: "evidence_gap",
            severity: gap.severity,
            status: "open",
            title: `Missing ${typeLabel}: ${gap.title}`,
            summary: `Required ${gap.itemType} "${gap.title}" has not been completed.`,
            sourceType: "class_requirement",
            sourceId: gap.requirementId,
          },
        });

        if (!existingKeys.has(gap.alertKey)) {
          newAlerts += 1;
        }
      }

      // Auto-resolve evidence_gap alerts whose requirements are now met
      const openEvidenceAlerts = await tx.studentAlert.findMany({
        where: {
          type: "evidence_gap",
          status: "open",
        },
        select: { id: true, alertKey: true },
      });

      const toResolve = openEvidenceAlerts
        .filter((a) => !activeAlertKeys.has(a.alertKey))
        .map((a) => a.id);

      if (toResolve.length > 0) {
        await tx.studentAlert.updateMany({
          where: { id: { in: toResolve } },
          data: { status: "resolved", resolvedAt: now },
        });
        resolvedAlerts = toResolve.length;
      }
    });

    const durationMs = Date.now() - start;

    logger.info("Evidence gap detection complete", {
      studentsScanned: studentIds.length,
      requirementsChecked,
      newAlerts,
      resolvedAlerts,
      durationMs,
    });

    return NextResponse.json({
      studentsScanned: studentIds.length,
      requirementsChecked,
      newAlerts,
      resolvedAlerts,
      timestamp: now.toISOString(),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("Evidence gap detection failed", { error: message });

    return NextResponse.json(
      {
        error: "Evidence gap detection failed",
        detail: process.env.NODE_ENV === "development" ? message : undefined,
      },
      { status: 500 },
    );
  }
}
