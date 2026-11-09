/**
 * Durable saved and hidden jobs (W4): every Prisma query the job routes need.
 * Design: docs/superpowers/specs/2026-11-09-durable-job-preferences-design.md
 *
 * Every query is scoped to the student (`studentId`) and runs on the
 * RLS-scoped app client, except the program-wide browse pool, which has no
 * per-student owner and is read through prismaAdmin.
 */
import type { JobClassConfig, Prisma, StudentSavedJob } from "@prisma/client";
import { prisma, prismaAdmin } from "@/lib/db";
import { getPlainConfigValue } from "@/lib/system-config";
import type { SavedJobStatus } from "./types";
import { vacancyKeyFor, vacancySnapshotFor, type VacancyListing } from "./vacancy-identity";

export type ListingKind = "class" | "browse";

export interface ResolvedListing extends VacancyListing {
  id: string;
  kind: ListingKind;
  vacancyKey: string;
}

export const APPLIED_STATUSES: ReadonlySet<string> = new Set(["applied", "interviewing", "offered"]);

const LISTING_SELECT = {
  id: true,
  title: true,
  company: true,
  location: true,
  url: true,
  source: true,
  sourceId: true,
  expiresAt: true,
} as const;

// ─── Scope ───────────────────────────────────────────────────────────────────

/** Every class the student is actively enrolled in, not only the first. */
export async function listActiveClassIds(studentId: string): Promise<string[]> {
  const rows = await prisma.studentClassEnrollment.findMany({
    where: { studentId, status: "active" },
    select: { classId: true },
  });
  return rows.map((row) => row.classId);
}

/**
 * The class board GET /api/jobs shows: the most recent active enrollment
 * whose class has a job setup. Deterministic, and after a transfer it picks
 * the new class while the old enrollment is still being archived.
 */
export async function resolveBoardConfig(studentId: string): Promise<JobClassConfig | null> {
  const enrollment = await prisma.studentClassEnrollment.findFirst({
    where: { studentId, status: "active", class: { jobConfig: { isNot: null } } },
    orderBy: { enrolledAt: "desc" },
    select: { classId: true },
  });
  if (!enrollment) return null;
  return prisma.jobClassConfig.findUnique({ where: { classId: enrollment.classId } });
}

async function findClassListing(studentId: string, listingId: string) {
  const classIds = await listActiveClassIds(studentId);
  if (classIds.length === 0) return null;
  const row = await prisma.jobListing.findFirst({
    where: { id: listingId, classConfig: { classId: { in: classIds } } },
    select: LISTING_SELECT,
  });
  return row ? { ...row, kind: "class" as const, postedAt: null } : null;
}

async function findBrowseListing(listingId: string) {
  const row = await prismaAdmin.jobBrowseListing.findUnique({
    where: { id: listingId },
    select: { ...LISTING_SELECT, postedAt: true },
  });
  return row ? { ...row, kind: "browse" as const } : null;
}

/**
 * A listing the student may act on: a class row on any of their active
 * classes' boards, else a browse-pool row. Null when neither matches or the
 * row has no usable vacancy key.
 */
export async function resolveListingForStudent(
  studentId: string,
  listingId: string,
): Promise<ResolvedListing | null> {
  const row = (await findClassListing(studentId, listingId)) ?? (await findBrowseListing(listingId));
  if (!row) return null;
  const vacancyKey = vacancyKeyFor(row);
  return vacancyKey ? { ...row, vacancyKey } : null;
}

// ─── Saves ───────────────────────────────────────────────────────────────────

interface SavedMatch {
  id: string;
  vacancyKey: string | null;
  jobListingId: string | null;
  jobBrowseListingId: string | null;
  listingKind?: string | null;
  appliedAt: Date | null;
}

function linkFor(listing: ResolvedListing): { jobListingId: string } | { jobBrowseListingId: string } {
  return listing.kind === "class" ? { jobListingId: listing.id } : { jobBrowseListingId: listing.id };
}

function holdsLink(row: SavedMatch, listing: ResolvedListing): boolean {
  return listing.kind === "class" ? row.jobListingId === listing.id : row.jobBrowseListingId === listing.id;
}

/**
 * The row to update: the one already keyed to this vacancy, else a legacy
 * row holding this listing link. `linkTaken` is true when a different row
 * holds the link, so moving it would break the student/listing unique key.
 */
export function pickSavedTarget(
  matches: readonly SavedMatch[],
  listing: ResolvedListing,
): { target: SavedMatch | null; linkTaken: boolean } {
  const target = matches.find((row) => row.vacancyKey === listing.vacancyKey) ?? matches[0] ?? null;
  const linkTaken = matches.some((row) => row.id !== target?.id && holdsLink(row, listing));
  return { target, linkTaken };
}

export interface SaveJobInput {
  status: SavedJobStatus;
  notes?: string;
}

/** Saves or updates the student's tracker row for this vacancy. */
export async function saveJobForStudent(
  studentId: string,
  listing: ResolvedListing,
  input: SaveJobInput,
  now: Date = new Date(),
): Promise<StudentSavedJob> {
  const matches: SavedMatch[] = await prisma.studentSavedJob.findMany({
    where: { studentId, OR: [{ vacancyKey: listing.vacancyKey }, linkFor(listing)] },
    select: { id: true, vacancyKey: true, jobListingId: true, jobBrowseListingId: true, listingKind: true, appliedAt: true },
  });
  const { target, linkTaken } = pickSavedTarget(matches, listing);
  const shared = { status: input.status, vacancyKey: listing.vacancyKey, ...vacancySnapshotFor(listing, now) };
  const applies = APPLIED_STATUSES.has(input.status);
  if (!target) {
    return prisma.studentSavedJob.create({
      data: {
        studentId,
        ...shared,
        ...linkFor(listing),
        listingKind: listing.kind,
        notes: input.notes || null,
        appliedAt: applies ? now : null,
      },
    });
  }
  return prisma.studentSavedJob.update({
    where: { id: target.id },
    data: {
      ...shared,
      ...(linkTaken ? {} : linkFor(listing)),
      ...(target.listingKind ? {} : { listingKind: listing.kind }),
      notes: input.notes !== undefined ? input.notes || null : undefined,
      appliedAt: applies && !target.appliedAt ? now : undefined,
    },
  });
}

const BOARD_SAVED_SELECT = {
  jobListingId: true,
  jobBrowseListingId: true,
  vacancyKey: true,
  status: true,
  notes: true,
  appliedAt: true,
  snapshotCompany: true,
  snapshotSource: true,
  jobListing: { select: { clusters: true, company: true, source: true } },
  jobBrowseListing: { select: { clusters: true, company: true, source: true } },
} as const satisfies Prisma.StudentSavedJobSelect;

export type BoardSavedJob = Prisma.StudentSavedJobGetPayload<{ select: typeof BOARD_SAVED_SELECT }>;

/** Every tracker row the student has, for board status and ranking. */
export async function loadSavedJobsForBoard(studentId: string): Promise<BoardSavedJob[]> {
  return prisma.studentSavedJob.findMany({ where: { studentId }, select: BOARD_SAVED_SELECT });
}

// ─── Hides ───────────────────────────────────────────────────────────────────

/** Rollback switch: SystemConfig `job_hide_enabled` = "off" turns hiding off. */
export async function isJobHideEnabled(): Promise<boolean> {
  const value = await getPlainConfigValue("job_hide_enabled");
  return value?.trim().toLowerCase() !== "off";
}

const HIDDEN_SUMMARY_SELECT = {
  id: true,
  vacancyKey: true,
  snapshotTitle: true,
  snapshotCompany: true,
  snapshotLocation: true,
  hiddenAt: true,
  restoredAt: true,
} as const satisfies Prisma.StudentHiddenJobSelect;

export type HiddenJobSummary = Prisma.StudentHiddenJobGetPayload<{ select: typeof HIDDEN_SUMMARY_SELECT }>;

/** Not interested: writes or reopens the student's hidden row for the vacancy. */
export async function hideJobForStudent(
  studentId: string,
  listing: ResolvedListing,
  now: Date = new Date(),
): Promise<HiddenJobSummary> {
  const { snapshotAt: _snapshotAt, ...snapshot } = vacancySnapshotFor(listing, now);
  return prisma.studentHiddenJob.upsert({
    where: { studentId_vacancyKey: { studentId, vacancyKey: listing.vacancyKey } },
    create: { studentId, vacancyKey: listing.vacancyKey, ...snapshot, hiddenAt: now },
    update: { ...snapshot, hiddenAt: now, restoredAt: null },
    select: HIDDEN_SUMMARY_SELECT,
  });
}

/** Restore keeps the row as history. Null when it is not this student's open hide. */
export async function restoreHiddenJob(
  studentId: string,
  hiddenJobId: string,
  now: Date = new Date(),
): Promise<HiddenJobSummary | null> {
  const row = await prisma.studentHiddenJob.findFirst({
    where: { id: hiddenJobId, studentId, restoredAt: null },
    select: { id: true },
  });
  if (!row) return null;
  return prisma.studentHiddenJob.update({
    where: { id: row.id },
    data: { restoredAt: now },
    select: HIDDEN_SUMMARY_SELECT,
  });
}

const HIDDEN_LIST_LIMIT = 200;

export async function listHiddenJobs(studentId: string): Promise<HiddenJobSummary[]> {
  return prisma.studentHiddenJob.findMany({
    where: { studentId, restoredAt: null },
    orderBy: { hiddenAt: "desc" },
    take: HIDDEN_LIST_LIMIT,
    select: HIDDEN_SUMMARY_SELECT,
  });
}

/** Keys the board leaves out. Empty, with no query, while hiding is off. */
export async function loadHiddenVacancyKeys(studentId: string): Promise<ReadonlySet<string>> {
  if (!(await isJobHideEnabled())) return new Set();
  const rows = await prisma.studentHiddenJob.findMany({
    where: { studentId, restoredAt: null },
    select: { vacancyKey: true },
  });
  return new Set(rows.map((row) => row.vacancyKey));
}
