// =============================================================================
// Job leads — database access.
//
// Match & Connect Phase 3, Task 3.2. Vocabularies, Zod schemas for the two
// JSON columns, and the pay normalization live in ./leads-shared.ts; this
// module is where Prisma is allowed.
//
// Three ownership checks run before every write, because `job_lead_write`'s
// class clause is the floor and a clear 404 beats a policy rejection:
//   assertClassIsManaged   — you may only publish into a class you INSTRUCT
//                            (./classes.ts, the app mirror of the RLS policy)
//   assertContactBelongsTo — a lead's contact must work at its own employer
//   the RLS policy itself  — the same rule, enforced under the caller's role
//
// Every lead also carries `employerName`, copied at write time. That is what
// lets the student path read leads without touching the Employer table, whose
// policy has no student branch. `updateEmployer` re-syncs it on rename.
// =============================================================================

import { Prisma } from "@prisma/client";
import { z } from "zod";

import { notFound } from "@/lib/api-error";
import { prisma } from "@/lib/db";

import { type ClassActor, assertClassIsManaged } from "./classes";
import { findOrCreateEmployerByName } from "./employers";
import { LOCATION_NOT_LISTED } from "./employers-shared";
import {
  JOB_LEAD_SOURCES,
  JOB_LEAD_STATUSES,
  LEAD_PAY_PERIODS,
  leadRequirementsSchema,
  leadScheduleSchema,
} from "./leads-shared";

/** Prisma's unique-constraint code. */
const UNIQUE_VIOLATION = "P2002";

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_VIOLATION
  );
}

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
// Ownership checks
// ---------------------------------------------------------------------------

/**
 * A lead's contact must be a person at the lead's OWN employer. Without this,
 * a request could attach Mountain Metal's hiring manager to a Valley Foods
 * lead, and Phase 4 would email them a packet about a job they never posted.
 */
export async function assertContactBelongsTo(
  employerId: string,
  contactId: string | null | undefined,
): Promise<void> {
  if (!contactId) return;
  const contact = await prisma.employerContact.findFirst({
    where: { id: contactId, employerId },
    select: { id: true },
  });
  if (!contact) throw notFound("That contact isn't at this employer.");
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export const LEAD_LIST_SELECT = {
  id: true,
  title: true,
  description: true,
  employerId: true,
  employerName: true,
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
  pausedReason: true,
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
    orderBy: [{ status: "asc" }, { postedAt: "desc" }, { id: "asc" }],
    take: Math.min(options.limit ?? MAX_LEAD_PAGE, MAX_LEAD_PAGE),
    select: LEAD_LIST_SELECT,
  });
}

/**
 * Open `JobListing` rows on one class's board, for the console's
 * "from a job on a class board" picker. Titles and companies only — enough to
 * choose, and the id stays server-side of the form.
 */
export async function listConvertibleListings(classId: string, limit = 100) {
  const [config, existing] = await Promise.all([
    prisma.jobClassConfig.findUnique({ where: { classId }, select: { id: true } }),
    prisma.jobLead.findMany({
      where: { source: "joblisting" },
      select: { sourceRef: true },
    }),
  ]);
  if (!config) return [];

  const alreadyLeads = new Set(existing.map((row) => row.sourceRef));

  const listings = await prisma.jobListing.findMany({
    where: { classConfigId: config.id, status: "active" },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: limit,
    select: { id: true, title: true, company: true, location: true },
  });

  // A posting that is already a lead is dropped rather than shown and then
  // refused: the picker should only offer choices that do something.
  return listings.filter((listing) => !alreadyLeads.has(listing.id));
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function createLead(input: CreateLeadInput, actor: ClassActor) {
  await assertClassIsManaged(input.classId, actor);
  await assertContactBelongsTo(input.employerId, input.contactId);

  const employer = await prisma.employer.findUnique({
    where: { id: input.employerId },
    select: { id: true, name: true },
  });
  if (!employer) throw notFound("That employer wasn't found.");

  return prisma.jobLead.create({
    data: {
      employerId: employer.id,
      // Copied, not joined — see the module header.
      employerName: employer.name,
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
      createdById: actor.id,
    },
    select: LEAD_LIST_SELECT,
  });
}

export async function updateLead(input: UpdateLeadInput, actor: ClassActor) {
  const { id, ...rest } = input;

  const existing = await prisma.jobLead.findUnique({
    where: { id },
    select: { id: true, employerId: true },
  });
  if (!existing) throw notFound("That lead wasn't found.");

  await assertClassIsManaged(rest.classId, actor);
  await assertContactBelongsTo(existing.employerId, rest.contactId);

  const data: Prisma.JobLeadUncheckedUpdateInput = {};

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
  if (rest.status !== undefined) {
    data.status = rest.status;
    // Reopening clears the machine-written explanation; leaving it would keep
    // telling the instructor the lead is paused for a reason it no longer is.
    if (rest.status === "open") data.pausedReason = null;
  }
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
 * Idempotent at the DATABASE, not by a read-then-write: `@@unique([source,
 * sourceRef])` means two instructors clicking at the same moment produce one
 * lead and one P2002, which is caught and re-read. The check before the insert
 * is only there to skip the employer upsert in the common case.
 *
 * The posting's URL is appended to the description rather than dropped: it is
 * the only way back to the original terms, and JobLead has no url column.
 */
export async function createLeadFromListing(
  input: LeadFromListingInput,
  actor: ClassActor,
) {
  await assertClassIsManaged(input.classId, actor);

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

  const readExisting = () =>
    prisma.jobLead.findFirst({
      where: { source: "joblisting", sourceRef: listing.id },
      select: LEAD_LIST_SELECT,
    });

  const existing = await readExisting();
  if (existing) return { lead: existing, created: false as const };

  const employer = await findOrCreateEmployerByName(listing.company);

  try {
    const lead = await prisma.jobLead.create({
      data: {
        employerId: employer.id,
        employerName: employer.name,
        classId: input.classId ?? null,
        title: listing.title,
        description: [listing.description, `Original posting: ${listing.url}`]
          .filter(Boolean)
          .join("\n\n")
          .slice(0, 5000),
        location: listing.location || LOCATION_NOT_LISTED,
        clusters: listing.clusters,
        // salaryMin is already normalized to an hourly rate by the salary
        // parser, so the lead's period is "hour" and no conversion happens.
        payMin: listing.salaryMin,
        payPeriod: "hour",
        source: "joblisting",
        sourceRef: listing.id,
        createdById: actor.id,
      },
      select: LEAD_LIST_SELECT,
    });
    return { lead, created: true as const };
  } catch (error: unknown) {
    if (!isUniqueViolation(error)) throw error;
    // Somebody else won the race. Their row is the lead.
    const raced = await readExisting();
    if (!raced) throw error;
    return { lead: raced, created: false as const };
  }
}
