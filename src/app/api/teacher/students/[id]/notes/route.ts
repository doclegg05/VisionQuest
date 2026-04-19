import { NextResponse } from "next/server";
import { withTeacherAuth } from "@/lib/api-error";
import { isNoteCategory } from "@/lib/advising";
import { logAuditEvent } from "@/lib/audit";
import { assertStaffCanManageStudent } from "@/lib/classroom";
import { prisma } from "@/lib/db";

const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGE_LIMIT = 100;
const MAX_NOTE_CHARS = 10_000;

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

  if (note.length > MAX_NOTE_CHARS) {
    return NextResponse.json(
      { error: `Note text must be ${MAX_NOTE_CHARS.toLocaleString()} characters or fewer.` },
      { status: 400 },
    );
  }

  if (!isNoteCategory(category)) {
    return NextResponse.json({ error: "Invalid note category." }, { status: 400 });
  }

  const student = await assertStaffCanManageStudent(session, studentId);

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

export const GET = withTeacherAuth(async (
  session,
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id: studentId } = await params;

  await assertStaffCanManageStudent(session, studentId);

  const url = new URL(req.url);
  const categoryParam = url.searchParams.get("category");
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const limitParam = url.searchParams.get("limit");

  const rawLimit = limitParam ? parseInt(limitParam, 10) : DEFAULT_PAGE_LIMIT;
  const limit = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.min(rawLimit, MAX_PAGE_LIMIT)
    : DEFAULT_PAGE_LIMIT;

  if (categoryParam !== null && !isNoteCategory(categoryParam)) {
    return NextResponse.json({ error: "Invalid note category." }, { status: 400 });
  }

  const notes = await prisma.caseNote.findMany({
    where: {
      studentId,
      ...(categoryParam !== null ? { category: categoryParam } : {}),
    },
    include: {
      author: {
        select: { displayName: true },
      },
    },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasNextPage = notes.length > limit;
  const page = hasNextPage ? notes.slice(0, limit) : notes;
  const nextCursor = hasNextPage ? page[page.length - 1].id : null;

  return NextResponse.json({ notes: page, nextCursor });
});

export const PATCH = withTeacherAuth(async (
  session,
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id: studentId } = await params;

  await assertStaffCanManageStudent(session, studentId);

  const body = await req.json();

  const noteId = typeof body.noteId === "string" ? body.noteId.trim() : "";
  if (!noteId) {
    return NextResponse.json({ error: "noteId is required." }, { status: 400 });
  }

  const existing = await prisma.caseNote.findUnique({
    where: { id: noteId },
    select: { id: true, authorId: true, studentId: true },
  });

  if (!existing || existing.studentId !== studentId) {
    return NextResponse.json({ error: "Note not found." }, { status: 404 });
  }

  if (existing.authorId !== session.id && session.role !== "admin") {
    return NextResponse.json({ error: "You can only edit your own notes." }, { status: 403 });
  }

  const updates: { body?: string; category?: string } = {};

  if (typeof body.body === "string") {
    const trimmed = body.body.trim();
    if (!trimmed) {
      return NextResponse.json({ error: "Note text cannot be empty." }, { status: 400 });
    }
    if (trimmed.length > MAX_NOTE_CHARS) {
      return NextResponse.json(
        { error: `Note text must be ${MAX_NOTE_CHARS.toLocaleString()} characters or fewer.` },
        { status: 400 },
      );
    }
    updates.body = trimmed;
  }

  if (typeof body.category === "string") {
    const trimmed = body.category.trim();
    if (!isNoteCategory(trimmed)) {
      return NextResponse.json({ error: "Invalid note category." }, { status: 400 });
    }
    updates.category = trimmed;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No updatable fields provided." }, { status: 400 });
  }

  const updated = await prisma.caseNote.update({
    where: { id: noteId },
    data: updates,
    select: {
      id: true,
      category: true,
      body: true,
      updatedAt: true,
    },
  });

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "note.updated",
    targetType: "student",
    targetId: studentId,
    summary: `Updated case note.`,
    metadata: {
      noteId,
      fields: Object.keys(updates),
    },
  });

  return NextResponse.json({ note: updated });
});

export const DELETE = withTeacherAuth(async (
  session,
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id: studentId } = await params;

  await assertStaffCanManageStudent(session, studentId);

  const url = new URL(req.url);
  let noteId = url.searchParams.get("noteId") ?? "";

  if (!noteId) {
    const body = await req.json().catch(() => ({}));
    noteId = typeof body.noteId === "string" ? body.noteId.trim() : "";
  }

  if (!noteId) {
    return NextResponse.json({ error: "noteId is required." }, { status: 400 });
  }

  const existing = await prisma.caseNote.findUnique({
    where: { id: noteId },
    select: { id: true, authorId: true, studentId: true, category: true },
  });

  if (!existing || existing.studentId !== studentId) {
    return NextResponse.json({ error: "Note not found." }, { status: 404 });
  }

  if (existing.authorId !== session.id && session.role !== "admin") {
    return NextResponse.json({ error: "You can only delete your own notes." }, { status: 403 });
  }

  await prisma.caseNote.delete({ where: { id: noteId } });

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "note.deleted",
    targetType: "student",
    targetId: studentId,
    summary: `Deleted a ${existing.category} case note.`,
    metadata: {
      noteId,
      category: existing.category,
    },
  });

  return NextResponse.json({ success: true });
});
