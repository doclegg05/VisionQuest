import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { withErrorHandler, unauthorized } from "@/lib/api-error";

export const GET = withErrorHandler(async () => {
  const session = await getSession();
  if (!session) throw unauthorized();

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

  return NextResponse.json({
    events: events.map((event) => ({
      ...event,
      registrationCount: event.registrations.length,
      registration: event.registrations.find((registration) => registration.studentId === session.id) || null,
    })),
  });
});
