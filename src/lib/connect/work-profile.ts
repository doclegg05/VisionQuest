// =============================================================================
// Student work profile — the Prisma half.
//
// Match & Connect Phase 2, Task 2.1. Everything client-safe (the availability
// vocabulary, the Zod schemas, the row parsers, and the pure scoring helpers)
// lives in ./work-profile-shared and is re-exported below, so server call
// sites keep importing one module. A `"use client"` component must import the
// shared module DIRECTLY — importing this one drags Prisma's runtime into the
// browser bundle and breaks `next build`; see client-import-guard.test.ts.
//
// Student-owned data: the row is keyed by studentId, RLS admits the student
// and their instructors only, and both functions take the studentId
// explicitly rather than reading it from ambient state. Prisma access lives
// here per the repo rule (queries in src/lib/, not in route handlers or
// tools).
// =============================================================================

import { prisma } from "@/lib/db";

import {
  emptyAvailability,
  parseIsoDate,
  toWorkProfile,
  type WorkProfile,
  type WorkProfileInput,
  type WorkProfileRow,
  type WorkProfileSource,
} from "./work-profile-shared";

// One import for server callers: the schemas, constants, types and pure
// helpers come through here unchanged.
export * from "./work-profile-shared";

/** The one student's own row, or null when they have not answered anything. */
export async function getWorkProfile(studentId: string): Promise<WorkProfile | null> {
  const row = await prisma.studentWorkProfile.findUnique({ where: { studentId } });
  return row ? toWorkProfile(row as WorkProfileRow) : null;
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
