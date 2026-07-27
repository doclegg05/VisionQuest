import { prisma } from "@/lib/db";
import { OUTCOME_VERIFICATION } from "@/lib/outcome-verification";
import type { SavedJobStatus } from "@/lib/job-board/types";
import type { Application } from "@prisma/client";

// =============================================================================
// VQ-R-017 — unified application tracking (locked tracker decision).
//
// The Application model is the single pipeline: it carries verificationStatus/
// verifiedBy/verifiedAt and is what the four teacher surfaces (student detail,
// export, reporting, outcomes-verify) read. Every student "save this job" /
// "I applied" interaction goes through trackJobInterest below, which
// find-or-creates an Opportunity deduped by url and upserts the student's
// Application against it. StudentSavedJob is never written anymore — existing
// rows remain solely for rollback (scripts/migrate-saved-jobs-to-applications
// .mjs folds them into Application rows).
//
// Authorization stays with the callers: routes/tools verify class scope and
// session ownership before calling in (the lib only resolves rows by id).
// =============================================================================

/** Job-board statuses that mean the student actually applied. */
export const APPLIED_JOB_STATUSES: ReadonlySet<SavedJobStatus> = new Set([
  "applied",
  "interviewing",
  "offered",
]);

export type JobInterestSource =
  | { kind: "listing"; jobListingId: string }
  | { kind: "browse"; browseListingId: string };

export interface TrackJobInterestInput {
  studentId: string;
  source: JobInterestSource;
  /** Omitted: create as "saved"; an existing row's status is left untouched. */
  status?: SavedJobStatus;
  /** Omitted: an existing row's notes are left untouched. Empty string clears. */
  notes?: string;
}

export type TrackJobInterestResult =
  | {
      ok: true;
      application: Application;
      opportunity: { id: string; title: string; company: string };
    }
  | { ok: false; reason: "listing_not_found" };

/**
 * The job board speaks "offered"; Application rows store the Application-model
 * vocabulary ("offer") that reporting, teacher export, and grant metrics
 * already filter on. Convert on write...
 */
export function toApplicationStatus(status: SavedJobStatus): string {
  return status === "offered" ? "offer" : status;
}

/**
 * ...and back on read for job-board surfaces. Statuses only the opportunity
 * hub produces map to the nearest board state: offer/accepted -> "offered",
 * rejected -> "applied" (they did apply), anything unknown -> "saved".
 */
export function applicationStatusForJobBoard(status: string): SavedJobStatus {
  if (status === "offer" || status === "accepted") return "offered";
  if (status === "rejected") return "applied";
  const boardStatuses: ReadonlyArray<SavedJobStatus> = [
    "saved",
    "applied",
    "interviewing",
    "offered",
    "withdrawn",
  ];
  return (boardStatuses as readonly string[]).includes(status)
    ? (status as SavedJobStatus)
    : "saved";
}

interface SourceListingFields {
  title: string;
  company: string;
  location: string;
  url: string;
  description: string;
}

const SOURCE_LISTING_SELECT = {
  title: true,
  company: true,
  location: true,
  url: true,
  description: true,
} as const;

async function resolveSourceListing(
  source: JobInterestSource,
): Promise<SourceListingFields | null> {
  if (source.kind === "listing") {
    return prisma.jobListing.findUnique({
      where: { id: source.jobListingId },
      select: SOURCE_LISTING_SELECT,
    });
  }
  return prisma.jobBrowseListing.findUnique({
    where: { id: source.browseListingId },
    select: SOURCE_LISTING_SELECT,
  });
}

/**
 * Opportunities are deduped by url: the same upstream posting scraped for two
 * classes (VQ-R-018 makes those two JobListing rows) or sitting in the browse
 * pool resolves to ONE Opportunity; each student's tracking is their own
 * Application row against it. Opportunity.url carries no unique constraint,
 * so two concurrent first-savers can mint duplicates — every later save keeps
 * resolving the oldest row, so a duplicate is inert, never load-bearing.
 */
async function findOrCreateOpportunityForListing(
  studentId: string,
  listing: SourceListingFields,
): Promise<{ id: string; title: string; company: string }> {
  const existing = await prisma.opportunity.findFirst({
    where: { url: listing.url },
    orderBy: { createdAt: "asc" },
    select: { id: true, title: true, company: true },
  });
  if (existing) return existing;

  return prisma.opportunity.create({
    data: {
      type: "job",
      title: listing.title,
      company: listing.company,
      location: listing.location,
      url: listing.url,
      description: listing.description,
      createdById: studentId,
    },
    select: { id: true, title: true, company: true },
  });
}

/**
 * The single student write path for job tracking. Resolves the source row
 * (class JobListing or program-wide JobBrowseListing), find-or-creates the
 * url-deduped Opportunity, and upserts the Application keyed on
 * (studentId, opportunityId).
 *
 * - appliedAt is stamped once: the first time the row enters an
 *   applied-family status (applied/interviewing/offered), never restamped.
 * - Every student-driven status/notes change is recorded self_reported with
 *   any prior instructor sign-off cleared (P1-4, mirroring cert-actions and
 *   POST /api/applications). A bare re-save with neither status nor notes is
 *   a no-op touch and leaves an existing row's verification alone.
 */
export async function trackJobInterest(
  input: TrackJobInterestInput,
): Promise<TrackJobInterestResult> {
  const listing = await resolveSourceListing(input.source);
  if (!listing) return { ok: false, reason: "listing_not_found" };

  const opportunity = await findOrCreateOpportunityForListing(input.studentId, listing);

  const applicationKey = {
    studentId_opportunityId: {
      studentId: input.studentId,
      opportunityId: opportunity.id,
    },
  };

  const existing = await prisma.application.findUnique({
    where: applicationKey,
    select: { appliedAt: true },
  });

  const { status, notes } = input;
  const createStatus = status ?? "saved";
  const stampAppliedAtOnUpdate =
    status !== undefined && APPLIED_JOB_STATUSES.has(status) && !existing?.appliedAt
      ? new Date()
      : undefined;
  const isStudentClaim = status !== undefined || notes !== undefined;

  const application = await prisma.application.upsert({
    where: applicationKey,
    create: {
      studentId: input.studentId,
      opportunityId: opportunity.id,
      status: toApplicationStatus(createStatus),
      notes: notes || null,
      appliedAt:
        status !== undefined && APPLIED_JOB_STATUSES.has(status) ? new Date() : null,
      verificationStatus: OUTCOME_VERIFICATION.SELF_REPORTED,
    },
    update: isStudentClaim
      ? {
          ...(status !== undefined ? { status: toApplicationStatus(status) } : {}),
          ...(notes !== undefined ? { notes: notes || null } : {}),
          appliedAt: stampAppliedAtOnUpdate,
          verificationStatus: OUTCOME_VERIFICATION.SELF_REPORTED,
          verifiedBy: null,
          verifiedAt: null,
        }
      : {},
  });

  return { ok: true, application, opportunity };
}
