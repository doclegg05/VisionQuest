import { NextResponse } from "next/server";
import { withTeacherAuth } from "@/lib/api-error";
import { logAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/db";

function isValidUrl(value: string | null | undefined) {
  if (!value) return true;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

export const GET = withTeacherAuth(async (_session) => {
  const events = await prisma.careerEvent.findMany({
    include: {
      registrations: {
        select: { id: true },
      },
    },
    orderBy: [{ startsAt: "asc" }, { createdAt: "desc" }],
  });

  return NextResponse.json({
    events: events.map((event) => ({
      ...event,
      registrationCount: event.registrations.length,
    })),
  });
});

export const POST = withTeacherAuth(async (session, req: Request) => {
  const body = await req.json();
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const location = typeof body.location === "string" ? body.location.trim() : "";
  const virtualUrl = typeof body.virtualUrl === "string" ? body.virtualUrl.trim() : "";
  const startsAt = typeof body.startsAt === "string" ? new Date(body.startsAt) : null;
  const endsAt = typeof body.endsAt === "string" ? new Date(body.endsAt) : null;
  const capacity = body.capacity === "" || body.capacity === null || body.capacity === undefined
    ? null
    : Number(body.capacity);
  const registrationRequired = Boolean(body.registrationRequired);

  if (!title || !startsAt || !endsAt || Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
    return NextResponse.json({ error: "Title, start, and end time are required." }, { status: 400 });
  }
  if (endsAt <= startsAt) {
    return NextResponse.json({ error: "End time must be after start time." }, { status: 400 });
  }
  if (capacity !== null && (!Number.isInteger(capacity) || capacity < 1)) {
    return NextResponse.json({ error: "Capacity must be a positive number." }, { status: 400 });
  }
  if (!isValidUrl(virtualUrl)) {
    return NextResponse.json({ error: "Virtual URL must be valid." }, { status: 400 });
  }

  const event = await prisma.careerEvent.create({
    data: {
      title,
      description: description || null,
      location: location || null,
      virtualUrl: virtualUrl || null,
      startsAt,
      endsAt,
      capacity,
      registrationRequired,
      createdById: session.id,
    },
  });

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "event.created",
    targetType: "event",
    targetId: event.id,
    summary: `Created event "${title}".`,
  });

  return NextResponse.json({ event });
});

export const PUT = withTeacherAuth(async (session, req: Request) => {
  const body = await req.json();
  const id = typeof body.id === "string" ? body.id : "";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const location = typeof body.location === "string" ? body.location.trim() : "";
  const virtualUrl = typeof body.virtualUrl === "string" ? body.virtualUrl.trim() : "";
  const status = typeof body.status === "string" ? body.status.trim() : "scheduled";
  const startsAt = typeof body.startsAt === "string" ? new Date(body.startsAt) : null;
  const endsAt = typeof body.endsAt === "string" ? new Date(body.endsAt) : null;
  const capacity = body.capacity === "" || body.capacity === null || body.capacity === undefined
    ? null
    : Number(body.capacity);
  const registrationRequired = Boolean(body.registrationRequired);

  if (!id || !title || !startsAt || !endsAt || Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
    return NextResponse.json({ error: "Event ID, title, start, and end time are required." }, { status: 400 });
  }
  if (endsAt <= startsAt) {
    return NextResponse.json({ error: "End time must be after start time." }, { status: 400 });
  }
  if (capacity !== null && (!Number.isInteger(capacity) || capacity < 1)) {
    return NextResponse.json({ error: "Capacity must be a positive number." }, { status: 400 });
  }
  if (!isValidUrl(virtualUrl)) {
    return NextResponse.json({ error: "Virtual URL must be valid." }, { status: 400 });
  }

  const event = await prisma.careerEvent.update({
    where: { id },
    data: {
      title,
      description: description || null,
      location: location || null,
      virtualUrl: virtualUrl || null,
      status,
      startsAt,
      endsAt,
      capacity,
      registrationRequired,
    },
  });

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "event.updated",
    targetType: "event",
    targetId: event.id,
    summary: `Updated event "${title}".`,
  });

  return NextResponse.json({ event });
});

export const DELETE = withTeacherAuth(async (session, req: Request) => {
  const body = await req.json();
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) {
    return NextResponse.json({ error: "Event ID is required." }, { status: 400 });
  }

  const event = await prisma.careerEvent.delete({
    where: { id },
    select: { id: true, title: true },
  });

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "event.deleted",
    targetType: "event",
    targetId: event.id,
    summary: `Deleted event "${event.title}".`,
  });

  return NextResponse.json({ ok: true });
});
