import { NextResponse } from "next/server";
import { syncStudentAlerts } from "@/lib/advising";
import { logAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api-error";

export const POST = withAuth(async (
  session,
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;

  const event = await prisma.careerEvent.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      capacity: true,
      registrationRequired: true,
    },
  });

  if (!event) {
    return NextResponse.json({ error: "Event not found." }, { status: 404 });
  }

  let registration: Awaited<ReturnType<typeof prisma.eventRegistration.upsert>>;
  try {
    registration = await prisma.$transaction(async (tx) => {
      if (event.registrationRequired && event.capacity !== null) {
        const registeredCount = await tx.eventRegistration.count({
          where: { eventId: id, status: "registered" },
        });
        if (registeredCount >= event.capacity) {
          throw new Error("Event is full");
        }
      }

      return tx.eventRegistration.upsert({
        where: {
          studentId_eventId: {
            studentId: session.id,
            eventId: id,
          },
        },
        update: {
          status: "registered",
          registeredAt: new Date(),
        },
        create: {
          studentId: session.id,
          eventId: id,
          status: "registered",
        },
      });
    });
  } catch (err) {
    if (err instanceof Error && err.message === "Event is full") {
      return NextResponse.json({ error: "This event is full." }, { status: 409 });
    }
    throw err;
  }

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "event.registered",
    targetType: "event",
    targetId: id,
    summary: `Registered for "${event.title}".`,
    metadata: {
      registrationId: registration.id,
    },
  });

  await syncStudentAlerts(session.id);

  return NextResponse.json({ registration });
});

export const DELETE = withAuth(async (
  session,
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;

  const registration = await prisma.eventRegistration.findFirst({
    where: {
      studentId: session.id,
      eventId: id,
    },
    select: {
      id: true,
      event: {
        select: {
          title: true,
        },
      },
    },
  });

  if (!registration) {
    return NextResponse.json({ error: "Registration not found." }, { status: 404 });
  }

  await prisma.eventRegistration.delete({
    where: { id: registration.id },
  });

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "event.unregistered",
    targetType: "event",
    targetId: id,
    summary: `Cancelled registration for "${registration.event.title}".`,
  });

  await syncStudentAlerts(session.id);

  return NextResponse.json({ ok: true });
});
