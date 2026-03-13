import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { logAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/db";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const event = await prisma.careerEvent.findUnique({
    where: { id },
    include: {
      registrations: {
        select: { id: true },
      },
    },
  });

  if (!event) {
    return NextResponse.json({ error: "Event not found." }, { status: 404 });
  }

  if (event.registrationRequired && event.capacity !== null && event.registrations.length >= event.capacity) {
    return NextResponse.json({ error: "This event is full." }, { status: 409 });
  }

  const registration = await prisma.eventRegistration.upsert({
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

  return NextResponse.json({ registration });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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

  return NextResponse.json({ ok: true });
}
