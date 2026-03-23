import { NextResponse } from "next/server";
import { withTeacherAuth } from "@/lib/api-error";
import { assertStaffCanManageClass, buildManagedStudentWhere } from "@/lib/classroom";
import { prisma } from "@/lib/db";
import { logAuditEvent } from "@/lib/audit";
import { getCertificationProgress } from "@/lib/certifications";
import { goalCountsTowardPlan } from "@/lib/goals";

function latestDate(...values: Array<Date | null | undefined>) {
  return values.reduce<Date | null>((latest, value) => {
    if (!value) return latest;
    if (!latest || value.getTime() > latest.getTime()) return value;
    return latest;
  }, null);
}

// GET — export class data as CSV
export const GET = withTeacherAuth(async (session, req: Request) => {
  const now = new Date();
  const { searchParams } = new URL(req.url);
  const classId = searchParams.get("classId")?.trim() || "";

  if (classId) {
    await assertStaffCanManageClass(session, classId);
  }

  const students = await prisma.student.findMany({
    where: buildManagedStudentWhere(session, {
      classId: classId || undefined,
      includeInactiveAccounts: true,
    }),
    select: {
      id: true,
      studentId: true,
      displayName: true,
      email: true,
      createdAt: true,
      progression: { select: { state: true } },
      goals: { select: { level: true, status: true } },
      orientationProgress: { where: { completed: true }, select: { id: true } },
      certifications: {
        select: {
          status: true,
          requirements: { select: { templateId: true, completed: true, verifiedBy: true, fileId: true } },
        },
      },
      alerts: {
        where: { status: "open" },
        select: { id: true },
      },
      appointments: {
        where: {
          status: "scheduled",
          startsAt: { gte: now },
        },
        select: {
          startsAt: true,
        },
        orderBy: { startsAt: "asc" },
        take: 1,
      },
      assignedTasks: {
        select: {
          status: true,
          dueAt: true,
          updatedAt: true,
        },
      },
      applications: {
        select: {
          status: true,
          updatedAt: true,
        },
      },
      eventRegistrations: {
        select: {
          status: true,
          updatedAt: true,
        },
      },
      publicCredentialPage: {
        select: {
          isPublic: true,
        },
      },
      conversations: {
        select: {
          updatedAt: true,
        },
        orderBy: { updatedAt: "desc" },
        take: 1,
      },
      portfolioItems: { select: { id: true } },
      resumeData: { select: { id: true } },
      files: { select: { id: true } },
    },
    orderBy: { displayName: "asc" },
  });

  const orientationTotal = await prisma.orientationItem.count();
  const certTemplates = await prisma.certTemplate.findMany({
    where: { certType: "ready-to-work" },
    select: {
      id: true,
      required: true,
      needsFile: true,
      needsVerify: true,
    },
  });
  const requiredCertCount = certTemplates.filter((t) => t.required).length;

  // CSV header
  const headers = [
    "Student ID",
    "Display Name",
    "Email",
    "Enrolled Date",
    "Level",
    "XP",
    "Daily Streak",
    "Goals Count",
    "Has BHAG",
    "Orientation Done",
    "Orientation Total",
    "Cert Status",
    "Cert Done",
    "Cert Total",
    "Pending Verify",
    "Open Alerts",
    "Next Appointment",
    "Open Tasks",
    "Overdue Tasks",
    "Applications In Flight",
    "Interviewing",
    "Offers",
    "Event Registrations",
    "Public Credential Live",
    "Last Activity",
    "Portfolio Items",
    "Has Resume",
    "Files Uploaded",
  ];

  const rows = students.map((s) => {
    let xp = 0, level = 1, streak = 0;
    if (s.progression?.state) {
      try {
        const state = JSON.parse(s.progression.state);
        xp = state.xp || 0;
        level = state.level || 1;
        streak = state.streaks?.daily?.current || 0;
      } catch { /* ignore */ }
    }

    const planningGoals = s.goals.filter((goal) => goalCountsTowardPlan(goal.status));
    const hasBhag = planningGoals.some((g) => g.level === "bhag");
    const cert = s.certifications[0];
    const certDone = cert ? getCertificationProgress(certTemplates, cert.requirements).done : 0;
    const pendingVerify = cert ? cert.requirements.filter((r) => r.completed && !r.verifiedBy).length : 0;
    const applicationsInFlight = s.applications.filter((application) =>
      ["applied", "interviewing", "offer"].includes(application.status)
    ).length;
    const interviewing = s.applications.filter((application) => application.status === "interviewing").length;
    const offers = s.applications.filter((application) => application.status === "offer").length;
    const eventRegistrations = s.eventRegistrations.filter((registration) => registration.status === "registered").length;
    const openTasks = s.assignedTasks.filter((task) => task.status !== "completed").length;
    const overdueTasks = s.assignedTasks.filter(
      (task) => task.status !== "completed" && task.dueAt && task.dueAt < now
    ).length;
    const lastActivity = latestDate(
      s.createdAt,
      s.conversations[0]?.updatedAt,
      ...s.assignedTasks.map((task) => task.updatedAt),
      ...s.applications.map((application) => application.updatedAt),
      ...s.eventRegistrations.map((registration) => registration.updatedAt)
    );

    return [
      s.studentId,
      s.displayName,
      s.email || "",
      new Date(s.createdAt).toLocaleDateString(),
      level,
      xp,
      streak,
      planningGoals.length,
      hasBhag ? "Yes" : "No",
      s.orientationProgress.length,
      orientationTotal,
      cert?.status || "not_started",
      certDone,
      requiredCertCount,
      pendingVerify,
      s.alerts.length,
      s.appointments[0]?.startsAt ? s.appointments[0].startsAt.toISOString() : "",
      openTasks,
      overdueTasks,
      applicationsInFlight,
      interviewing,
      offers,
      eventRegistrations,
      s.publicCredentialPage?.isPublic ? "Yes" : "No",
      lastActivity ? lastActivity.toISOString() : "",
      s.portfolioItems.length,
      s.resumeData ? "Yes" : "No",
      s.files.length,
    ];
  });

  function escapeCsv(val: string | number | boolean) {
    const str = String(val);
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  const csv = [
    headers.map(escapeCsv).join(","),
    ...rows.map((row) => row.map(escapeCsv).join(",")),
  ].join("\n");

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "teacher.export.csv",
    targetType: "class",
    summary: "Teacher exported the student progress CSV.",
    metadata: {
      classId: classId || null,
      studentCount: students.length,
    },
  });

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="visionquest-class-export-${new Date().toISOString().split("T")[0]}.csv"`,
    },
  });
});
