import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, forbidden, withAuth } from "@/lib/api-error";
import { listOwnSageMemories } from "@/lib/student-memories";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

const querySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
});

/**
 * GET /api/student/memories
 *
 * The data subject's own window into Sage's memory of them: their SageMemory
 * rows, and only theirs. There is no route parameter and no request field
 * that names a different subject — every query is scoped to the caller's own
 * session id, both here and independently at the RLS layer (see
 * src/lib/student-memories.ts). This is a read-only surface; correction goes
 * through the student's teacher via the existing staff governance route
 * (GET/PATCH/DELETE /api/teacher/students/[id]/memories) — not duplicated
 * here.
 *
 * No staff-read audit row: src/lib/audit.ts's `recordStudentView` documents
 * itself as auditing a STAFF member's read of a student's data (actorId is
 * the staff member, targetStudentId is who they looked at). A student
 * reading their own record is not that event — there is no second party
 * whose access needs a compliance trail — so this route intentionally does
 * not call it.
 */
export const GET = withAuth(async (session, req: Request) => {
  if (session.role !== "student") {
    throw forbidden("Only students can view their own Sage memory.");
  }

  const url = new URL(req.url);
  const parsedQuery = querySchema.safeParse({
    page: url.searchParams.get("page") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });
  if (!parsedQuery.success) {
    throw badRequest(parsedQuery.error.issues[0]?.message ?? "Invalid pagination parameters.");
  }
  const { page, limit } = parsedQuery.data;

  const { memories, total } = await listOwnSageMemories(session.id, { page, limit });

  return NextResponse.json({
    success: true,
    data: {
      memories: memories.map((memory) => ({
        id: memory.id,
        content: memory.content,
        category: memory.category,
        sourceType: memory.sourceType,
        createdAt: memory.createdAt.toISOString(),
      })),
      pagination: { page, limit, total },
    },
  });
});
