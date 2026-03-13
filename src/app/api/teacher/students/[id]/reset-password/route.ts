import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { logAuditEvent } from "@/lib/audit";

async function requireTeacher() {
  const session = await getSession();
  if (!session || session.role !== "teacher") return null;
  return session;
}

// POST — reset a student's password
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const teacher = await requireTeacher();
  if (!teacher) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const { newPassword } = await req.json();

  if (!newPassword || newPassword.length < 6) {
    return NextResponse.json(
      { error: "Password must be at least 6 characters" },
      { status: 400 }
    );
  }

  const student = await prisma.student.findUnique({ where: { id } });
  if (!student || student.role === "teacher") {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  const { hash } = hashPassword(newPassword);
  await prisma.$transaction([
    prisma.student.update({
      where: { id },
      data: {
        passwordHash: hash,
        sessionVersion: { increment: 1 },
      },
    }),
    prisma.passwordResetToken.deleteMany({
      where: { studentId: id },
    }),
  ]);

  await logAuditEvent({
    actorId: teacher.id,
    actorRole: teacher.role,
    action: "teacher.password.reset",
    targetType: "student",
    targetId: id,
    summary: `Teacher reset the password for ${student.studentId}.`,
    metadata: {
      studentId: student.studentId,
    },
  });

  return NextResponse.json({ ok: true });
}
