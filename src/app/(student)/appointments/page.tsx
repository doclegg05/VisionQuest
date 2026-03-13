import PageIntro from "@/components/ui/PageIntro";
import StudentAdvisingHub from "@/components/advising/StudentAdvisingHub";
import { getSession } from "@/lib/auth";
import { listBookableAdvisors, syncStudentAlerts } from "@/lib/advising";
import { prisma } from "@/lib/db";

export default async function AppointmentsPage() {
  const session = await getSession();
  if (!session) return null;

  await syncStudentAlerts(session.id);

  const [appointments, tasks, alerts, bookableAdvisors] = await Promise.all([
    prisma.appointment.findMany({
      where: { studentId: session.id },
      select: {
        id: true,
        title: true,
        description: true,
        startsAt: true,
        endsAt: true,
        status: true,
        locationType: true,
        locationLabel: true,
        meetingUrl: true,
        notes: true,
        advisor: {
          select: {
            displayName: true,
          },
        },
      },
      orderBy: [{ startsAt: "asc" }, { createdAt: "desc" }],
    }),
    prisma.studentTask.findMany({
      where: { studentId: session.id },
      select: {
        id: true,
        title: true,
        description: true,
        dueAt: true,
        status: true,
        priority: true,
        completedAt: true,
        createdAt: true,
        createdBy: {
          select: {
            displayName: true,
          },
        },
      },
      orderBy: [{ status: "asc" }, { dueAt: "asc" }, { createdAt: "desc" }],
    }),
    prisma.studentAlert.findMany({
      where: {
        studentId: session.id,
        status: "open",
      },
      select: {
        id: true,
        severity: true,
        title: true,
        summary: true,
        detectedAt: true,
      },
      orderBy: { detectedAt: "desc" },
    }),
    listBookableAdvisors(),
  ]);

  return (
    <div className="page-shell">
      <PageIntro
        eyebrow="Advising"
        title="Appointments & Follow-Up"
        description={
          appointments.length > 0
            ? "See your advising schedule, complete follow-ups, and stay current on anything that needs attention."
            : "Your advisors can add appointments and follow-ups here as your plan takes shape."
        }
      />

      <StudentAdvisingHub
        alerts={alerts.map((alert) => ({
          ...alert,
          detectedAt: alert.detectedAt.toISOString(),
        }))}
        appointments={appointments.map((appointment) => ({
          id: appointment.id,
          title: appointment.title,
          description: appointment.description,
          startsAt: appointment.startsAt.toISOString(),
          endsAt: appointment.endsAt.toISOString(),
          status: appointment.status,
          locationType: appointment.locationType,
          locationLabel: appointment.locationLabel,
          meetingUrl: appointment.meetingUrl,
          notes: appointment.notes,
          advisorName: appointment.advisor.displayName,
        }))}
        tasks={tasks.map((task) => ({
          id: task.id,
          title: task.title,
          description: task.description,
          dueAt: task.dueAt ? task.dueAt.toISOString() : null,
          status: task.status,
          priority: task.priority,
          completedAt: task.completedAt ? task.completedAt.toISOString() : null,
          createdAt: task.createdAt.toISOString(),
          createdByName: task.createdBy.displayName,
        }))}
        bookableAdvisors={bookableAdvisors}
      />
    </div>
  );
}
