// =============================================================================
// Student work profile — database access.
//
// Match & Connect Phase 2, Task 2.1 (docs/superpowers/plans/
// 2026-09-05-match-and-connect.md; model shape in the design spec §4).
//
// Everything that does NOT touch Prisma — types, Zod schemas, row mapping, and
// the pure scoring helpers `availabilityOverlap` / `transportFeasible` — lives
// in ./work-profile-shared.ts and is re-exported here, so existing imports of
// this module keep working unchanged. Client components must import the shared
// module directly: pulling this one into a "use client" graph puts the Prisma
// client (and node:async_hooks) into the browser bundle and fails `next build`.
//
// Everything here is student-owned data: rows are keyed by studentId, RLS
// admits the student and their instructors only, and every function takes the
// studentId explicitly rather than reading it from ambient state.
// =============================================================================

import { prisma } from "@/lib/db";

import {
  emptyAvailability,
  toWorkProfile,
  parseIsoDate,
  type WorkProfile,
  type WorkProfileInput,
  type WorkProfileRow,
  type WorkProfileSource,
} from "./work-profile-shared";

export * from "./work-profile-shared";

/** The one student's own row, or null when they have not answered anything. */
export async function getWorkProfile(studentId: string): Promise<WorkProfile | null> {
  const row = await prisma.studentWorkProfile.findUnique({ where: { studentId } });
  return row ? toWorkProfile(row as WorkProfileRow) : null;
}

/**
 * Batch read for the reverse match (Phase 3's `rankStudentsForLead`): one
 * query for a whole roster instead of one per student. Students with no row
 * are simply absent from the map — the matcher reads "absent" as "has not
 * answered", which is never a hard block.
 */
export async function getWorkProfiles(
  studentIds: string[],
): Promise<Map<string, WorkProfile>> {
  const unique = [...new Set(studentIds)].filter(Boolean);
  if (unique.length === 0) return new Map();

  const rows = await prisma.studentWorkProfile.findMany({
    where: { studentId: { in: unique } },
  });

  return new Map(
    rows.map((row) => {
      const profile = toWorkProfile(row as WorkProfileRow);
      return [profile.studentId, profile] as const;
    }),
  );
}

/**
 * Write the fields the caller supplied and nothing else. A key that is absent
 * from `input` is left exactly as it was; a key set to `null` is cleared.
 *
 * `via` records who did it (student form, Sage chat, instructor) and is never
 * read from the payload — see the `.strict()` note on the schema.
 */
export async function upsertWorkProfile(
  studentId: string,
  input: WorkProfileInput,
  via: WorkProfileSource,
): Promise<WorkProfile> {
  const data: Record<string, unknown> = { updatedVia: via };

  if (input.availability !== undefined) data.availability = input.availability;
  if (input.transport !== undefined) data.transport = input.transport;
  if (input.homeZip !== undefined) data.homeZip = input.homeZip;
  if (input.county !== undefined) data.county = input.county;
  if (input.maxCommuteMinutes !== undefined) data.maxCommuteMinutes = input.maxCommuteMinutes;
  if (input.payFloorHourly !== undefined) data.payFloorHourly = input.payFloorHourly;
  if (input.childcareHours !== undefined) data.childcareHours = input.childcareHours;
  if (input.earliestStart !== undefined) {
    data.earliestStart = input.earliestStart === null ? null : parseIsoDate(input.earliestStart);
  }
  if (input.shiftLimits !== undefined) data.shiftLimits = input.shiftLimits;

  const row = await prisma.studentWorkProfile.upsert({
    where: { studentId },
    // A first answer about pay alone must not silently assert "no transport"
    // (which transportFeasible would read as a hard block), so create defaults
    // are the all-false grid and a null transport, both meaning "not answered".
    create: { studentId, availability: emptyAvailability(), ...data },
    update: data,
  });

  return toWorkProfile(row as WorkProfileRow);
}
