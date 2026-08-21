import { prisma } from "@/lib/db";

/**
 * The student's own window into Sage's memory of them.
 *
 * Mirrors the field selection in
 * src/app/api/teacher/students/[id]/memories/route.ts (the staff governance
 * surface for the same table) but deliberately narrower: no `confidence`
 * (an internal scoring concept staff use to correct memories, not something
 * a student needs), no `sourceId` (would point at a conversation/operation
 * row a student should not be able to follow), no `kind` (internal
 * episodic/semantic/procedural taxonomy — not meaningful to the reader).
 *
 * Ownership scoping: `subjectId` is always the CALLER's own session id —
 * there is no parameter that lets a caller ask for another subject's rows.
 * Postgres RLS (migration 20260701141000_scope_sage_memory_teacher_rls)
 * enforces the same boundary independently: a `student`-role connection can
 * only SELECT SageMemory rows where subjectType='student' AND
 * subjectId = current_setting('app.current_student_id').
 */
export interface OwnMemoryRow {
  id: string;
  content: string;
  category: string;
  sourceType: string;
  createdAt: Date;
}

export interface OwnMemoryPage {
  memories: OwnMemoryRow[];
  total: number;
}

export interface OwnMemoryPageParams {
  page: number;
  limit: number;
}

export async function listOwnSageMemories(
  studentId: string,
  { page, limit }: OwnMemoryPageParams,
): Promise<OwnMemoryPage> {
  const where = {
    subjectType: "student",
    subjectId: studentId,
    // Non-archived only — matches the teacher route's filter. A row's
    // validTo gets set both when staff remove a memory (suppressedByStaff)
    // and when weekly consolidation supersedes it with a merged memory;
    // either way, it is no longer the current fact and should not show.
    validTo: null,
  };

  const [memories, total] = await Promise.all([
    prisma.sageMemory.findMany({
      where,
      select: {
        id: true,
        content: true,
        category: true,
        sourceType: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.sageMemory.count({ where }),
  ]);

  return { memories, total };
}
