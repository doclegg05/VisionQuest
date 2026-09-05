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

import { z } from "zod";

import { prisma } from "@/lib/db";

import {
  CONTACT_CHANNELS,
  EMPLOYER_STATUSES,
  employerNameKey,
  subsidyFlagsSchema,
} from "./employers-shared";

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
  return prisma.employer.create({
    data: {
      name: input.name,
      // Derived, never client-supplied: the unique key must always agree with
      // the name it was computed from.
      nameKey: employerNameKey(input.name),
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
  return prisma.employer.upsert({
    where: { nameKey },
    // Nothing to change: an existing employer's details belong to whoever
    // curated them, not to the posting that happened to name it again.
    update: {},
    create: {
      name: companyName.replace(/\s+/gu, " ").trim(),
      nameKey,
      county: defaults.county ?? "Unknown",
      city: defaults.city ?? "Unknown",
    },
    select: EMPLOYER_SELECT,
  });
}

export async function updateEmployer(input: UpdateEmployerInput) {
  const { id, ...rest } = input;
  const data: Record<string, unknown> = {};

  if (rest.name !== undefined) {
    data.name = rest.name;
    data.nameKey = employerNameKey(rest.name);
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

  return prisma.employer.update({ where: { id }, data, select: EMPLOYER_SELECT });
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
