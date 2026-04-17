import { prisma } from "@/lib/db";

/**
 * Which program a class/student belongs to.
 * Derived from the student's active enrollment, never denormalized on Student.
 */
export type ProgramType = "spokes" | "adult_ed" | "ietp";

export const PROGRAM_TYPES: readonly ProgramType[] = [
  "spokes",
  "adult_ed",
  "ietp",
] as const;

export function isProgramType(value: string): value is ProgramType {
  return (PROGRAM_TYPES as readonly string[]).includes(value);
}

/**
 * Narrows a raw DB/input string into a valid ProgramType. Invalid or absent
 * values fall back to "spokes" to match the schema default and grandfather
 * classes created before Phase 1.
 */
export function normalizeProgramType(
  raw: string | null | undefined,
): ProgramType {
  return raw && isProgramType(raw) ? raw : "spokes";
}

/**
 * Returns the student's current program type based on their most-recent
 * active enrollment. Falls back to "spokes" if the student has no active
 * enrollment (brand-new account, pre-orientation).
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
