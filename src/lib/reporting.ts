import { syncAlertsForStudents } from "./advising";
import { prisma } from "./db";

function latestDate(...values: Array<Date | null | undefined>) {
  return values.reduce<Date | null>((latest, value) => {
    if (!value) return latest;
    if (!latest || value.getTime() > latest.getTime()) return value;
    return latest;
  }, null);
}

function countDaysSince(value: Date, now: Date) {
  return Math.floor((now.getTime() - value.getTime()) / (1000 * 60 * 60 * 24));
}

export async function getTeacherOutcomeReport() {
  const now = new Date();
  const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const studentIds = await prisma.student.findMany({
    where: { role: "student" },
    select: { id: true },
    orderBy: { displayName: "asc" },
  });

  await syncAlertsForStudents(studentIds.map((student) => student.id));

  const [orientationTotal, students, recentApplications, activeOpportunityCount, closingSoonOpportunityCount, upcomingEvents] =
    await Promise.all([
      prisma.orientationItem.count(),
      prisma.student.findMany({
        where: { role: "student" },
        select: {
          id: true,
          studentId: true,
          displayName: true,
          createdAt: true,
          alerts: {
            where: { status: "open" },
            select: {
              id: true,
              severity: true,
              title: true,
            },
          },
          conversations: {
            select: { updatedAt: true },
            orderBy: { updatedAt: "desc" },
            take: 1,
          },
          goals: {
            select: { updatedAt: true },
            orderBy: { updatedAt: "desc" },
            take: 1,
          },
          portfolioItems: {
            select: { updatedAt: true },
            orderBy: { updatedAt: "desc" },
            take: 1,
          },
          files: {
            select: { uploadedAt: true },
            orderBy: { uploadedAt: "desc" },
            take: 1,
          },
          orientationProgress: {
            where: { completed: true },
            select: { id: true },
          },
          assignedTasks: {
            select: {
              id: true,
              status: true,
              dueAt: true,
              updatedAt: true,
            },
          },
          appointments: {
            select: {
              id: true,
              status: true,
              startsAt: true,
              endsAt: true,
              updatedAt: true,
            },
            orderBy: { startsAt: "asc" },
          },
          applications: {
            select: {
              id: true,
              status: true,
              updatedAt: true,
            },
          },
          eventRegistrations: {
            select: {
              id: true,
              status: true,
              updatedAt: true,
            },
          },
          certifications: {
            where: { certType: "ready-to-work" },
            select: {
              status: true,
            },
            take: 1,
          },
          publicCredentialPage: {
            select: {
              isPublic: true,
              slug: true,
            },
          },
        },
        orderBy: { displayName: "asc" },
      }),
      prisma.application.findMany({
        where: {
          status: {
            in: ["applied", "interviewing", "offer"],
          },
        },
        select: {
          id: true,
          status: true,
          updatedAt: true,
          student: {
            select: {
              id: true,
              studentId: true,
              displayName: true,
            },
          },
          opportunity: {
            select: {
              id: true,
              title: true,
              company: true,
            },
          },
        },
        orderBy: { updatedAt: "desc" },
        take: 8,
      }),
      prisma.opportunity.count({
        where: {
          status: "open",
        },
      }),
      prisma.opportunity.count({
        where: {
          status: "open",
          deadline: {
            gte: now,
            lte: sevenDaysFromNow,
          },
        },
      }),
      prisma.careerEvent.findMany({
        where: {
          status: "scheduled",
          startsAt: {
            gte: now,
          },
        },
        select: {
          id: true,
          title: true,
          startsAt: true,
          registrations: {
            where: {
              status: "registered",
            },
            select: {
              id: true,
            },
          },
        },
        orderBy: { startsAt: "asc" },
        take: 5,
      }),
    ]);

  const studentRollups = students.map((student) => {
    const lastActivityAt = latestDate(
      student.createdAt,
      student.conversations[0]?.updatedAt,
      student.goals[0]?.updatedAt,
      student.portfolioItems[0]?.updatedAt,
      student.files[0]?.uploadedAt,
      ...student.assignedTasks.map((task) => task.updatedAt),
      ...student.appointments.map((appointment) => appointment.updatedAt),
      ...student.applications.map((application) => application.updatedAt),
      ...student.eventRegistrations.map((registration) => registration.updatedAt)
    );
    const nextAppointmentAt =
      student.appointments.find(
        (appointment) => appointment.status === "scheduled" && appointment.startsAt >= now
      )?.startsAt || null;
    const openTaskCount = student.assignedTasks.filter((task) => task.status !== "completed").length;
    const overdueTaskCount = student.assignedTasks.filter(
      (task) => task.status !== "completed" && task.dueAt && task.dueAt < now
    ).length;
    const completedCertification = student.certifications[0]?.status === "completed";
    const applicationsInFlight = student.applications.filter((application) =>
      ["applied", "interviewing", "offer"].includes(application.status)
    ).length;
    const eventRegistrationCount = student.eventRegistrations.filter(
      (registration) => registration.status === "registered"
    ).length;

    return {
      id: student.id,
      studentId: student.studentId,
      displayName: student.displayName,
      openAlertCount: student.alerts.length,
      highSeverityAlertCount: student.alerts.filter((alert) => alert.severity === "high").length,
      topAlertTitle: student.alerts[0]?.title || null,
      lastActivityAt,
      daysSinceActivity: lastActivityAt ? countDaysSince(lastActivityAt, now) : null,
      nextAppointmentAt,
      openTaskCount,
      overdueTaskCount,
      orientationComplete:
        orientationTotal > 0 && student.orientationProgress.length >= orientationTotal,
      applicationsInFlight,
      interviewCount: student.applications.filter((application) => application.status === "interviewing").length,
      offerCount: student.applications.filter((application) => application.status === "offer").length,
      eventRegistrationCount,
      completedCertification,
      publicCredentialLive: Boolean(student.publicCredentialPage?.isPublic),
    };
  });

  const studentsNeedingAttention = studentRollups.filter((student) => student.openAlertCount > 0);
  const studentsWithCareerMomentum = studentRollups.filter(
    (student) => student.applicationsInFlight > 0 || student.eventRegistrationCount > 0
  );
  const totalEventRegistrations = studentRollups.reduce(
    (sum, student) => sum + student.eventRegistrationCount,
    0
  );
  const applicationsInFlight = studentRollups.reduce(
    (sum, student) => sum + student.applicationsInFlight,
    0
  );
  const interviewCount = studentRollups.reduce((sum, student) => sum + student.interviewCount, 0);
  const offerCount = studentRollups.reduce((sum, student) => sum + student.offerCount, 0);
  const completedCertificationCount = studentRollups.filter(
    (student) => student.completedCertification
  ).length;
  const publicCredentialCount = studentRollups.filter(
    (student) => student.publicCredentialLive
  ).length;
  const activeStudents7d = studentRollups.filter(
    (student) => student.lastActivityAt && student.lastActivityAt >= sevenDaysAgo
  ).length;

  return {
    summary: {
      totalStudents: studentRollups.length,
      activeStudents7d,
      studentsNeedingAttention: studentsNeedingAttention.length,
      openAlerts: studentRollups.reduce((sum, student) => sum + student.openAlertCount, 0),
      highSeverityAlerts: studentRollups.reduce(
        (sum, student) => sum + student.highSeverityAlertCount,
        0
      ),
      overdueTasks: studentRollups.reduce((sum, student) => sum + student.overdueTaskCount, 0),
      openTasks: studentRollups.reduce((sum, student) => sum + student.openTaskCount, 0),
      upcomingAppointments7d: studentRollups.filter(
        (student) =>
          student.nextAppointmentAt &&
          student.nextAppointmentAt >= now &&
          student.nextAppointmentAt <= sevenDaysFromNow
      ).length,
      activeOpportunities: activeOpportunityCount,
      closingSoonOpportunities: closingSoonOpportunityCount,
      applicationsInFlight,
      interviews: interviewCount,
      offers: offerCount,
      upcomingEvents: upcomingEvents.length,
      eventRegistrations: totalEventRegistrations,
      completedCertifications: completedCertificationCount,
      publicCredentialsLive: publicCredentialCount,
      studentsWithoutCareerMomentum:
        studentRollups.length - studentsWithCareerMomentum.length,
    },
    funnel: [
      { label: "Enrolled", value: studentRollups.length },
      {
        label: "Orientation complete",
        value: studentRollups.filter((student) => student.orientationComplete).length,
      },
      {
        label: "Certification complete",
        value: completedCertificationCount,
      },
      {
        label: "Career activity started",
        value: studentsWithCareerMomentum.length,
      },
      {
        label: "Interviewing",
        value: studentRollups.filter((student) => student.interviewCount > 0).length,
      },
      {
        label: "Offer received",
        value: studentRollups.filter((student) => student.offerCount > 0).length,
      },
      {
        label: "Public credential live",
        value: publicCredentialCount,
      },
    ],
    attentionQueue: studentRollups
      .filter((student) => student.openAlertCount > 0 || (student.daysSinceActivity || 0) >= 7)
      .sort((left, right) => {
        if (right.highSeverityAlertCount !== left.highSeverityAlertCount) {
          return right.highSeverityAlertCount - left.highSeverityAlertCount;
        }
        if (right.openAlertCount !== left.openAlertCount) {
          return right.openAlertCount - left.openAlertCount;
        }
        return (right.daysSinceActivity || 0) - (left.daysSinceActivity || 0);
      })
      .slice(0, 10),
    recentApplications: recentApplications.map((application) => ({
      ...application,
      updatedAt: application.updatedAt.toISOString(),
    })),
    upcomingEvents: upcomingEvents.map((event) => ({
      id: event.id,
      title: event.title,
      startsAt: event.startsAt.toISOString(),
      registrationCount: event.registrations.length,
    })),
  };
}
