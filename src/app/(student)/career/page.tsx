import CareerDnaCallout from "@/components/career/CareerDnaCallout";
import CareerHub from "@/components/career/CareerHub";
import { PendingConnectionsPanel } from "@/components/student/PendingConnectionsPanel";
import { PathToEmployment } from "@/components/progression/PathToEmployment";
import PageIntro from "@/components/ui/PageIntro";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { resolveWeeklyJobsAlertOnView } from "@/lib/nudges/alerts";
import { getStudentNextStep } from "@/lib/progression/student-next-step";

export default async function CareerPage() {
  const session = await getSession();
  if (!session) return null;

  // The "new jobs are ready" card was raised because the student texted Y
  // asking to see them. Arriving here IS the answer, so it is closed on view
  // rather than left to expire — otherwise the Home next-step keeps pointing
  // at the page they are already on.
  await resolveWeeklyJobsAlertOnView(session.id);

  const [opportunities, events, nextStep] = await Promise.all([
    prisma.opportunity.findMany({
      where: { status: { not: "archived" } },
      include: {
        applications: {
          where: { studentId: session.id },
          select: {
            id: true,
            status: true,
            notes: true,
            resumeFileId: true,
            appliedAt: true,
            createdAt: true,
          },
        },
      },
      orderBy: [{ deadline: "asc" }, { createdAt: "desc" }],
    }),
    prisma.careerEvent.findMany({
      where: { status: { not: "archived" } },
      include: {
        registrations: {
          select: {
            id: true,
            studentId: true,
            status: true,
            registeredAt: true,
          },
        },
      },
      orderBy: [{ startsAt: "asc" }, { createdAt: "desc" }],
    }),
    getStudentNextStep(session.id),
  ]);

  return (
    <div className="page-shell space-y-6">
      <PathToEmployment
        currentStepKey={nextStep.currentStepKey}
        title={nextStep.title}
        description={nextStep.description}
        whyItMatters={nextStep.whyItMatters}
        actionLabel={nextStep.actionLabel}
        actionLink={nextStep.actionLink}
        steps={nextStep.steps}
        variant="compact"
      />
      <PageIntro
        eyebrow="Career"
        title="Career"
        description="See your Career DNA, jobs, applications, and events in one place. Always know your next step."
      />
      {/*
        Above the job board on purpose: an introduction waiting on this
        student's OK is the most time-sensitive thing on the page, and it is
        the one thing here that discloses something about them if they say yes.
        Renders nothing when there is nothing waiting or the pilot is off.
      */}
      <PendingConnectionsPanel />
      <CareerDnaCallout studentId={session.id} />
      <CareerHub
        opportunities={opportunities.map((opportunity) => ({
          ...opportunity,
          deadline: opportunity.deadline ? opportunity.deadline.toISOString() : null,
          application: opportunity.applications[0]
            ? {
                ...opportunity.applications[0],
                appliedAt: opportunity.applications[0].appliedAt
                  ? opportunity.applications[0].appliedAt.toISOString()
                  : null,
                createdAt: opportunity.applications[0].createdAt.toISOString(),
              }
            : null,
        }))}
        events={events.map((event) => {
          const registration =
            event.registrations.find((item) => item.studentId === session.id) || null;
          return {
            ...event,
            startsAt: event.startsAt.toISOString(),
            endsAt: event.endsAt.toISOString(),
            registration: registration
              ? {
                  id: registration.id,
                  status: registration.status,
                  registeredAt: registration.registeredAt.toISOString(),
                }
              : null,
            registrationCount: event.registrations.length,
          };
        })}
      />
    </div>
  );
}
