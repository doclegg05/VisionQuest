import PageIntro from "@/components/ui/PageIntro";
import EventsHub from "@/components/career/EventsHub";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export default async function EventsPage() {
  const session = await getSession();
  if (!session) return null;

  const events = await prisma.careerEvent.findMany({
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
  });

  return (
    <div className="page-shell">
      <PageIntro
        eyebrow="Career"
        title="Events"
        description="Register for workshops, hiring events, and other career-building experiences from one place."
      />

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
    </div>
  );
}
