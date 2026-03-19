import { NextResponse } from "next/server";
import { withTeacherAuth } from "@/lib/api-error";
import { isNoteCategory } from "@/lib/advising";
import { logAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/db";

export const POST = withTeacherAuth(async (
  session,
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
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
      authorId: session.id,
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
    actorId: session.id,
    actorRole: session.role,
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
});
