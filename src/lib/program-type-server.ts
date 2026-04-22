import { prisma } from "@/lib/db";
import { normalizeProgramType, type ProgramType } from "@/lib/program-type";

/**
 * Returns the student's current program type based on their most-recent
 * active enrollment. Falls back to "spokes" if the student has no active
 * enrollment (brand-new account, pre-orientation).
 *
 * Server-only because it touches Prisma. Kept in a separate module so
 * client components can import pure helpers from `./program-type` without
 * dragging `node:async_hooks` (via the RLS Prisma extension) into client
 * bundles.
 */
export async function getStudentProgramType(
  studentId: string,
): Promise<ProgramType> {
  const enrollment = await prisma.studentClassEnrollment.findFirst({
    where: { studentId, status: "active" },
    orderBy: { enrolledAt: "desc" },
    select: { class: { select: { programType: true } } },
  });
  return normalizeProgramType(enrollment?.class.programType);
}
