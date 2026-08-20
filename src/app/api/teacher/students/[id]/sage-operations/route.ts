import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, withTeacherAuth } from "@/lib/api-error";
import { recordStudentView } from "@/lib/audit";
import { assertStaffCanManageStudent } from "@/lib/classroom";
import { fetchOperationsForStudent } from "@/lib/sage/operations";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT).optional(),
});

/**
 * GET /api/teacher/students/[id]/sage-operations
 *
 * Read-only viewer for the Sage write-operation ledger (SageOperation):
 * what tool Sage ran for this student, its confirmation/execution status,
 * and when — never the tool's raw arguments or generated summary text. See
 * src/lib/sage/operations.ts for why payload/resultSummary are excluded
 * (both are proven to embed quoted free text for some tools).
 *
 * Newest first, paginated. Staff reads of student data are audited via
 * recordStudentView (sampled 1/teacher/student/surface/day).
 */
export const GET = withTeacherAuth(async (
  session,
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  const managedStudent = await assertStaffCanManageStudent(session, id);
  const studentId = managedStudent.id;

  const url = new URL(req.url);
  const parsed = listQuerySchema.safeParse({
    page: url.searchParams.get("page") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });
  if (!parsed.success) {
    throw badRequest("Invalid query parameters.");
  }
  const { page = 1, limit = DEFAULT_LIMIT } = parsed.data;

  await recordStudentView({
    actorId: session.id,
    actorRole: session.role,
    targetStudentId: studentId,
    surface: "sage_operations",
  });

  const { operations, hasMore } = await fetchOperationsForStudent(studentId, { page, limit });

  return NextResponse.json({ success: true, data: { operations, hasMore, page, limit } });
});
