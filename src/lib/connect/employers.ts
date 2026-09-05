// =============================================================================
// Employers — database access.
//
// Match & Connect Phase 3, Tasks 3.1–3.2. Everything pure lives in
// ./employers-shared.ts; this module is where Prisma is allowed (repo rule:
// queries in src/lib/, never in a route handler).
//
// Every function here runs inside the caller's RLS context, and the Employer /
// EmployerContact policies admit staff only — so a student session reaching
// any of these gets an empty result rather than a leak. The routes still check
// the session role first; the policy is the floor, not the gate.
// =============================================================================

import { Prisma } from "@prisma/client";
import { z } from "zod";

import { badRequest, conflict, notFound } from "@/lib/api-error";
import { prisma } from "@/lib/db";

import {
  CONTACT_CHANNELS,
  EMPLOYER_STATUSES,
  employerNameKey,
  subsidyFlagsSchema,
} from "./employers-shared";

/** Prisma's unique-constraint code. */
const UNIQUE_VIOLATION = "P2002";

export function isEmployerNameConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_VIOLATION
  );
}

/**
 * The relationship owner is a staff member, not any Student row.
 *
 * `Employer.relationshipOwnerId` is a foreign key to Student, which is also
 * where students live — so without this check a request could name a STUDENT
 * as the owner of an employer relationship, and the console would print their
 * name in the directory next to a business's contact details.
 */
async function assertOwnerIsStaff(ownerId: string | null | undefined): Promise<void> {
  if (!ownerId) return;
  const owner = await prisma.student.findUnique({
    where: { id: ownerId },
    select: { role: true },
  });
  if (!owner) throw notFound("That staff member wasn't found.");
  if (owner.role !== "teacher" && owner.role !== "admin") {
    throw badRequest("The relationship owner must be a staff account.");
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const name = z.string().trim().min(1, "Employer name is required.").max(160);
const optionalText = (max: number) => z.string().trim().min(1).max(max).nullable().optional();

export const createEmployerSchema = z
  .object({
    name,
    legalName: optionalText(160),
    sector: optionalText(80),
    clusters: z.array(z.string().trim().min(1).max(60)).max(14).optional(),
    county: z.string().trim().min(1, "County is required.").max(80),
    city: z.string().trim().min(1, "City is required.").max(80),
    zip: z
      .string()
      .regex(/^\d{5}$/u, "ZIP code must be 5 digits")
      .nullable()
      .optional(),
    website: z.string().trim().url("Website must be a valid URL.").max(300).nullable().optional(),
    notes: optionalText(2000),
    relationshipOwnerId: z.string().cuid("Invalid owner ID.").nullable().optional(),
    subsidyFlags: subsidyFlagsSchema.optional(),
    status: z.enum(EMPLOYER_STATUSES).optional(),
  })
  .strict();

export const updateEmployerSchema = createEmployerSchema
  .partial()
  .extend({ id: z.string().cuid("Invalid employer ID.") })
  .strict();

export const createContactSchema = z
  .object({
    name: z.string().trim().min(1, "Contact name is required.").max(120),
    role: optionalText(120),
    email: z.string().trim().email("Contact email must be valid.").max(200).nullable().optional(),
    phone: optionalText(40),
    preferredChannel: z.enum(CONTACT_CHANNELS).optional(),
    contactConsentAt: z.string().datetime().nullable().optional(),
    doNotContactAt: z.string().datetime().nullable().optional(),
  })
  .strict();

export type CreateEmployerInput = z.infer<typeof createEmployerSchema>;
export type UpdateEmployerInput = z.infer<typeof updateEmployerSchema>;
export type CreateContactInput = z.infer<typeof createContactSchema>;

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const EMPLOYER_SELECT = {
  id: true,
  name: true,
  legalName: true,
  sector: true,
  clusters: true,
  county: true,
  city: true,
  zip: true,
  website: true,
  notes: true,
  relationshipOwnerId: true,
  relationshipOwner: { select: { id: true, displayName: true } },
  hiredSpokesGradBefore: true,
  lastHiredAt: true,
  subsidyFlags: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

export const MAX_EMPLOYER_PAGE = 200;

export async function listEmployers(options: { status?: string; limit?: number } = {}) {
  return prisma.employer.findMany({
    where: options.status ? { status: options.status } : {},
    // Employers that have hired before come first: the job developer's first
    // question is "who has taken our people before".
    orderBy: [{ hiredSpokesGradBefore: "desc" }, { lastHiredAt: "desc" }, { name: "asc" }],
    take: Math.min(options.limit ?? MAX_EMPLOYER_PAGE, MAX_EMPLOYER_PAGE),
    select: { ...EMPLOYER_SELECT, _count: { select: { jobLeads: true, contacts: true } } },
  });
}

/**
 * `{id, name}` only — for a plain picker (the Connect report's employer
 * filter dropdown) that never renders any of `listEmployers`'s other columns
 * (relationship owner, subsidy flags, lead/contact counts). Same ordering as
 * `listEmployers` so the two lists present employers in the same order.
 */
export async function listEmployerOptions(
  options: { status?: string; limit?: number } = {},
): Promise<Array<{ id: string; name: string }>> {
  return prisma.employer.findMany({
    where: options.status ? { status: options.status } : {},
    orderBy: [{ hiredSpokesGradBefore: "desc" }, { lastHiredAt: "desc" }, { name: "asc" }],
    take: Math.min(options.limit ?? MAX_EMPLOYER_PAGE, MAX_EMPLOYER_PAGE),
    select: { id: true, name: true },
  });
}

export async function getEmployer(id: string) {
  return prisma.employer.findUnique({
    where: { id },
    select: {
      ...EMPLOYER_SELECT,
      contacts: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          name: true,
          role: true,
          email: true,
          phone: true,
          preferredChannel: true,
          contactConsentAt: true,
          doNotContactAt: true,
        },
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function createEmployer(input: CreateEmployerInput) {
  await assertOwnerIsStaff(input.relationshipOwnerId);

  const nameKey = employerNameKey(input.name);
  if (!nameKey) throw badRequest("Employer name is required.");

  try {
    return await createEmployerRow(input, nameKey);
  } catch (error: unknown) {
    if (isEmployerNameConflict(error)) {
      throw conflict("There is already an employer with that name.");
    }
    throw error;
  }
}

function createEmployerRow(input: CreateEmployerInput, nameKey: string) {
  return prisma.employer.create({
    data: {
      name: input.name,
      // Derived, never client-supplied: the unique key must always agree with
      // the name it was computed from.
      nameKey,
      legalName: input.legalName ?? null,
      sector: input.sector ?? null,
      clusters: input.clusters ?? [],
      county: input.county,
      city: input.city,
      zip: input.zip ?? null,
      website: input.website ?? null,
      notes: input.notes ?? null,
      relationshipOwnerId: input.relationshipOwnerId ?? null,
      subsidyFlags: input.subsidyFlags ?? {},
      status: input.status ?? "active",
    },
    select: EMPLOYER_SELECT,
  });
}

/**
 * The employer for a company name, creating it when it is new.
 *
 * Race-safe rather than check-then-act: two instructors clicking "Make this a
 * lead" on the same posting in the same second both reach the upsert, and
 * `nameKey`'s unique index makes the second one an update of the first's row.
 */
export async function findOrCreateEmployerByName(
  companyName: string,
  defaults: { county?: string; city?: string } = {},
) {
  const nameKey = employerNameKey(companyName);
  // A blank key would collide every nameless employer onto one row — an
  // adapter that returned "" for company would quietly merge unrelated jobs
  // under a single blank employer. Loud failure is the only safe answer.
  if (!nameKey) {
    throw badRequest("That job posting has no company name, so it cannot become a lead.");
  }

  try {
    return await prisma.employer.upsert({
      where: { nameKey },
      // Nothing to change: an existing employer's details belong to whoever
      // curated them, not to the posting that happened to name it again.
      update: {},
      create: {
        name: companyName.normalize("NFKC").replace(/\s+/gu, " ").trim(),
        nameKey,
        county: defaults.county ?? "Unknown",
        city: defaults.city ?? "Unknown",
      },
      select: EMPLOYER_SELECT,
    });
  } catch (error: unknown) {
    // Prisma's upsert is not atomic: two concurrent first-writes both miss the
    // row and both INSERT, and the loser gets P2002. The winner's row is the
    // answer either of them wanted.
    if (!isEmployerNameConflict(error)) throw error;
    const raced = await prisma.employer.findUnique({
      where: { nameKey },
      select: EMPLOYER_SELECT,
    });
    if (!raced) throw error;
    return raced;
  }
}

/** Why an employer's open leads were paused, in the instructor's own words. */
export const DO_NOT_CONTACT_PAUSE_REASON =
  "Paused because this employer is marked do not contact.";

export async function updateEmployer(input: UpdateEmployerInput) {
  const { id, ...rest } = input;

  await assertOwnerIsStaff(rest.relationshipOwnerId);

  const data: Prisma.EmployerUncheckedUpdateInput = {};

  if (rest.name !== undefined) {
    const nameKey = employerNameKey(rest.name);
    if (!nameKey) throw badRequest("Employer name is required.");
    data.name = rest.name;
    data.nameKey = nameKey;
  }
  if (rest.legalName !== undefined) data.legalName = rest.legalName;
  if (rest.sector !== undefined) data.sector = rest.sector;
  if (rest.clusters !== undefined) data.clusters = rest.clusters;
  if (rest.county !== undefined) data.county = rest.county;
  if (rest.city !== undefined) data.city = rest.city;
  if (rest.zip !== undefined) data.zip = rest.zip;
  if (rest.website !== undefined) data.website = rest.website;
  if (rest.notes !== undefined) data.notes = rest.notes;
  if (rest.relationshipOwnerId !== undefined) data.relationshipOwnerId = rest.relationshipOwnerId;
  if (rest.subsidyFlags !== undefined) data.subsidyFlags = rest.subsidyFlags;
  if (rest.status !== undefined) data.status = rest.status;

  try {
    // One transaction, because two of these three writes are corrections that
    // must not be able to land without the change that caused them.
    const [employer] = await prisma.$transaction([
      prisma.employer.update({ where: { id }, data, select: EMPLOYER_SELECT }),

      // A rename has to reach the leads. JobLead.employerName is denormalised
      // so the student path never touches this table; a stale copy would show
      // a student the employer's old name and nothing would ever correct it.
      ...(rest.name !== undefined
        ? [
            prisma.jobLead.updateMany({
              where: { employerId: id },
              data: { employerName: rest.name },
            }),
          ]
        : []),

      // do_not_contact has to reach the leads too, and for a stronger reason:
      // it is the promise the program made to a business. The student query
      // filters on the LEAD's status (it cannot read Employer at all), so
      // without this the employer would be marked do-not-contact while their
      // openings kept being offered to students.
      ...(rest.status === "do_not_contact"
        ? [
            prisma.jobLead.updateMany({
              where: { employerId: id, status: "open" },
              data: { status: "paused", pausedReason: DO_NOT_CONTACT_PAUSE_REASON },
            }),
          ]
        : []),
    ]);

    return employer;
  } catch (error: unknown) {
    if (isEmployerNameConflict(error)) {
      throw conflict("An employer with that name already exists.");
    }
    throw error;
  }
}

export async function createEmployerContact(employerId: string, input: CreateContactInput) {
  return prisma.employerContact.create({
    data: {
      employerId,
      name: input.name,
      role: input.role ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      preferredChannel: input.preferredChannel ?? "email",
      contactConsentAt: input.contactConsentAt ? new Date(input.contactConsentAt) : null,
      doNotContactAt: input.doNotContactAt ? new Date(input.doNotContactAt) : null,
    },
    select: {
      id: true,
      employerId: true,
      name: true,
      role: true,
      email: true,
      phone: true,
      preferredChannel: true,
      contactConsentAt: true,
      doNotContactAt: true,
    },
  });
}
