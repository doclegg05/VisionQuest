import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { logAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { ensureSpokesRecordForStudent } from "@/lib/spokes";

async function requireTeacher() {
  const session = await getSession();
  if (!session || session.role !== "teacher") return null;
  return session;
}

function parseRequiredDate(value: unknown) {
  if (typeof value !== "string" || !value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseCheckpoint(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const teacher = await requireTeacher();
  if (!teacher) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();
  const checkpointMonths = parseCheckpoint(body.checkpointMonths);
  const checkedAt = parseRequiredDate(body.checkedAt);

  if (!checkpointMonths) {
    return NextResponse.json({ error: "checkpointMonths is required." }, { status: 400 });
  }
  if (!checkedAt) {
    return NextResponse.json({ error: "checkedAt is required." }, { status: 400 });
  }
  if (typeof body.status !== "string" || !body.status.trim()) {
    return NextResponse.json({ error: "status is required." }, { status: 400 });
  }

  const record = await ensureSpokesRecordForStudent(id);
  const followUp = await prisma.spokesEmploymentFollowUp.upsert({
    where: {
      recordId_checkpointMonths: {
        recordId: record.id,
        checkpointMonths,
      },
    },
    update: {
      status: body.status.trim(),
      checkedAt,
      notes:
        body.notes === ""
          ? null
          : typeof body.notes === "string"
            ? body.notes
            : undefined,
    },
    create: {
      recordId: record.id,
      checkpointMonths,
      status: body.status.trim(),
      checkedAt,
      notes: typeof body.notes === "string" && body.notes ? body.notes : null,
    },
  });

  await logAuditEvent({
    actorId: teacher.id,
    actorRole: teacher.role,
    action: "teacher.spokes.follow_up.update",
    targetType: "spokes_employment_follow_up",
    targetId: followUp.id,
    summary: `Recorded ${checkpointMonths}-month employment follow-up as ${followUp.status}.`,
    metadata: {
      studentId: id,
    },
  });

  return NextResponse.json({ followUp });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const teacher = await requireTeacher();
  if (!teacher) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();
  const checkpointMonths = parseCheckpoint(body.checkpointMonths);

  if (!checkpointMonths) {
    return NextResponse.json({ error: "checkpointMonths is required." }, { status: 400 });
  }

  const record = await ensureSpokesRecordForStudent(id);
  const existing = await prisma.spokesEmploymentFollowUp.findUnique({
    where: {
      recordId_checkpointMonths: {
        recordId: record.id,
        checkpointMonths,
      },
    },
  });

  if (!existing) {
    return NextResponse.json({ error: "Follow-up not found." }, { status: 404 });
  }

  await prisma.spokesEmploymentFollowUp.delete({ where: { id: existing.id } });

  await logAuditEvent({
    actorId: teacher.id,
    actorRole: teacher.role,
    action: "teacher.spokes.follow_up.delete",
    targetType: "spokes_employment_follow_up",
    targetId: existing.id,
    summary: `Removed ${checkpointMonths}-month employment follow-up.`,
    metadata: {
      studentId: id,
    },
  });

  return NextResponse.json({ ok: true });
}
