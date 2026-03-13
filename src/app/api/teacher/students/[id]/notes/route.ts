import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { isNoteCategory } from "@/lib/advising";
import { logAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/db";

async function requireTeacher() {
  const session = await getSession();
  if (!session || session.role !== "teacher") return null;
  return session;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const teacher = await requireTeacher();
  if (!teacher) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id: studentId } = await params;
  const body = await req.json();

  const category = typeof body.category === "string" ? body.category.trim() : "general";
  const note = typeof body.body === "string" ? body.body.trim() : "";

  if (!note) {
    return NextResponse.json({ error: "Note text is required." }, { status: 400 });
  }

  if (!isNoteCategory(category)) {
    return NextResponse.json({ error: "Invalid note category." }, { status: 400 });
  }

  const student = await prisma.student.findFirst({
    where: {
      id: studentId,
      role: "student",
    },
    select: { id: true },
  });

  if (!student) {
    return NextResponse.json({ error: "Student not found." }, { status: 404 });
  }

  const created = await prisma.caseNote.create({
    data: {
      studentId,
      authorId: teacher.id,
      category,
      body: note,
      visibility: "teacher",
    },
    select: {
      id: true,
      category: true,
      createdAt: true,
    },
  });

  await logAuditEvent({
    actorId: teacher.id,
    actorRole: teacher.role,
    action: "note.created",
    targetType: "student",
    targetId: studentId,
    summary: `Added a ${category} case note.`,
    metadata: {
      noteId: created.id,
      category,
    },
  });

  return NextResponse.json({ note: created });
}
