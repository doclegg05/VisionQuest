import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAuditEvent } from "@/lib/audit";

async function requireTeacher() {
  const session = await getSession();
  if (!session || session.role !== "teacher") return null;
  return session;
}

// PATCH — toggle a student's active status
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const teacher = await requireTeacher();
  if (!teacher) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const body = await req.json();
  const isActive = body.isActive;

  if (typeof isActive !== "boolean") {
    return NextResponse.json({ error: "isActive must be a boolean" }, { status: 400 });
  }

  const student = await prisma.student.findUnique({
    where: { id },
    select: { id: true, studentId: true, role: true, isActive: true },
  });
  if (!student) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }
  if (student.role === "teacher") {
    return NextResponse.json({ error: "Cannot change status of teacher accounts" }, { status: 403 });
  }

  // Increment sessionVersion on deactivation to force logout
  await prisma.student.update({
    where: { id },
    data: {
      isActive,
      ...(isActive === false ? { sessionVersion: { increment: 1 } } : {}),
    },
  });

  await logAuditEvent({
    actorId: teacher.id,
    actorRole: teacher.role,
    action: isActive ? "teacher.student.reactivate" : "teacher.student.deactivate",
    targetType: "student",
    targetId: id,
    summary: `${isActive ? "Reactivated" : "Deactivated"} student ${student.studentId}.`,
  });

  return NextResponse.json({ ok: true, isActive });
}
