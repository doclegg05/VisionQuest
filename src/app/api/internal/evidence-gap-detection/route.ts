import { NextResponse } from "next/server";
import { writeDetectedAlert } from "@/lib/alert-hold";
import { isAuthorizedInternalRequest } from "@/lib/csrf";
import { prismaAdmin as prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

// One transaction holds every upsert of a program-wide run, so Prisma's 5 s
// default is too short. The pg_cron job waits 120 s (timeout_milliseconds in
// 20261015120000_add_stall_detector_cron), longer than this.
const TRANSACTION_OPTIONS = { timeout: 90_000, maxWait: 10_000 };

interface Enrollment {
  classId: string;
  enrolledAt: Date;
}

interface RequiredItem {
  id: string;
  title: string;
  itemType: string;
  itemId: string;
}

interface Completions {
  certs: Set<string>;
  orientation: Set<string>;
  forms: Set<string>;
  platforms: Set<string>;
}

interface GapRecord {
  studentId: string;
  alertKey: string;
  requirementId: string;
  title: string;
  itemType: string;
  severity: "medium" | "high";
}

/**
 * Active enrollments only, keyed by student. Every requirement-compliance
 * reader uses this scope: checkStudentCompliance and checkClassCompliance
 * (src/lib/class-requirement-compliance.ts), and so the alert sync's
 * requirement_noncompliant alert. The intervention queue lists students with
 * any non-archived enrollment, but inactive, completed and withdrawn are
 * states a teacher sets by hand, so a gap there is not news to them, and
 * widening only this scan would give one student two requirement answers.
 */
async function loadActiveEnrollments(): Promise<Map<string, Enrollment>> {
  const enrollments = await prisma.studentClassEnrollment.findMany({
    where: { status: "active" },
    select: { studentId: true, classId: true, enrolledAt: true },
  });
  // A student should have one active enrollment; if there are more, the last wins.
  return new Map(enrollments.map((e) => [e.studentId, { classId: e.classId, enrolledAt: e.enrolledAt }]));
}

/** Required items only; optional ones never raise a gap. */
async function loadRequiredByClass(classIds: string[]): Promise<Map<string, RequiredItem[]>> {
  const requirements = await prisma.classRequirement.findMany({
    where: { classId: { in: classIds } },
    select: { id: true, classId: true, title: true, itemType: true, itemId: true, status: true },
  });
  const byClass = new Map<string, RequiredItem[]>();
  for (const req of requirements) {
    if (req.status !== "required") continue;
    byClass.set(req.classId, [...(byClass.get(req.classId) ?? []), req]);
  }
  return byClass;
}

function emptyCompletions(): Completions {
  return { certs: new Set(), orientation: new Set(), forms: new Set(), platforms: new Set() };
}

async function loadCompletions(studentIds: string[]): Promise<Map<string, Completions>> {
  const [certs, orientation, forms, progressions] = await Promise.all([
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

  const byStudent = new Map<string, Completions>();
  const forStudent = (studentId: string): Completions => {
    const existing = byStudent.get(studentId) ?? emptyCompletions();
    byStudent.set(studentId, existing);
    return existing;
  };

  for (const c of certs) if (c.status === "completed") forStudent(c.studentId).certs.add(c.certType);
  for (const o of orientation) forStudent(o.studentId).orientation.add(o.itemId);
  for (const f of forms) {
    if (f.status === "approved" || f.status === "submitted") forStudent(f.studentId).forms.add(f.formId);
  }
  for (const p of progressions) {
    try {
      const state = JSON.parse(p.state);
      if (Array.isArray(state.platformsVisited)) {
        forStudent(p.studentId).platforms = new Set(state.platformsVisited as string[]);
      }
    } catch { /* ignore malformed state */ }
  }
  return byStudent;
}

function isRequirementMet(req: RequiredItem, done: Completions): boolean {
  switch (req.itemType) {
    case "certification":
      return done.certs.has(req.itemId);
    case "orientation":
      return done.orientation.has(req.itemId);
    case "form":
      return done.forms.has(req.itemId);
    case "course":
      return done.platforms.has(req.itemId);
    default:
      return false;
  }
}

function findGaps(
  enrollments: Map<string, Enrollment>,
  requiredByClass: Map<string, RequiredItem[]>,
  completions: Map<string, Completions>,
  now: Date,
): { gaps: GapRecord[]; requirementsChecked: number } {
  const gaps: GapRecord[] = [];
  let requirementsChecked = 0;

  for (const [studentId, enrollment] of enrollments) {
    const reqs = requiredByClass.get(enrollment.classId) ?? [];
    const done = completions.get(studentId) ?? emptyCompletions();
    // A gap that persists 14+ days into the enrollment is high severity.
    const enrollmentAgeDays = Math.floor((now.getTime() - enrollment.enrolledAt.getTime()) / 86400000);
    const severity: "medium" | "high" = enrollmentAgeDays >= 14 ? "high" : "medium";

    for (const req of reqs) {
      requirementsChecked += 1;
      if (isRequirementMet(req, done)) continue;
      gaps.push({
        studentId,
        alertKey: `evidence_gap:${studentId}:${req.id}`,
        requirementId: req.id,
        title: req.title,
        itemType: req.itemType,
        severity,
      });
    }
  }
  return { gaps, requirementsChecked };
}

/** Upserts one alert per gap and resolves open evidence_gap alerts no longer found. */
async function syncEvidenceGapAlerts(
  gaps: GapRecord[],
  now: Date,
): Promise<{ newAlerts: number; resolvedAlerts: number }> {
  const activeAlertKeys = new Set(gaps.map((gap) => gap.alertKey));

  return prisma.$transaction(async (tx) => {
    const existing = new Map(
      (
        await tx.studentAlert.findMany({
          where: { alertKey: { in: [...activeAlertKeys] } },
          select: { alertKey: true, status: true, snoozedUntil: true },
        })
      ).map((a) => [a.alertKey, a]),
    );

    for (const gap of gaps) {
      const typeLabel = gap.itemType.charAt(0).toUpperCase() + gap.itemType.slice(1);
      await writeDetectedAlert(
        tx,
        existing.get(gap.alertKey),
        {
          studentId: gap.studentId,
          alertKey: gap.alertKey,
          type: "evidence_gap",
          severity: gap.severity,
          title: `Missing ${typeLabel}: ${gap.title}`,
          summary: `Required ${gap.itemType} "${gap.title}" has not been completed.`,
          sourceType: "class_requirement",
          sourceId: gap.requirementId,
        },
        now,
      );
    }

    const openEvidenceAlerts = await tx.studentAlert.findMany({
      where: { type: "evidence_gap", status: "open" },
      select: { id: true, alertKey: true },
    });
    const toResolve = openEvidenceAlerts.filter((a) => !activeAlertKeys.has(a.alertKey)).map((a) => a.id);
    if (toResolve.length > 0) {
      await tx.studentAlert.updateMany({
        where: { id: { in: toResolve } },
        data: { status: "resolved", resolvedAt: now },
      });
    }

    return {
      newAlerts: gaps.filter((gap) => !existing.has(gap.alertKey)).length,
      resolvedAlerts: toResolve.length,
    };
  }, TRANSACTION_OPTIONS);
}

/**
 * POST /api/internal/evidence-gap-detection
 *
 * Daily (pg_cron job evidence-gap-detection, 10:35 UTC). Scans every student
 * with an active class enrollment for unmet required class items
 * (certifications, orientation items, forms, courses), opens one
 * evidence_gap StudentAlert per unmet item, escalates it to high once the
 * enrollment is 14+ days old, and resolves open ones whose item is now met.
 * The intervention queue's evidenceGapCount counts these alerts, and this job
 * is their only writer.
 *
 * Auth: Bearer CRON_SECRET.
 */
export async function POST(req: Request) {
  const authorized = isAuthorizedInternalRequest(
    new URL(req.url).pathname,
    req.headers.get("authorization"),
    process.env.CRON_SECRET,
  );
  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const start = Date.now();
  const now = new Date();

  try {
    const enrollments = await loadActiveEnrollments();
    if (enrollments.size === 0) {
      return NextResponse.json({
        studentsScanned: 0,
        requirementsChecked: 0,
        newAlerts: 0,
        resolvedAlerts: 0,
        timestamp: now.toISOString(),
      });
    }

    const studentIds = [...enrollments.keys()];
    const classIds = [...new Set([...enrollments.values()].map((e) => e.classId))];
    const [requiredByClass, completions] = await Promise.all([
      loadRequiredByClass(classIds),
      loadCompletions(studentIds),
    ]);
    const { gaps, requirementsChecked } = findGaps(enrollments, requiredByClass, completions, now);
    const { newAlerts, resolvedAlerts } = await syncEvidenceGapAlerts(gaps, now);

    const summary = { studentsScanned: studentIds.length, requirementsChecked, newAlerts, resolvedAlerts };
    logger.info("Evidence gap detection complete", { ...summary, durationMs: Date.now() - start });
    return NextResponse.json({ ...summary, timestamp: now.toISOString() });
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
