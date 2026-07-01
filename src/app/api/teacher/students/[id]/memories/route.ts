import { NextResponse } from "next/server";
import { z } from "zod";
import { withTeacherAuth } from "@/lib/api-error";
import { logAuditEvent } from "@/lib/audit";
import { invalidate } from "@/lib/cache";
import { assertStaffCanManageStudent } from "@/lib/classroom";
import { prisma } from "@/lib/db";

const MAX_MEMORIES = 100;

/**
 * GET /api/teacher/students/[id]/memories
 *
 * Memory inspector (Phase 2): lists what Sage remembers about a student so
 * staff can review, correct, or remove it — the FERPA right to inspect and
 * amend education records applies to AI-extracted facts too.
 */
export const GET = withTeacherAuth(async (
  session,
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id: studentId } = await params;
  const student = await assertStaffCanManageStudent(session, studentId);
  if (!student) {
    return NextResponse.json({ error: "Student not found." }, { status: 404 });
  }

  const memories = await prisma.sageMemory.findMany({
    where: { subjectType: "student", subjectId: studentId, validTo: null },
    select: {
      id: true,
      kind: true,
      content: true,
      category: true,
      confidence: true,
      validFrom: true,
      sourceType: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: MAX_MEMORIES,
  });

  return NextResponse.json({ success: true, data: { memories } });
});

const patchSchema = z.object({
  memoryId: z.string().cuid(),
  confidence: z.number().min(0).max(1),
});

/** PATCH — staff correction of a memory's confidence. */
export const PATCH = withTeacherAuth(async (
  session,
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id: studentId } = await params;
  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const student = await assertStaffCanManageStudent(session, studentId);
  if (!student) {
    return NextResponse.json({ error: "Student not found." }, { status: 404 });
  }

  const { count } = await prisma.sageMemory.updateMany({
    where: {
      id: parsed.data.memoryId,
      subjectType: "student",
      subjectId: studentId,
      validTo: null,
    },
    data: { confidence: parsed.data.confidence },
  });
  if (count === 0) {
    return NextResponse.json({ error: "Memory not found." }, { status: 404 });
  }

  invalidate(`chat:profile:${studentId}`);

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "sage_memory.confidence_updated",
    targetType: "sage_memory",
    targetId: parsed.data.memoryId,
    summary: `Adjusted Sage memory confidence to ${parsed.data.confidence} for student ${studentId}`,
    metadata: { studentId, confidence: parsed.data.confidence },
  });

  return NextResponse.json({ success: true, data: { memoryId: parsed.data.memoryId } });
});

const deleteSchema = z.object({ memoryId: z.string().cuid() });

/**
 * DELETE — staff removal. Archives (validTo = now) rather than hard-deleting
 * so the correction itself stays auditable; the memory immediately stops
 * being retrieved or shown.
 */
export const DELETE = withTeacherAuth(async (
  session,
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id: studentId } = await params;
  const parsed = deleteSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const student = await assertStaffCanManageStudent(session, studentId);
  if (!student) {
    return NextResponse.json({ error: "Student not found." }, { status: 404 });
  }

  const { count } = await prisma.sageMemory.updateMany({
    where: {
      id: parsed.data.memoryId,
      subjectType: "student",
      subjectId: studentId,
      validTo: null,
    },
    data: { validTo: new Date() },
  });
  if (count === 0) {
    return NextResponse.json({ error: "Memory not found." }, { status: 404 });
  }

  invalidate(`chat:profile:${studentId}`);

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "sage_memory.removed",
    targetType: "sage_memory",
    targetId: parsed.data.memoryId,
    summary: `Removed a Sage memory for student ${studentId}`,
    metadata: { studentId },
  });

  return NextResponse.json({ success: true, data: { memoryId: parsed.data.memoryId } });
});
