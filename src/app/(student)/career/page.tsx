import EventsHub from "@/components/career/EventsHub";
import OpportunitiesHub from "@/components/career/OpportunitiesHub";
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
        description="Manage applications and upcoming career events from one place so your next steps stay visible."
      />

      <section id="opportunities">
        <div className="mb-4">
          <h2 className="font-display text-2xl text-[var(--ink-strong)]">Opportunities</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--ink-muted)]">
            Save roles, attach your current resume, and keep your application pipeline current.
          </p>
        </div>
        <OpportunitiesHub
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
        />
      </section>

      <section id="events" className="mt-10">
        <div className="mb-4">
          <h2 className="font-display text-2xl text-[var(--ink-strong)]">Events</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--ink-muted)]">
            Register for workshops, fairs, and hiring events without leaving your career workflow.
          </p>
        </div>
        <EventsHub
          events={events.map((event) => {
            const registration = event.registrations.find((item) => item.studentId === session.id) || null;
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
      </section>
    </div>
  );
}
