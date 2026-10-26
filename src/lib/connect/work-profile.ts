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

import { Prisma } from "@prisma/client";

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

/**
 * Clearing a NULLABLE Json column takes `Prisma.DbNull`, not `null` — a bare
 * `null` on a Json field means the JSON literal `null` and Prisma rejects it
 * where the two are ambiguous. The untyped payload this function replaced
 * accepted `null` happily, so "delete my childcare note" was a broken write
 * that typing caught.
 */
function clearedJson<T extends object>(value: T | null): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value === null ? Prisma.DbNull : (value as unknown as Prisma.InputJsonValue);
}

/** The one student's own row, or null when they have not answered anything. */
export async function getWorkProfile(studentId: string): Promise<WorkProfile | null> {
  const row = await prisma.studentWorkProfile.findUnique({ where: { studentId } });
  return row ? toWorkProfile(row as WorkProfileRow) : null;
}

/**
 * Several students' profiles in one query, keyed by studentId. Phase 3's
 * reverse match (rankStudentsForLead) scores a whole roster against one lead,
 * and doing that a row at a time is the N+1 this exists to prevent.
 *
 * A student with no row is simply absent from the map — the caller decides
 * what "not answered" means, exactly as with getWorkProfile's null.
 */
export async function getWorkProfiles(studentIds: string[]): Promise<Map<string, WorkProfile>> {
  if (studentIds.length === 0) return new Map();
  const rows = await prisma.studentWorkProfile.findMany({
    where: { studentId: { in: [...new Set(studentIds)] } },
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
  // Typed rather than Record<string, unknown>: a field-name typo below is a
  // tsc error instead of a silently-ignored key in the upsert payload. Typing
  // it also surfaced a real bug the untyped object hid — see clearedJson().
  // Create-shaped (plain values, no { set: … } operation wrappers) so the one
  // object can serve BOTH halves of the upsert; the update input accepts
  // plain values, the create input does not accept the wrappers.
  const data: Partial<Prisma.StudentWorkProfileUncheckedCreateInput> = { updatedVia: via };

  if (input.availability !== undefined) data.availability = input.availability;
  if (input.transport !== undefined) data.transport = input.transport;
  if (input.homeZip !== undefined) data.homeZip = input.homeZip;
  if (input.county !== undefined) data.county = input.county;
  if (input.maxCommuteMinutes !== undefined) data.maxCommuteMinutes = input.maxCommuteMinutes;
  if (input.payFloorHourly !== undefined) data.payFloorHourly = input.payFloorHourly;
  if (input.childcareHours !== undefined) data.childcareHours = clearedJson(input.childcareHours);
  if (input.earliestStart !== undefined) {
    data.earliestStart = input.earliestStart === null ? null : parseIsoDate(input.earliestStart);
  }
  if (input.shiftLimits !== undefined) data.shiftLimits = clearedJson(input.shiftLimits);

  const upsert = () =>
    prisma.studentWorkProfile.upsert({
      where: { studentId },
      create: {
        ...data,
        studentId,
        // A first answer about pay alone must not silently assert "no
        // transport" (which transportFeasible would read as a hard block), so
        // the create default is the all-false grid and a null transport, both
        // meaning "not answered".
        availability: input.availability ?? emptyAvailability(),
      },
      update: data,
    });

  let row;
  try {
    row = await upsert();
  } catch (error) {
    // Prisma's upsert is not atomic: two concurrent first-writes for the same
    // student (the Settings form saving while Sage saves the same answer in
    // chat) can both miss the row and both INSERT, and the loser gets P2002 on
    // the primary key. The row exists by then, so one retry resolves to a
    // plain UPDATE. Anything else propagates.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      row = await upsert();
    } else {
      throw error;
    }
  }

  return toWorkProfile(row as WorkProfileRow);
}
