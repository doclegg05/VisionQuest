import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  formatMinutesLabel,
  isAvailabilityLocationType,
  minutesFromTimeInput,
} from "@/lib/advising";
import { logAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/db";

async function requireTeacher() {
  const session = await getSession();
  if (!session || session.role !== "teacher") return null;
  return session;
}

function isValidUrl(value: string | null | undefined) {
  if (!value) return true;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

export async function GET() {
  const teacher = await requireTeacher();
  if (!teacher) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const [blocks, scheduledAppointments] = await Promise.all([
    prisma.advisorAvailability.findMany({
      where: { advisorId: teacher.id },
      orderBy: [{ weekday: "asc" }, { startMinutes: "asc" }],
    }),
    prisma.appointment.count({
      where: {
        advisorId: teacher.id,
        status: "scheduled",
        startsAt: { gte: new Date() },
      },
    }),
  ]);

  return NextResponse.json({
    blocks: blocks.map((block) => ({
      ...block,
      startLabel: formatMinutesLabel(block.startMinutes),
      endLabel: formatMinutesLabel(block.endMinutes),
    })),
    scheduledAppointments,
  });
}

export async function POST(req: Request) {
  const teacher = await requireTeacher();
  if (!teacher) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const weekday = Number(body.weekday);
  const startMinutes = minutesFromTimeInput(typeof body.startTime === "string" ? body.startTime : "");
  const endMinutes = minutesFromTimeInput(typeof body.endTime === "string" ? body.endTime : "");
  const slotMinutes = Number(body.slotMinutes);
  const locationType = typeof body.locationType === "string" ? body.locationType.trim() : "virtual";
  const locationLabel = typeof body.locationLabel === "string" ? body.locationLabel.trim() : "";
  const meetingUrl = typeof body.meetingUrl === "string" ? body.meetingUrl.trim() : "";

  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
    return NextResponse.json({ error: "Weekday is invalid." }, { status: 400 });
  }
  if (startMinutes === null || endMinutes === null) {
    return NextResponse.json({ error: "Start and end time are required." }, { status: 400 });
  }
  if (endMinutes <= startMinutes) {
    return NextResponse.json({ error: "End time must be after start time." }, { status: 400 });
  }
  if (!Number.isInteger(slotMinutes) || slotMinutes < 15 || slotMinutes > 120 || slotMinutes % 15 !== 0) {
    return NextResponse.json({ error: "Slot length must be 15 to 120 minutes in 15-minute increments." }, { status: 400 });
  }
  if (!isAvailabilityLocationType(locationType)) {
    return NextResponse.json({ error: "Location type is invalid." }, { status: 400 });
  }
  if (!isValidUrl(meetingUrl)) {
    return NextResponse.json({ error: "Meeting URL must be valid." }, { status: 400 });
  }

  const block = await prisma.advisorAvailability.create({
    data: {
      advisorId: teacher.id,
      weekday,
      startMinutes,
      endMinutes,
      slotMinutes,
      locationType,
      locationLabel: locationLabel || null,
      meetingUrl: meetingUrl || null,
    },
  });

  await logAuditEvent({
    actorId: teacher.id,
    actorRole: teacher.role,
    action: "availability.created",
    targetType: "advisor_availability",
    targetId: block.id,
    summary: `Added availability on weekday ${weekday}.`,
    metadata: {
      weekday,
      startMinutes,
      endMinutes,
      slotMinutes,
      locationType,
    },
  });

  return NextResponse.json({ block });
}
