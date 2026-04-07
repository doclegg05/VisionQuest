import { checkStudentCompliance } from "./class-requirement-compliance";
import { prisma } from "./db";
import { ALL_INACTIVITY_ALERT_TYPES } from "./inactivity";

export async function loadStudentAlertSyncContext(studentId: string, now: Date) {
  const [tasks, appointments, studentSignals, orientationItems, existing, recentMoodEntries] = await prisma.$transaction([
    prisma.studentTask.findMany({
      where: {
        studentId,
        status: { in: ["open", "in_progress"] },
        dueAt: { not: null, lt: now },
      },
      select: { id: true, title: true, dueAt: true },
    }),
    prisma.appointment.findMany({
      where: {
        studentId,
        OR: [
          {
            status: "scheduled",
            endsAt: { lt: now },
          },
          {
            status: "missed",
          },
        ],
      },
      select: { id: true, title: true, startsAt: true, endsAt: true },
    }),
    prisma.student.findUnique({
      where: { id: studentId },
      select: {
        id: true,
        studentId: true,
        displayName: true,
        email: true,
        createdAt: true,
        progression: {
          select: { state: true },
        },
        conversations: {
          select: { updatedAt: true },
          orderBy: { updatedAt: "desc" },
          take: 1,
        },
        goals: {
          select: {
            id: true,
            level: true,
            content: true,
            status: true,
            createdAt: true,
            updatedAt: true,
          },
          orderBy: { updatedAt: "desc" },
        },
        goalResourceLinks: {
          select: {
            id: true,
            goalId: true,
            resourceType: true,
            resourceId: true,
            title: true,
            description: true,
            url: true,
            linkType: true,
            status: true,
            dueAt: true,
            notes: true,
            assignedById: true,
            createdAt: true,
            updatedAt: true,
          },
          orderBy: { createdAt: "asc" },
        },
        formSubmissions: {
          select: {
            id: true,
            formId: true,
            status: true,
            createdAt: true,
            updatedAt: true,
            reviewedAt: true,
            notes: true,
          },
          orderBy: { updatedAt: "desc" },
        },
        orientationProgress: {
          select: {
            itemId: true,
            completed: true,
            completedAt: true,
          },
        },
        portfolioItems: {
          select: {
            id: true,
            title: true,
            type: true,
            createdAt: true,
            updatedAt: true,
          },
          orderBy: { updatedAt: "desc" },
        },
        resumeData: {
          select: { id: true },
        },
        publicCredentialPage: {
          select: {
            isPublic: true,
            updatedAt: true,
          },
        },
        files: {
          select: { uploadedAt: true },
          orderBy: { uploadedAt: "desc" },
          take: 1,
        },
        appointments: {
          select: { updatedAt: true },
          orderBy: { updatedAt: "desc" },
          take: 1,
        },
        assignedTasks: {
          select: { updatedAt: true },
          orderBy: { updatedAt: "desc" },
          take: 1,
        },
        eventRegistrations: {
          select: {
            id: true,
            eventId: true,
            status: true,
            updatedAt: true,
            registeredAt: true,
          },
          orderBy: { updatedAt: "desc" },
        },
        applications: {
          select: {
            id: true,
            opportunityId: true,
            status: true,
            updatedAt: true,
            appliedAt: true,
          },
          orderBy: { updatedAt: "desc" },
        },
        certifications: {
          where: { certType: "ready-to-work" },
          select: {
            status: true,
            startedAt: true,
            completedAt: true,
            requirements: {
              select: {
                templateId: true,
                completed: true,
                completedAt: true,
                verifiedAt: true,
                verifiedBy: true,
                template: {
                  select: {
                    required: true,
                  },
                },
              },
            },
          },
          take: 1,
        },
        _count: {
          select: {
            applications: true,
            eventRegistrations: true,
          },
        },
      },
    }),
    prisma.orientationItem.findMany({
      select: {
        id: true,
        label: true,
        required: true,
      },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.studentAlert.findMany({
      where: {
        studentId,
        status: { in: ["open", "snoozed", "dismissed"] },
        type: {
          in: [
            "overdue_task",
            "missed_appointment",
            "career_inactive",
            "certification_stalled",
            "goal_needs_resource",
            "goal_resource_stale",
            "goal_review_pending",
            "orientation_form_missing",
            "orientation_form_pending_review",
            "orientation_form_revision_needed",
            "orientation_item_incomplete",
            "goal_stale",
            "orientation_not_started",
            "orientation_overdue",
            "motivation_declining",
            "requirement_noncompliant",
            ...ALL_INACTIVITY_ALERT_TYPES,
          ],
        },
      },
      select: { id: true, alertKey: true, status: true, snoozedUntil: true },
    }),
    prisma.moodEntry.findMany({
      where: { studentId },
      orderBy: { extractedAt: "desc" },
      take: 3,
      select: { score: true, extractedAt: true },
    }),
  ]);

  // Check class requirement compliance (outside the transaction since it's read-only)
  const compliance = await checkStudentCompliance(studentId);

  return {
    tasks,
    appointments,
    studentSignals,
    orientationItems,
    existing,
    recentMoodEntries,
    compliance,
  };
}
