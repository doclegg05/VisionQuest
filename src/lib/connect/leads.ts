// =============================================================================
// Job leads — database access.
//
// Match & Connect Phase 3, Task 3.2. Vocabularies, Zod schemas for the two
// JSON columns, and the pay normalization live in ./leads-shared.ts; this
// module is where Prisma is allowed.
//
// Reads here run in the caller's RLS context, so `job_lead_read` decides what
// comes back. Writes are staff-only at the policy level as well as at the
// route level.
// =============================================================================

import { z } from "zod";

import { prisma } from "@/lib/db";

import { findOrCreateEmployerByName } from "./employers";
import { LOCATION_NOT_LISTED } from "./employers-shared";
import {
  JOB_LEAD_SOURCES,
  JOB_LEAD_STATUSES,
  LEAD_PAY_PERIODS,
  leadRequirementsSchema,
  leadScheduleSchema,
} from "./leads-shared";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const optionalText = (max: number) => z.string().trim().min(1).max(max).nullable().optional();

/**
 * `source` is a closed set and `sourceRef` is never client-chosen for the
 * listing path — `POST /leads/from-listing` sets both itself. A manual lead
 * may still declare `joborder`, which is how a MACC job order is entered.
 */
export const createLeadSchema = z
  .object({
    employerId: z.string().cuid("Invalid employer ID."),
    contactId: z.string().cuid("Invalid contact ID.").nullable().optional(),
    classId: z.string().cuid("Invalid class ID.").nullable().optional(),
    title: z.string().trim().min(1, "Job title is required.").max(160),
    description: optionalText(5000),
    requirements: leadRequirementsSchema.optional(),
    schedule: leadScheduleSchema.optional(),
    payMin: z.number().min(0).max(1_000_000).nullable().optional(),
    payMax: z.number().min(0).max(1_000_000).nullable().optional(),
    payPeriod: z.enum(LEAD_PAY_PERIODS).optional(),
    location: z.string().trim().min(1, "Location is required.").max(160),
    transitNotes: optionalText(500),
    distanceMiles: z.number().min(0).max(500).nullable().optional(),
    clusters: z.array(z.string().trim().min(1).max(60)).max(14).optional(),
    source: z.enum(JOB_LEAD_SOURCES).optional(),
    openings: z.number().int().min(1).max(500).optional(),
    closesAt: z.string().datetime().nullable().optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.payMin === null ||
      value.payMin === undefined ||
      value.payMax === null ||
      value.payMax === undefined ||
      value.payMin <= value.payMax,
    { message: "payMin must not be greater than payMax" },
  );

export const updateLeadSchema = z
  .object({
    id: z.string().cuid("Invalid lead ID."),
    contactId: z.string().cuid("Invalid contact ID.").nullable().optional(),
    classId: z.string().cuid("Invalid class ID.").nullable().optional(),
    title: z.string().trim().min(1).max(160).optional(),
    description: optionalText(5000),
    requirements: leadRequirementsSchema.optional(),
    schedule: leadScheduleSchema.optional(),
    payMin: z.number().min(0).max(1_000_000).nullable().optional(),
    payMax: z.number().min(0).max(1_000_000).nullable().optional(),
    payPeriod: z.enum(LEAD_PAY_PERIODS).optional(),
    location: z.string().trim().min(1).max(160).optional(),
    transitNotes: optionalText(500),
    distanceMiles: z.number().min(0).max(500).nullable().optional(),
    clusters: z.array(z.string().trim().min(1).max(60)).max(14).optional(),
    status: z.enum(JOB_LEAD_STATUSES).optional(),
    openings: z.number().int().min(1).max(500).optional(),
    closesAt: z.string().datetime().nullable().optional(),
  })
  .strict();

export const leadFromListingSchema = z
  .object({
    jobListingId: z.string().cuid("Invalid job listing ID."),
    classId: z.string().cuid("Invalid class ID.").nullable().optional(),
  })
  .strict();

export type CreateLeadInput = z.infer<typeof createLeadSchema>;
export type UpdateLeadInput = z.infer<typeof updateLeadSchema>;
export type LeadFromListingInput = z.infer<typeof leadFromListingSchema>;

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export const LEAD_LIST_SELECT = {
  id: true,
  title: true,
  description: true,
  employerId: true,
  contactId: true,
  classId: true,
  requirements: true,
  schedule: true,
  payMin: true,
  payMax: true,
  payPeriod: true,
  location: true,
  transitNotes: true,
  distanceMiles: true,
  clusters: true,
  source: true,
  sourceRef: true,
  status: true,
  openings: true,
  postedAt: true,
  closesAt: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
  employer: {
    select: {
      id: true,
      name: true,
      county: true,
      city: true,
      status: true,
      hiredSpokesGradBefore: true,
      lastHiredAt: true,
      subsidyFlags: true,
    },
  },
  class: { select: { id: true, name: true } },
} as const;

export const MAX_LEAD_PAGE = 200;

export async function listLeads(
  options: { status?: string; employerId?: string; limit?: number } = {},
) {
  return prisma.jobLead.findMany({
    where: {
      ...(options.status ? { status: options.status } : {}),
      ...(options.employerId ? { employerId: options.employerId } : {}),
    },
    orderBy: [{ status: "asc" }, { postedAt: "desc" }],
    take: Math.min(options.limit ?? MAX_LEAD_PAGE, MAX_LEAD_PAGE),
    select: LEAD_LIST_SELECT,
  });
}

export async function getLead(id: string) {
  return prisma.jobLead.findUnique({ where: { id }, select: LEAD_LIST_SELECT });
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function createLead(input: CreateLeadInput, createdById: string) {
  return prisma.jobLead.create({
    data: {
      employerId: input.employerId,
      contactId: input.contactId ?? null,
      classId: input.classId ?? null,
      title: input.title,
      description: input.description ?? null,
      requirements: input.requirements ?? leadRequirementsSchema.parse({}),
      schedule: input.schedule ?? leadScheduleSchema.parse({}),
      payMin: input.payMin ?? null,
      payMax: input.payMax ?? null,
      payPeriod: input.payPeriod ?? "hour",
      location: input.location,
      transitNotes: input.transitNotes ?? null,
      distanceMiles: input.distanceMiles ?? null,
      clusters: input.clusters ?? [],
      // A hand-entered lead is "manual"; a MACC job order is the same POST
      // with source "joborder". Neither may claim "joblisting" or
      // "opportunity", which carry a sourceRef this route never sets.
      source: input.source === "joborder" ? "joborder" : "manual",
      openings: input.openings ?? 1,
      closesAt: input.closesAt ? new Date(input.closesAt) : null,
      createdById,
    },
    select: LEAD_LIST_SELECT,
  });
}

export async function updateLead(input: UpdateLeadInput) {
  const { id, ...rest } = input;
  const data: Record<string, unknown> = {};

  if (rest.contactId !== undefined) data.contactId = rest.contactId;
  if (rest.classId !== undefined) data.classId = rest.classId;
  if (rest.title !== undefined) data.title = rest.title;
  if (rest.description !== undefined) data.description = rest.description;
  if (rest.requirements !== undefined) data.requirements = rest.requirements;
  if (rest.schedule !== undefined) data.schedule = rest.schedule;
  if (rest.payMin !== undefined) data.payMin = rest.payMin;
  if (rest.payMax !== undefined) data.payMax = rest.payMax;
  if (rest.payPeriod !== undefined) data.payPeriod = rest.payPeriod;
  if (rest.location !== undefined) data.location = rest.location;
  if (rest.transitNotes !== undefined) data.transitNotes = rest.transitNotes;
  if (rest.distanceMiles !== undefined) data.distanceMiles = rest.distanceMiles;
  if (rest.clusters !== undefined) data.clusters = rest.clusters;
  if (rest.status !== undefined) data.status = rest.status;
  if (rest.openings !== undefined) data.openings = rest.openings;
  if (rest.closesAt !== undefined) {
    data.closesAt = rest.closesAt === null ? null : new Date(rest.closesAt);
  }

  return prisma.jobLead.update({ where: { id }, data, select: LEAD_LIST_SELECT });
}

export class JobListingNotFoundError extends Error {
  constructor() {
    super("That job posting wasn't found.");
    this.name = "JobListingNotFoundError";
  }
}

/**
 * Turn one scraped `JobListing` into a lead — the board's "Make this a lead"
 * action.
 *
 * The listing's company string becomes (or finds) an Employer, and the
 * listing's id is recorded as `sourceRef`, so the same posting converted twice
 * returns the first lead instead of creating a second. The posting's URL is
 * appended to the description rather than dropped: it is the only way back to
 * the original terms, and JobLead has no url column of its own.
 */
export async function createLeadFromListing(
  input: LeadFromListingInput,
  createdById: string,
) {
  const listing = await prisma.jobListing.findUnique({
    where: { id: input.jobListingId },
    select: {
      id: true,
      title: true,
      company: true,
      location: true,
      description: true,
      url: true,
      clusters: true,
      salaryMin: true,
    },
  });
  if (!listing) throw new JobListingNotFoundError();

  const existing = await prisma.jobLead.findFirst({
    where: { source: "joblisting", sourceRef: listing.id },
    select: LEAD_LIST_SELECT,
  });
  if (existing) return { lead: existing, created: false as const };

  const employer = await findOrCreateEmployerByName(listing.company);

  const lead = await prisma.jobLead.create({
    data: {
      employerId: employer.id,
      classId: input.classId ?? null,
      title: listing.title,
      description: [listing.description, `Original posting: ${listing.url}`]
        .filter(Boolean)
        .join("\n\n")
        .slice(0, 5000),
      location: listing.location || LOCATION_NOT_LISTED,
      clusters: listing.clusters,
      // salaryMin is already normalized to an hourly rate by the salary
      // parser, so the lead's period is "hour" and no conversion happens here.
      payMin: listing.salaryMin,
      payPeriod: "hour",
      source: "joblisting",
      sourceRef: listing.id,
      createdById,
    },
    select: LEAD_LIST_SELECT,
  });

  return { lead, created: true as const };
}
