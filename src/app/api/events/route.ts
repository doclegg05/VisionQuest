import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api-error";

export const GET = withAuth(async (session) => {
  const events = await prisma.careerEvent.findMany({
    where: { status: { not: "archived" } },
    include: {
      registrations: {
        select: {
          studentId: true,
          status: true,
          registeredAt: true,
        },
      },
    },
    orderBy: [{ startsAt: "asc" }, { createdAt: "desc" }],
  });

  return NextResponse.json({
    events: events.map(({ registrations, ...event }) => {
      const userRegistration = registrations.find((r) => r.studentId === session.id);
      return {
        ...event,
        registrationCount: registrations.length,
        userRegistration: userRegistration
          ? { status: userRegistration.status, registeredAt: userRegistration.registeredAt }
          : null,
      };
    }),
  });
});
