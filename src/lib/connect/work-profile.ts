// =============================================================================
// Student work profile — the student's own answers about when and where they
// can actually work.
//
// Match & Connect Phase 2, Task 2.1 (docs/superpowers/plans/
// 2026-09-05-match-and-connect.md; model shape in the design spec §4).
//
// Everything here is student-owned data: the row is keyed by studentId, RLS
// admits the student and their instructors only, and every function in this
// module takes the studentId explicitly rather than reading it from ambient
// state. Prisma access lives here (repo rule: queries in src/lib/, not in
// route handlers or tools).
//
// The two scoring helpers are pure so Phase 3's matcher can reuse them, and so
// they can be tested without a database. Both fail SAFE, meaning they never
// invent a block from missing data:
//   - availabilityOverlap returns 1 for a lead that names no shifts (nothing
//     was asked, so nothing is excluded) and 0 only for a real mismatch.
//   - transportFeasible returns "unknown", never "no", when the student has
//     not answered or the posting carries no distance/transit information.
// =============================================================================

import { z } from "zod";

import { prisma } from "@/lib/db";

export const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday"] as const;
export const WEEKEND_DAYS = ["saturday", "sunday"] as const;
export const AVAILABILITY_DAYS = [...WEEKDAYS, ...WEEKEND_DAYS] as const;
export const AVAILABILITY_SLOTS = ["morning", "afternoon", "evening", "overnight"] as const;

export type AvailabilityDay = (typeof AVAILABILITY_DAYS)[number];
export type AvailabilitySlot = (typeof AVAILABILITY_SLOTS)[number];
export type AvailabilityGrid = Record<AvailabilityDay, Record<AvailabilitySlot, boolean>>;

export const TRANSPORT_MODES = ["car", "ride", "bus", "walk", "none"] as const;
export type TransportMode = (typeof TRANSPORT_MODES)[number];

export const WORK_PROFILE_SOURCES = ["student", "sage", "teacher"] as const;
export type WorkProfileSource = (typeof WORK_PROFILE_SOURCES)[number];

/** Shift vocabulary a JobLead's schedule uses (design spec §4). */
export const LEAD_SHIFTS = ["day", "evening", "night", "weekend"] as const;
export type LeadShift = (typeof LEAD_SHIFTS)[number];

/** How far someone will walk to a job before it stops being a real option. */
export const MAX_WALKING_MILES = 2;

export function emptyAvailability(): AvailabilityGrid {
  return Object.fromEntries(
    AVAILABILITY_DAYS.map((day) => [
      day,
      Object.fromEntries(AVAILABILITY_SLOTS.map((slot) => [slot, false])),
    ]),
  ) as AvailabilityGrid;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const daySlotsSchema = z
  .object({
    morning: z.boolean(),
    afternoon: z.boolean(),
    evening: z.boolean(),
    overnight: z.boolean(),
  })
  .strict();

/**
 * The full 7x4 grid, every day required. A partial grid would let a caller
 * silently drop days the student had already answered.
 */
export const availabilitySchema = z
  .object({
    monday: daySlotsSchema,
    tuesday: daySlotsSchema,
    wednesday: daySlotsSchema,
    thursday: daySlotsSchema,
    friday: daySlotsSchema,
    saturday: daySlotsSchema,
    sunday: daySlotsSchema,
  })
  .strict();

/**
 * The student's own words about childcare hours. Free text on purpose: the
 * five-question intake asks "anything about your kids' hours", and forcing
 * that into a grid would lose more than it captured.
 */
export const childcareHoursSchema = z
  .object({ note: z.string().trim().min(1).max(500) })
  .strict();

export const shiftLimitsSchema = z
  .object({
    maxHoursPerWeek: z.number().int().min(1).max(80).optional(),
    note: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Every field optional (a student answers what they can) and every field
 * nullable (an answer can be taken back). `.strict()` is load-bearing: it is
 * what stops a request body from carrying `studentId` or `updatedVia` into a
 * write that must always be scoped by the caller's own session.
 */
export const workProfileInputSchema = z
  .object({
    availability: availabilitySchema.optional(),
    transport: z.enum(TRANSPORT_MODES).nullable().optional(),
    homeZip: z
      .string()
      .regex(/^\d{5}$/, "ZIP code must be 5 digits")
      .nullable()
      .optional(),
    county: z.string().trim().min(1).max(80).nullable().optional(),
    maxCommuteMinutes: z.number().int().min(0).max(600).nullable().optional(),
    payFloorHourly: z.number().min(0).max(500).nullable().optional(),
    childcareHours: childcareHoursSchema.nullable().optional(),
    earliestStart: z
      .string()
      .regex(ISO_DATE, "earliestStart must be YYYY-MM-DD")
      .nullable()
      .optional(),
    shiftLimits: shiftLimitsSchema.nullable().optional(),
  })
  .strict();

export type WorkProfileInput = z.infer<typeof workProfileInputSchema>;

/**
 * The five questions Sage asks in chat, and the only fields
 * `update_work_profile` may write. Derived from the full schema so the two can
 * never disagree about a field's rules.
 */
export const SAGE_WORK_PROFILE_FIELDS = [
  "availability",
  "transport",
  "payFloorHourly",
  "earliestStart",
  "childcareHours",
] as const;

export const sageWorkProfileInputSchema = workProfileInputSchema
  .pick({
    availability: true,
    transport: true,
    payFloorHourly: true,
    earliestStart: true,
    childcareHours: true,
  })
  .strict();

export type SageWorkProfileInput = z.infer<typeof sageWorkProfileInputSchema>;

// ---------------------------------------------------------------------------
// Read / write
// ---------------------------------------------------------------------------

export interface WorkProfile {
  studentId: string;
  availability: AvailabilityGrid;
  transport: TransportMode | null;
  homeZip: string | null;
  county: string | null;
  maxCommuteMinutes: number | null;
  payFloorHourly: number | null;
  childcareHours: z.infer<typeof childcareHoursSchema> | null;
  /** Plain YYYY-MM-DD; the column is a DateTime stored at UTC midnight. */
  earliestStart: string | null;
  shiftLimits: z.infer<typeof shiftLimitsSchema> | null;
  updatedAt: string;
  updatedVia: WorkProfileSource;
}

interface WorkProfileRow {
  studentId: string;
  availability: unknown;
  transport: string | null;
  homeZip: string | null;
  county: string | null;
  maxCommuteMinutes: number | null;
  payFloorHourly: number | null;
  childcareHours: unknown;
  earliestStart: Date | null;
  shiftLimits: unknown;
  updatedAt: Date;
  updatedVia: string;
}

function toIsoDate(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function parseIsoDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

/**
 * Stored JSON is parsed, never trusted. A row written before a shape change
 * (or by a future column edit) degrades to the safe default rather than
 * throwing inside a student's chat turn.
 */
function parseAvailability(raw: unknown): AvailabilityGrid {
  const parsed = availabilitySchema.safeParse(raw);
  return parsed.success ? parsed.data : emptyAvailability();
}

function parseJsonField<T extends z.ZodTypeAny>(schema: T, raw: unknown): z.infer<T> | null {
  if (raw === null || raw === undefined) return null;
  const parsed = schema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function toWorkProfile(row: WorkProfileRow): WorkProfile {
  return {
    studentId: row.studentId,
    availability: parseAvailability(row.availability),
    transport: (TRANSPORT_MODES as ReadonlyArray<string>).includes(row.transport ?? "")
      ? (row.transport as TransportMode)
      : null,
    homeZip: row.homeZip,
    county: row.county,
    maxCommuteMinutes: row.maxCommuteMinutes,
    payFloorHourly: row.payFloorHourly,
    childcareHours: parseJsonField(childcareHoursSchema, row.childcareHours),
    earliestStart: toIsoDate(row.earliestStart),
    shiftLimits: parseJsonField(shiftLimitsSchema, row.shiftLimits),
    updatedAt: row.updatedAt.toISOString(),
    updatedVia: (WORK_PROFILE_SOURCES as ReadonlyArray<string>).includes(row.updatedVia)
      ? (row.updatedVia as WorkProfileSource)
      : "student",
  };
}

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

// ---------------------------------------------------------------------------
// Pure scoring helpers (reused by the Phase 3 matcher)
// ---------------------------------------------------------------------------

type GridCell = readonly [AvailabilityDay, AvailabilitySlot];

/**
 * Which of the 28 grid cells each shift covers.
 *
 * day / evening / night are weekday shifts and `weekend` is every Saturday and
 * Sunday cell, so the four shifts PARTITION the grid: together they cover all
 * 28 cells exactly once. That is what makes a multi-shift overlap a plain
 * union count rather than an average of overlapping windows.
 */
const SHIFT_CELLS: Record<LeadShift, GridCell[]> = {
  day: WEEKDAYS.flatMap((day) => [
    [day, "morning"] as GridCell,
    [day, "afternoon"] as GridCell,
  ]),
  evening: WEEKDAYS.map((day) => [day, "evening"] as GridCell),
  night: WEEKDAYS.map((day) => [day, "overnight"] as GridCell),
  weekend: WEEKEND_DAYS.flatMap((day) =>
    AVAILABILITY_SLOTS.map((slot) => [day, slot] as GridCell),
  ),
};

export interface LeadSchedule {
  shifts: LeadShift[];
}

/**
 * What share of the shift a student can actually cover, 0..1.
 *
 * A lead that names no shifts returns 1: nothing was asked, so nothing is
 * excluded. That is deliberate — it keeps `overlap === 0` usable as a hard
 * block without blocking every lead whose schedule has not been recorded yet.
 * A student with no profile returns 0: they have declared no availability, and
 * the caller decides whether "nothing declared" should hide a job (it should
 * not — see search_jobs, which only blocks on pay and transport).
 */
export function availabilityOverlap(
  profile: Pick<WorkProfile, "availability"> | null | undefined,
  schedule: LeadSchedule,
): number {
  const shifts = [...new Set(schedule.shifts)];
  const cells = shifts.flatMap((shift) => SHIFT_CELLS[shift] ?? []);
  if (cells.length === 0) return 1;
  if (!profile) return 0;

  const available = cells.filter(([day, slot]) => profile.availability[day]?.[slot]).length;
  return available / cells.length;
}

export interface TransportLead {
  transitNotes?: string | null;
  distanceMiles?: number | null;
}

export type TransportFeasibility = "yes" | "no" | "unknown";

function hasTransitNote(lead: TransportLead): boolean {
  return Boolean(lead.transitNotes && lead.transitNotes.trim().length > 0);
}

/**
 * Can this student get to this job?
 *
 * "unknown" is a real answer, not a stand-in for "no": it means the data to
 * decide is missing, and a coach should ask rather than the system quietly
 * removing the job. Only `walk` past the walking distance and `none` with no
 * transit route are hard "no"s.
 */
export function transportFeasible(
  profile: Pick<WorkProfile, "transport"> | null | undefined,
  lead: TransportLead,
): TransportFeasibility {
  const transport = profile?.transport ?? null;
  if (!transport) return "unknown";

  switch (transport) {
    case "car":
    case "ride":
      return "yes";
    case "bus":
      return hasTransitNote(lead) ? "yes" : "unknown";
    case "walk": {
      const miles = lead.distanceMiles;
      if (miles === null || miles === undefined) return "unknown";
      return miles <= MAX_WALKING_MILES ? "yes" : "no";
    }
    case "none":
      return hasTransitNote(lead) ? "yes" : "no";
  }
}
