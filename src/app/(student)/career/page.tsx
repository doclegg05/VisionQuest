import CareerHub from "@/components/career/CareerHub";
import PageIntro from "@/components/ui/PageIntro";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export default async function CareerPage() {
  const session = await getSession();
  if (!session) return null;

  const [opportunities, events] = await Promise.all([
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
  ]);

  return (
    <div className="page-shell">
      <PageIntro
        eyebrow="Career"
        title="Career"
        description="Keep jobs, applications, and career events in one place so your search stays visible and actionable."
      />
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
