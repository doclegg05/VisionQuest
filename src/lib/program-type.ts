/**
 * Pure type/label helpers for program classification.
 *
 * This module is imported by client components. Do not add anything here
 * that imports Prisma, `next/headers`, or other server-only modules —
 * Turbopack will refuse to chunk those for the browser. The DB-backed
 * helper lives in `./program-type-server.ts`.
 *
 * Which program a class/student belongs to.
 * Derived from the student's active enrollment, never denormalized on Student.
 */
export type ProgramType = "spokes" | "adult_ed" | "ietp";

export const PROGRAM_TYPES: readonly ProgramType[] = [
  "spokes",
  "adult_ed",
  "ietp",
] as const;

/** Short labels for program badges and compact UI surfaces. */
export const PROGRAM_LABELS: Record<ProgramType, string> = {
  spokes: "SPOKES",
  adult_ed: "AE",
  ietp: "IETP",
};

/** Full program names for aria-labels, tooltips, and long-form contexts. */
export const PROGRAM_FULL_NAMES: Record<ProgramType, string> = {
  spokes: "SPOKES",
  adult_ed: "Adult Education",
  ietp: "IETP",
};

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

