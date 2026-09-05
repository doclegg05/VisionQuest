// =============================================================================
// Who goes in the WorkForce WV batch — the one selection both the preview and
// the export run (Match & Connect Task 3.4).
//
// Deliberately ONE function with two callers. The preview's whole job is to
// tell an instructor what the download will contain, so a second
// implementation that drifted would make the confirm dialog a lie. Everything
// that decides inclusion lives here; ./workforce-batch.ts formats.
//
// Two gates, both required (design spec §8 and §10):
//   readiness  — `readinessScore >= READY_TO_WORK_SCORE`. The page says "ready
//                students" and a file that quietly held the whole roster would
//                be a different disclosure than the one the instructor agreed
//                to.
//   consent    — an active `employer_referral` ConsentRecord. Nothing about a
//                student leaves this program without it.
//
// The class is required, not optional. A program-wide export is a bigger
// disclosure than anyone means to make with one tap, and requiring the class
// also removes the row cap that used to silently truncate the result.
// =============================================================================

import { hasActiveConsent } from "@/lib/consent";
import { prisma } from "@/lib/db";
import { fetchStudentReadinessData } from "@/lib/progression/fetch-readiness-data";

import { ENROLLED_STATUSES } from "./classes";
import { getWorkProfiles } from "./work-profile";
import {
  AVAILABILITY_DAYS,
  AVAILABILITY_SLOTS,
  type WorkProfile,
} from "./work-profile-shared";
import { READY_TO_WORK_SCORE, type BatchRow } from "./workforce-batch";

/**
 * How many readiness computations run at once.
 *
 * `fetchStudentReadinessData` is eight queries per student by construction —
 * it is the shared readiness computation, not a batch query. A class of thirty
 * in one `Promise.all` is 240 simultaneous connections at the pooler, which is
 * how a page takes a database down. Ten at a time keeps the wall time short
 * and the connection count sane.
 */
const READINESS_CONCURRENCY = 10;

export interface BatchSelection {
  /** Formatted rows, in the order the CSV will list them. */
  rows: BatchRow[];
  /** Student ids behind those rows — what to audit. */
  includedIds: string[];
  /** Counts only. The excluded are not named: they did not consent. */
  excludedNotReady: number;
  excludedNoConsent: number;
}

function countAvailableCells(profile: WorkProfile | undefined): number {
  if (!profile) return 0;
  let count = 0;
  for (const day of AVAILABILITY_DAYS) {
    for (const slot of AVAILABILITY_SLOTS) {
      if (profile.availability[day]?.[slot]) count += 1;
    }
  }
  return count;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return results;
}

/**
 * Surname first, then given name — how a Business Services Rep reads a list.
 * `displayName` is free text, so "last word" is the honest approximation and
 * the full name is what actually prints.
 */
function sortKey(displayName: string): string {
  const parts = displayName.trim().split(/\s+/u);
  const last = parts.length > 1 ? parts[parts.length - 1] : parts[0];
  return `${last} ${displayName}`.toLowerCase();
}

/**
 * The students in one class who are ready AND have consented, with the counts
 * of who was left out and why.
 *
 * The caller must already have checked that the session may see `classId`
 * (`listConnectClasses`, which asks the instructor question the RLS policies
 * ask); the queries additionally run in the caller's RLS context, so a class
 * that is not theirs yields nobody.
 */
export async function selectBatchStudents(classId: string): Promise<BatchSelection> {
  const enrollments = await prisma.studentClassEnrollment.findMany({
    where: {
      classId,
      status: { in: [...ENROLLED_STATUSES] },
      student: { isActive: true, role: "student" },
    },
    // A stable read order. Without it Postgres may hand back a different
    // sequence run to run, so the preview a teacher confirms and the file they
    // download could dedupe to a different row for the same person — and the
    // export's own last-name sort would still be non-deterministic between
    // students whose sort key ties.
    orderBy: [{ studentId: "asc" }, { classId: "asc" }],
    select: {
      class: { select: { name: true } },
      student: {
        select: {
          id: true,
          displayName: true,
          certifications: {
            where: { verificationStatus: "verified" },
            select: { certType: true },
          },
        },
      },
    },
  });

  // A student in the same class twice is not a thing, but dedupe anyway: the
  // count in the confirm dialog has to be the number of PEOPLE.
  const students = [
    ...new Map(enrollments.map((row) => [row.student.id, row])).values(),
  ];
  if (students.length === 0) {
    return { rows: [], includedIds: [], excludedNotReady: 0, excludedNoConsent: 0 };
  }

  const studentIds = students.map((row) => row.student.id);

  const [workProfiles, readiness, consents] = await Promise.all([
    getWorkProfiles(studentIds),
    mapWithConcurrency(studentIds, READINESS_CONCURRENCY, (id) =>
      fetchStudentReadinessData(id),
    ),
    mapWithConcurrency(studentIds, READINESS_CONCURRENCY, (id) =>
      hasActiveConsent(id, "employer_referral"),
    ),
  ]);

  let excludedNotReady = 0;
  let excludedNoConsent = 0;
  const included: Array<{ id: string; row: BatchRow }> = [];

  students.forEach((entry, index) => {
    const score = readiness[index].readiness.score;
    if (score < READY_TO_WORK_SCORE) {
      excludedNotReady += 1;
      return;
    }
    // Checked second and counted separately, so the instructor can tell
    // "not ready yet" from "has not agreed to be referred" — different
    // problems with different fixes.
    if (!consents[index]) {
      excludedNoConsent += 1;
      return;
    }

    const profile = workProfiles.get(entry.student.id);
    included.push({
      id: entry.student.id,
      row: {
        displayName: entry.student.displayName,
        className: entry.class.name,
        readinessScore: score,
        earliestStart: profile?.earliestStart ?? null,
        availableCells: countAvailableCells(profile),
        transport: profile?.transport ?? null,
        verifiedCertifications: entry.student.certifications.map((cert) => cert.certType),
      },
    });
  });

  included.sort((a, b) => sortKey(a.row.displayName).localeCompare(sortKey(b.row.displayName)));

  return {
    rows: included.map((entry) => entry.row),
    includedIds: included.map((entry) => entry.id),
    excludedNotReady,
    excludedNoConsent,
  };
}
