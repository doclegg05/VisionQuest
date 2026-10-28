import "server-only";

import {
  assertStaffCanManageClass,
  buildManagedStudentWhere,
  listManagedClasses,
  listManagedStudentIds,
  NON_ARCHIVED_ENROLLMENT_STATUSES,
} from "@/lib/classroom";
import { getCertificationProgress } from "@/lib/certifications";
import { prisma, prismaAdmin } from "@/lib/db";
import { forbidden, type Session } from "@/lib/api-error";
import { goalCountsTowardPlan } from "@/lib/goals";
import { checkClassCompliance } from "@/lib/class-requirement-compliance";
import { fetchReadinessDataForStudents } from "@/lib/progression/fetch-readiness-data";
import { normalizeProgramType, type ProgramType } from "@/lib/program-type";
import {
  buildInterventionQueueEntry,
  compareQueueEntries,
  type InterventionQueueEntry,
  type InterventionQueueStudentRecord,
} from "@/lib/teacher/intervention-queue";
import { interventionQueueStudentSelect } from "@/lib/teacher/intervention-queue-select";

export { interventionQueueStudentSelect };

export type QueueStudent = InterventionQueueEntry;

export interface InterventionQueueResponse {
  queue: QueueStudent[];
}

export interface StudentOverview {
  id: string;
  studentId: string;
  displayName: string;
  programType: ProgramType;
  createdAt: string;
  lastActive: string;
  xp: number;
  level: number;
  streak: number;
  hasBhag: boolean;
  goalsCount: number;
  orientationDone: number;
  orientationTotal: number;
  certStatus: string;
  certDone: number;
  certTotal: number;
  certPendingVerify: number;
  openAlertCount: number;
  nextAppointmentAt: string | null;
  portfolioItems: number;
  hasResume: boolean;
  filesCount: number;
  isActive: boolean;
  readinessScore: number;
  requirementsMet: number;
  requirementsTotal: number;
  intakeStatus: "certified" | "needs_review" | "missing";
  intakeFileId?: string | null;
}

export interface ManagedClassOption {
  id: string;
  name: string;
  code: string;
  status: string;
  programType: ProgramType;
}

export interface UpcomingAppointment {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  locationType: string;
  locationLabel: string | null;
  student: {
    id: string;
    studentId: string;
    displayName: string;
  };
}

export interface TeacherDashboardPageData {
  classes: ManagedClassOption[];
  currentClassId: string | null;
  students: StudentOverview[];
  upcomingAppointments: UpcomingAppointment[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

function latestDate(...values: Array<Date | null | undefined>) {
  return values.reduce<Date | null>((latest, value) => {
    if (!value) return latest;
    if (!latest || value.getTime() > latest.getTime()) return value;
    return latest;
  }, null);
}

// interventionQueueStudentSelect moved to ./intervention-queue-select.ts
// (2026-09-05, benchmark suite B5, imported above) — this file's
// `import "server-only"` at the top throws for any importer outside a
// Next.js server-component context, which made the select unreachable from
// a plain script (scripts/bench/suites/query-plans.mjs).

/**
 * Shared tail of both queue variants: score each student, drop
 * zero-urgency entries, crisis first, then most urgent.
 */
function buildQueueResponse(
  students: InterventionQueueStudentRecord[],
  orientationTotalCount: number,
  now: Date,
): InterventionQueueResponse {
  const queueEntries = students.map((student) =>
    buildInterventionQueueEntry({
      student,
      now,
      orientationTotalCount,
    }),
  );

  return {
    queue: queueEntries
      .filter((entry) => entry.urgencyScore > 0)
      .sort(compareQueueEntries),
  };
}

export async function getInterventionQueue(
  session: Session,
  options: { classId?: string } = {},
): Promise<InterventionQueueResponse> {
  const now = new Date();
  const students = await prisma.student.findMany({
    where: buildManagedStudentWhere(session, {
      classId: options.classId,
      includeInactiveAccounts: false,
    }),
    select: interventionQueueStudentSelect(now),
  });

  const orientationTotalCount = await prisma.orientationItem.count();
  return buildQueueResponse(students, orientationTotalCount, now);
}

/**
 * Coordinator variant of `getInterventionQueue`.
 *
 * Coordinator sessions collapse to role="student" under RLS (first-class
 * coordinator policies are a Slice D concern — see the coordinator note in
 * the baseline migration), so the RLS-scoped `prisma` client silently
 * returns zero Student rows for them. Until Slice D ships, coordinator
 * reads follow the interim pattern documented in wager-metrics: query via
 * `prismaAdmin`, explicitly scoped — here to active students enrolled
 * (non-archived enrollment) in non-archived classes inside the
 * coordinator's active regions. Fails closed to an empty queue when the
 * coordinator has no region assignments.
 */
export async function getCoordinatorInterventionQueue(
  session: Session,
): Promise<InterventionQueueResponse> {
  if (session.role !== "coordinator") {
    throw forbidden("Coordinator session required.");
  }

  const assignments = await prismaAdmin.regionCoordinator.findMany({
    where: { coordinatorId: session.id, region: { status: "active" } },
    select: { regionId: true },
  });
  const regionIds = assignments.map((assignment) => assignment.regionId);
  if (regionIds.length === 0) {
    return { queue: [] };
  }

  const now = new Date();
  const students = await prismaAdmin.student.findMany({
    where: {
      role: "student",
      isActive: true,
      classEnrollments: {
        some: {
          status: { in: [...NON_ARCHIVED_ENROLLMENT_STATUSES] },
          class: {
            regionId: { in: regionIds },
            status: { not: "archived" },
          },
        },
      },
    },
    select: interventionQueueStudentSelect(now),
  });

  const orientationTotalCount = await prismaAdmin.orientationItem.count();
  return buildQueueResponse(students, orientationTotalCount, now);
}

export async function getTeacherDashboardPage(
  session: Session,
  options: {
    page?: number;
    limit?: number;
    showInactive?: boolean;
    classId?: string;
  } = {},
): Promise<TeacherDashboardPageData> {
  const page = options.page ?? 1;
  const limit = Math.min(options.limit ?? 50, 100);
  const showInactive = options.showInactive ?? false;
  const requestedClassId = options.classId?.trim() || "";
  const now = new Date();
  const upcomingWindow = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 7);

  if (requestedClassId) {
    await assertStaffCanManageClass(session, requestedClassId);
  }

  const [classes, managedStudentIds] = await Promise.all([
    listManagedClasses(session),
    listManagedStudentIds(session, {
      classId: requestedClassId || undefined,
      includeInactiveAccounts: true,
    }),
  ]);

  const studentWhere = buildManagedStudentWhere(session, {
    classId: requestedClassId || undefined,
    includeInactiveAccounts: showInactive,
  });
  const total = await prisma.student.count({ where: studentWhere });

  const students = await prisma.student.findMany({
    where: studentWhere,
    select: {
      id: true,
      studentId: true,
      displayName: true,
      createdAt: true,
      isActive: true,
      progression: { select: { state: true } },
      goals: {
        select: { level: true, status: true, updatedAt: true },
      },
      orientationProgress: {
        where: { completed: true },
        select: { id: true, completedAt: true },
      },
      certifications: {
        select: {
          status: true,
          requirements: {
            select: { templateId: true, completed: true, verifiedBy: true, fileId: true },
          },
        },
      },
      // Fetch only the most-recent entry for each — we need the latest
      // updatedAt/uploadedAt for lastActive, counts come from _count.
      portfolioItems: {
        select: { updatedAt: true },
        orderBy: { updatedAt: "desc" },
        take: 1,
      },
      resumeData: { select: { id: true } },
      files: {
        select: { uploadedAt: true },
        orderBy: { uploadedAt: "desc" },
        take: 1,
      },
      _count: { select: { portfolioItems: true, files: true } },
      formSubmissions: {
        select: { id: true, formId: true, fileId: true, status: true, updatedAt: true },
        orderBy: { updatedAt: "desc" },
      },
      applications: {
        select: { id: true, updatedAt: true },
        orderBy: { updatedAt: "desc" },
        take: 1,
      },
      eventRegistrations: {
        select: { id: true, updatedAt: true },
        orderBy: { updatedAt: "desc" },
        take: 1,
      },
      alerts: {
        where: { status: "open" },
        select: { id: true, severity: true, title: true, detectedAt: true },
      },
      appointments: {
        where: {
          status: "scheduled",
          startsAt: { gte: now },
        },
        select: { id: true, startsAt: true },
        orderBy: { startsAt: "asc" },
        take: 1,
      },
      conversations: {
        select: { id: true, updatedAt: true },
        orderBy: { updatedAt: "desc" },
        take: 1,
      },
      classEnrollments: {
        select: {
          enrolledAt: true,
          status: true,
          class: { select: { programType: true } },
        },
        orderBy: { enrolledAt: "desc" },
      },
    },
    orderBy: { displayName: "asc" },
    skip: (page - 1) * limit,
    take: limit,
  });

  const [orientationTotal, certTemplates, complianceMap] = await Promise.all([
    prisma.orientationItem.count(),
    prisma.certTemplate.findMany({
      where: { certType: "ready-to-work" },
      select: {
        id: true,
        required: true,
        needsFile: true,
        needsVerify: true,
      },
    }),
    requestedClassId
      ? checkClassCompliance(requestedClassId)
      : Promise.resolve(new Map()),
  ]);

  // Ticket D1 (2026-09-07): the roster's readiness score is the SAME
  // reconciled mapping every other surface uses (readiness-consumers.ts),
  // reached through the batched loader so one page of students costs a
  // constant number of queries, not one query per student.
  const readinessByStudent = await fetchReadinessDataForStudents(
    students.map((student) => student.id),
  );

  const overview = students.map((student) => {
    let xp = 0;
    let level = 1;
    let streak = 0;
    if (student.progression?.state) {
      try {
        const state = JSON.parse(student.progression.state);
        xp = state.xp || 0;
        level = state.level || 1;
        streak = state.currentStreak || state.streaks?.daily?.current || 0;
      } catch {
        // Ignore malformed progression state and fall back to defaults.
      }
    }

    const planningGoals = student.goals.filter((goal) => goalCountsTowardPlan(goal.status));
    const goalsByLevel: Record<string, number> = {};
    const completedGoalLevels: string[] = [];
    for (const goal of planningGoals) {
      goalsByLevel[goal.level] = (goalsByLevel[goal.level] || 0) + 1;
      if (goal.status === "completed" && !completedGoalLevels.includes(goal.level)) {
        completedGoalLevels.push(goal.level);
      }
    }
    const hasBhag = !!goalsByLevel.bhag;

    const certification = student.certifications[0];
    const certDone = certification
      ? getCertificationProgress(certTemplates, certification.requirements).done
      : 0;
    const certPendingVerify = certification
      ? certification.requirements.filter((requirement) => requirement.completed && !requirement.verifiedBy).length
      : 0;

    // Ticket D1 (2026-09-07): the roster no longer builds its own readiness
    // input — it reads the SAME reconciled score every other surface uses,
    // from the batch fetched above. `readinessByStudent` always has an entry
    // for every id in `students`, since that is exactly what it was asked for.
    const readiness = readinessByStudent.get(student.id)!.readiness;
    const lastActiveAt =
      latestDate(
        student.createdAt,
        student.conversations[0]?.updatedAt,
        ...student.goals.map((goal) => goal.updatedAt),
        ...student.orientationProgress.map((progress) => progress.completedAt || null),
        ...student.portfolioItems.map((item) => item.updatedAt),
        ...student.files.map((file) => file.uploadedAt),
        student.formSubmissions[0]?.updatedAt,
        student.applications[0]?.updatedAt,
        student.eventRegistrations[0]?.updatedAt,
      ) || student.createdAt;

    const activeEnrollment =
      student.classEnrollments.find((enrollment) => enrollment.status === "active") ??
      student.classEnrollments[0];
    const programType = normalizeProgramType(activeEnrollment?.class.programType);

    return {
      id: student.id,
      studentId: student.studentId,
      displayName: student.displayName,
      programType,
      createdAt: student.createdAt.toISOString(),
      isActive: student.isActive,
      lastActive: lastActiveAt.toISOString(),
      xp,
      level,
      streak,
      hasBhag,
      goalsCount: planningGoals.length,
      orientationDone: student.orientationProgress.length,
      orientationTotal,
      certStatus: certification?.status || "not_started",
      certDone,
      certTotal: certTemplates.filter((template) => template.required).length,
      certPendingVerify,
      openAlertCount: student.alerts.length,
      nextAppointmentAt: student.appointments[0]?.startsAt.toISOString() ?? null,
      portfolioItems: student._count.portfolioItems,
      hasResume: !!student.resumeData,
      filesCount: student._count.files,
      readinessScore: readiness.score,
      requirementsMet: complianceMap.get(student.id)?.requiredMet ?? 0,
      requirementsTotal: complianceMap.get(student.id)?.requiredCount ?? 0,
      intakeStatus: (() => {
        const intakeSub = student.formSubmissions.find(
          (s) => s.formId === "orientation-intake" || s.formId === "student-intake"
        );
        if (!intakeSub) return "missing" as const;
        return (intakeSub.status === "approved" ? "certified" : "needs_review") as "certified" | "needs_review";
      })(),
      intakeFileId:
        student.formSubmissions.find(
          (s) => s.formId === "orientation-intake" || s.formId === "student-intake"
        )?.fileId ?? null,
    };
  });

  const upcomingAppointments = await prisma.appointment.findMany({
    where: {
      studentId: { in: managedStudentIds },
      status: "scheduled",
      startsAt: {
        gte: now,
        lte: upcomingWindow,
      },
    },
    select: {
      id: true,
      title: true,
      startsAt: true,
      endsAt: true,
      locationType: true,
      locationLabel: true,
      student: {
        select: {
          id: true,
          studentId: true,
          displayName: true,
        },
      },
    },
    orderBy: { startsAt: "asc" },
    take: 6,
  });

  const classOptions: ManagedClassOption[] = classes.map((item) => ({
    id: item.id,
    name: item.name,
    code: item.code,
    status: item.status,
    programType: normalizeProgramType(item.programType),
  }));

  return {
    classes: classOptions,
    currentClassId: requestedClassId || null,
    students: overview,
    upcomingAppointments: upcomingAppointments.map((appointment) => ({
      ...appointment,
      startsAt: appointment.startsAt.toISOString(),
      endsAt: appointment.endsAt.toISOString(),
    })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

export async function getTeacherHomeData(
  session: Session,
  options: { classId?: string } = {},
) {
  const [overview, queue] = await Promise.all([
    getTeacherDashboardPage(session, { page: 1, limit: 50, classId: options.classId }),
    getInterventionQueue(session, { classId: options.classId }),
  ]);

  return { overview, queue };
}
