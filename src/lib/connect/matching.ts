// =============================================================================
// Match & Connect — the ranked views.
//
// Phase 3, Task 3.3. `fit()` and every scoring rule live in
// ./matching-shared.ts (Prisma-free, importable from a client component);
// this module is the loading half.
//
// Every loader here obeys one rule: a fixed number of queries, whatever the
// size of the roster or the board. `rankStudentsForLead` issues four,
// `summarizeLeadFits` four, `rankRoster` four, `rankLeadsForStudent` seven.
// None loops a query over a list, and matching.test.ts pins the exact call
// list for all four, so a per-student `findUnique` added later turns red
// rather than quietly making a class of 30 into 90 round trips.
//
// All are capped. An unbounded program-wide rank is a page that gets slower
// every term; MAX_CANDIDATES / MAX_LEADS bound the work, and the result says
// whether the cap was hit so a caller can page.
//
// One rule shapes the SELECTs: the student path must never touch the Employer
// table. `employer_access` has no student branch, so a student-session query
// that filtered or selected through the relation would come back empty under
// RLS — a silent wrong answer, not an error. That is why JobLead carries a
// denormalised `employerName`, and why there are two selects below.
// =============================================================================

import { prisma } from "@/lib/db";

import { ENROLLED_STATUSES } from "./classes";
import { employerNameKey, readSubsidyFlags, type SubsidyFlags } from "./employers-shared";
import { parseLeadRequirements, parseLeadSchedule } from "./leads-shared";
import {
  fit,
  rankLeadFits,
  type FitResult,
  type LeadFit,
  type MatchLead,
  type MatchStudent,
} from "./matching-shared";
import { getWorkProfiles } from "./work-profile";
import { parseTransferableSkillNames } from "@/lib/job-board/recommendation";
import { parseStoredResumeData } from "@/lib/resume";

/** Most students ranked against one lead in a single call. */
export const MAX_CANDIDATES = 100;
/** Most leads ranked for one student in a single call. */
export const MAX_LEADS = 100;

/** A certification only clears a must-have when an instructor verified it. */
const VERIFIED = "verified";

// ---------------------------------------------------------------------------
// Lead rows
// ---------------------------------------------------------------------------

/** The lead columns both paths read. No relation, by design. */
const LEAD_BASE_SELECT = {
  id: true,
  title: true,
  description: true,
  employerId: true,
  employerName: true,
  status: true,
  location: true,
  clusters: true,
  requirements: true,
  schedule: true,
  payMin: true,
  payMax: true,
  payPeriod: true,
  transitNotes: true,
  distanceMiles: true,
  source: true,
  classId: true,
} as const;

/**
 * The STUDENT path. Lead columns only — no `employer` relation, no filter that
 * reaches through one. `employerStatus` is not read at all here because a
 * student cannot see it: an employer moving to `do_not_contact` pauses its
 * open leads instead (see updateEmployer), so the lead's own `status` already
 * carries that fact.
 */
const LEAD_STUDENT_SELECT = LEAD_BASE_SELECT;

/** The STAFF path, which may read the employer. */
const LEAD_STAFF_SELECT = {
  ...LEAD_BASE_SELECT,
  employer: {
    select: {
      id: true,
      name: true,
      status: true,
      hiredSpokesGradBefore: true,
      subsidyFlags: true,
    },
  },
} as const;

interface LeadBaseRow {
  id: string;
  title: string;
  description: string | null;
  employerId: string;
  employerName: string;
  status: string;
  location: string;
  clusters: string[];
  requirements: unknown;
  schedule: unknown;
  payMin: number | null;
  payMax: number | null;
  payPeriod: string;
  transitNotes: string | null;
  distanceMiles: number | null;
  source: string;
  classId: string | null;
}

interface LeadRow extends LeadBaseRow {
  employer: {
    id: string;
    name: string;
    status: string;
    hiredSpokesGradBefore: boolean;
    subsidyFlags: unknown;
  };
}

function baseMatchLead(row: LeadBaseRow): Omit<
  MatchLead,
  "employerStatus" | "employerHiredSpokesGradBefore"
> {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    employerId: row.employerId,
    employerName: row.employerName,
    status: row.status,
    location: row.location,
    clusters: row.clusters,
    requirements: parseLeadRequirements(row.requirements),
    schedule: parseLeadSchedule(row.schedule),
    payMin: row.payMin,
    payMax: row.payMax,
    payPeriod: row.payPeriod,
    transitNotes: row.transitNotes,
    distanceMiles: row.distanceMiles,
    source: row.source,
  };
}

function toMatchLead(row: LeadRow): MatchLead {
  return {
    ...baseMatchLead(row),
    employerStatus: row.employer.status,
    employerHiredSpokesGradBefore: row.employer.hiredSpokesGradBefore,
  };
}

/**
 * The student's view of a lead. `employerStatus` is asserted "active" because
 * the query could not read it and a paused employer's leads are paused: if
 * that invariant ever broke, the lead would still be gated by its own status.
 * `hiredSpokesGradBefore` is false, so the student's ranking simply does not
 * use that bonus — a number they never see anyway.
 */
function toStudentMatchLead(row: LeadBaseRow): MatchLead {
  return {
    ...baseMatchLead(row),
    employerStatus: "active",
    employerHiredSpokesGradBefore: false,
  };
}

// ---------------------------------------------------------------------------
// Withdrawals
// ---------------------------------------------------------------------------

/**
 * Employers a student has already backed out of, by name key.
 *
 * Today the only recorded withdrawal is an `Application` the student marked
 * withdrawn, and an Application points at an `Opportunity` whose employer is
 * free text — so the join is by normalized name, the same key the Employer
 * table is deduped on. Phase 4's `Connection` carries a real employerId and
 * this becomes a union of the two.
 */
function withdrawnKeysByStudent(
  rows: Array<{ studentId: string; opportunity: { company: string } }>,
): Map<string, Set<string>> {
  const byStudent = new Map<string, Set<string>>();
  for (const row of rows) {
    const key = employerNameKey(row.opportunity.company);
    if (!key) continue;
    const set = byStudent.get(row.studentId) ?? new Set<string>();
    set.add(key);
    byStudent.set(row.studentId, set);
  }
  return byStudent;
}

async function loadWithdrawals(studentIds: string[]) {
  return prisma.application.findMany({
    where: { studentId: { in: studentIds }, status: "withdrawn" },
    select: { studentId: true, opportunity: { select: { company: true } } },
  });
}

// ---------------------------------------------------------------------------
// Candidate loading (shared by the reverse match and the board counts)
// ---------------------------------------------------------------------------

const CANDIDATE_SELECT = {
  classId: true,
  class: { select: { jobConfig: { select: { region: true } } } },
  student: {
    select: {
      id: true,
      displayName: true,
      careerDiscovery: {
        select: { topClusters: true, hollandCode: true, transferableSkills: true },
      },
      resumeData: { select: { data: true } },
      certifications: {
        where: { verificationStatus: VERIFIED },
        select: { certType: true },
      },
    },
  },
} as const;

interface Candidate {
  classId: string;
  class: { jobConfig: { region: string } | null } | null;
  student: {
    id: string;
    displayName: string;
    careerDiscovery: {
      topClusters: string[];
      hollandCode: string | null;
      transferableSkills: string | null;
    } | null;
    resumeData: { data: string } | null;
    certifications: Array<{ certType: string }>;
  };
}

/**
 * One query for the whole candidate pool, with every per-student scoring input
 * selected alongside. `take` is limit + 1 so a caller can tell "exactly at the
 * cap" from "more than the cap" without a second count query.
 *
 * A student enrolled in two classes has two enrollment rows, so the result is
 * deduped by student id — otherwise they would appear twice on the board and
 * be counted twice in "N fit". When a classId is named, the row for THAT class
 * wins, because it carries the region the location score uses.
 */
async function loadCandidates(classId: string | null, limit: number): Promise<Candidate[]> {
  const rows = (await prisma.studentClassEnrollment.findMany({
    where: {
      status: { in: [...ENROLLED_STATUSES] },
      ...(classId ? { classId } : {}),
      student: { isActive: true, role: "student" },
    },
    // Over-fetch so the cap still yields `limit` DISTINCT students after
    // dedupe. Doubling covers a student in two classes, which is the real
    // case; a third enrollment costs one candidate off the end of the page.
    take: limit * 2 + 1,
    orderBy: [{ studentId: "asc" }, { classId: "asc" }],
    select: CANDIDATE_SELECT,
  })) as Candidate[];

  const byStudent = new Map<string, Candidate>();
  for (const row of rows) {
    const existing = byStudent.get(row.student.id);
    if (!existing) {
      byStudent.set(row.student.id, row);
      continue;
    }
    if (classId && row.classId === classId) byStudent.set(row.student.id, row);
  }
  return [...byStudent.values()];
}

function toMatchStudent(
  candidate: Candidate,
  context: {
    workProfile: MatchStudent["workProfile"];
    withdrewFromEmployer: boolean;
    employerId: string;
  },
): MatchStudent {
  const student = candidate.student;
  const resume = student.resumeData ? parseStoredResumeData(student.resumeData.data) : null;
  return {
    studentId: student.id,
    displayName: student.displayName,
    workProfile: context.workProfile,
    verifiedCertIds: student.certifications.map((cert) => cert.certType),
    discovery: student.careerDiscovery
      ? {
          topClusters: student.careerDiscovery.topClusters,
          hollandCode: student.careerDiscovery.hollandCode,
        }
      : null,
    resumeSkills: [
      ...(resume?.skills ?? []),
      ...parseTransferableSkillNames(student.careerDiscovery?.transferableSkills),
    ],
    classRegion: candidate.class?.jobConfig?.region ?? "",
    withdrawnEmployerIds: context.withdrewFromEmployer ? [context.employerId] : [],
  };
}

// ---------------------------------------------------------------------------
// rankStudentsForLead — the console's reverse match
// ---------------------------------------------------------------------------

export interface StudentFit {
  studentId: string;
  displayName: string;
  fit: FitResult;
}

export interface LeadMatchResult {
  lead: MatchLead;
  subsidyFlags: SubsidyFlags;
  /** Sorted by score, best first. Nobody in here is hard-blocked. */
  fits: StudentFit[];
  /** Everyone the lead is closed to, with the reasons, so staff can act. */
  blocked: StudentFit[];
  /** How many students were considered. */
  considered: number;
  capped: boolean;
}

/**
 * Which students fit one lead, and which are blocked and why.
 *
 * Staff-only. The lead is read through the CALLER'S OWN RLS context, so a
 * session that cannot see it gets null rather than a leak — the class check
 * lives here rather than at the call site, because this function is what the
 * console's drill-in and any future route both go through. The candidate pool
 * is the lead's class when it names one, and every enrolled student when the
 * lead is program-wide.
 */
export async function rankStudentsForLead(
  jobLeadId: string,
  options: { limit?: number } = {},
): Promise<LeadMatchResult | null> {
  const limit = Math.min(options.limit ?? MAX_CANDIDATES, MAX_CANDIDATES);

  // 1 — the lead and its employer.
  const leadRow = await prisma.jobLead.findUnique({
    where: { id: jobLeadId },
    select: LEAD_STAFF_SELECT,
  });
  if (!leadRow) return null;

  const row = leadRow as LeadRow;
  const lead = toMatchLead(row);

  // 2 — the candidate pool, one query with every scoring input selected.
  const candidates = await loadCandidates(row.classId, limit);
  const capped = candidates.length > limit;
  const roster = candidates.slice(0, limit);
  const studentIds = roster.map((candidate) => candidate.student.id);

  // 3 and 4 — work profiles and withdrawals, both batched by student id.
  const [workProfiles, withdrawnRows] = await Promise.all([
    getWorkProfiles(studentIds),
    loadWithdrawals(studentIds),
  ]);
  const withdrawn = withdrawnKeysByStudent(withdrawnRows);
  const employerKey = employerNameKey(row.employer.name);

  const fits: StudentFit[] = [];
  const blocked: StudentFit[] = [];

  for (const candidate of roster) {
    const student = candidate.student;
    const result = fit(
      toMatchStudent(candidate, {
        workProfile: workProfiles.get(student.id) ?? null,
        withdrewFromEmployer: withdrawn.get(student.id)?.has(employerKey) ?? false,
        employerId: lead.employerId,
      }),
      lead,
    );
    const entry: StudentFit = {
      studentId: student.id,
      displayName: student.displayName,
      fit: result,
    };
    if (result.hardBlocks.length > 0) blocked.push(entry);
    else fits.push(entry);
  }

  // The studentId tiebreaker makes the order total: two students with the same
  // score AND the same display name would otherwise shuffle between requests.
  fits.sort(
    (a, b) =>
      b.fit.score - a.fit.score ||
      a.displayName.localeCompare(b.displayName) ||
      a.studentId.localeCompare(b.studentId),
  );
  blocked.sort(
    (a, b) =>
      a.displayName.localeCompare(b.displayName) || a.studentId.localeCompare(b.studentId),
  );

  return {
    lead,
    subsidyFlags: readSubsidyFlags(row.employer.subsidyFlags),
    fits,
    blocked,
    considered: roster.length,
    capped,
  };
}

// ---------------------------------------------------------------------------
// summarizeLeadFits — the console's leads board
// ---------------------------------------------------------------------------

export interface BlockedStudent {
  studentId: string;
  displayName: string;
  /** One grade-6 sentence. Never a code. */
  reason: string;
}

export interface LeadFitCounts {
  jobLeadId: string;
  fitCount: number;
  blockedCount: number;
  /**
   * The first few blocked students and why, for the console's drill-in. Named
   * students, so a caller that returns this over HTTP must strip it unless the
   * surface is one that already shows the roster.
   */
  blocked: BlockedStudent[];
}

/** How many blocked students a lead card lists before "and N more". */
export const MAX_BLOCKED_SHOWN = 5;

/**
 * "N fit / M blocked" for a whole board of leads.
 *
 * Calling rankStudentsForLead once per lead would be four queries per row —
 * twenty leads would be eighty round trips. This loads the roster ONCE and
 * scores every lead against it in memory, so the board costs the same three
 * queries whether it shows one lead or fifty. `fit()` is pure, so running it
 * 30 x 20 times is arithmetic, not I/O.
 *
 * A lead scoped to a class is counted against that class's roster; a
 * program-wide lead is counted against everyone loaded.
 */
export async function summarizeLeadFits(
  jobLeadIds: string[],
  options: { limit?: number } = {},
): Promise<LeadFitCounts[]> {
  if (jobLeadIds.length === 0) return [];
  const limit = Math.min(options.limit ?? MAX_CANDIDATES, MAX_CANDIDATES);

  const leadRows = (await prisma.jobLead.findMany({
    where: { id: { in: jobLeadIds } },
    select: LEAD_STAFF_SELECT,
  })) as LeadRow[];
  if (leadRows.length === 0) return [];

  const candidates = (await loadCandidates(null, limit)).slice(0, limit);
  const studentIds = candidates.map((candidate) => candidate.student.id);

  const [workProfiles, withdrawnRows] = await Promise.all([
    getWorkProfiles(studentIds),
    loadWithdrawals(studentIds),
  ]);
  const withdrawn = withdrawnKeysByStudent(withdrawnRows);

  return leadRows.map((row) => {
    const lead = toMatchLead(row);
    const employerKey = employerNameKey(row.employer.name);
    const pool = row.classId
      ? candidates.filter((candidate) => candidate.classId === row.classId)
      : candidates;

    let fitCount = 0;
    const blocked: BlockedStudent[] = [];
    for (const candidate of pool) {
      const matchStudent = toMatchStudent(candidate, {
        workProfile: workProfiles.get(candidate.student.id) ?? null,
        withdrewFromEmployer: withdrawn.get(candidate.student.id)?.has(employerKey) ?? false,
        employerId: lead.employerId,
      });
      const result = fit(matchStudent, lead);
      if (result.hardBlocks.length > 0) {
        blocked.push({
          studentId: candidate.student.id,
          displayName: candidate.student.displayName,
          // The FIRST reason only. A card listing four sentences per student
          // is a card nobody reads; the drill-in names the one thing to fix.
          reason: result.blockReasons[0] ?? "Not a fit right now.",
        });
      } else {
        fitCount += 1;
      }
    }
    blocked.sort(
      (a, b) =>
        a.displayName.localeCompare(b.displayName) || a.studentId.localeCompare(b.studentId),
    );
    return {
      jobLeadId: row.id,
      fitCount,
      blockedCount: blocked.length,
      blocked: blocked.slice(0, MAX_BLOCKED_SHOWN),
    };
  });
}

// ---------------------------------------------------------------------------
// rankRoster — the console's students board
// ---------------------------------------------------------------------------

export interface RosterLead {
  jobLeadId: string;
  title: string;
  employerName: string;
  score: number;
  reasons: string[];
}

export interface RosterEntry {
  studentId: string;
  displayName: string;
  /** Best leads first, capped by the caller's `leadsPerStudent`. */
  leads: RosterLead[];
}

/**
 * "Best leads" for every student on the roster.
 *
 * Deliberately NOT a loop over `rankLeadsForStudent`: that is six queries per
 * student, so a class of thirty would be a hundred and eighty round trips for
 * one page. This shares the same three loads `summarizeLeadFits` uses and runs
 * the identical `fit()` per (student, lead) pair in memory — same rules, same
 * numbers, one page load.
 */
export async function rankRoster(
  options: { classId?: string | null; limit?: number; leadsPerStudent?: number } = {},
): Promise<RosterEntry[]> {
  const limit = Math.min(options.limit ?? MAX_CANDIDATES, MAX_CANDIDATES);
  const leadsPerStudent = options.leadsPerStudent ?? 3;

  // Staff surface, so reading the employer is allowed. The status filter is on
  // the LEAD, not the employer: updateEmployer pauses open leads when an
  // employer goes do_not_contact, so `status: "open"` already excludes them
  // and the query keeps one shape for both callers.
  const leadRows = (await prisma.jobLead.findMany({
    where: { status: "open" },
    take: MAX_LEADS,
    orderBy: [{ postedAt: "desc" }, { id: "asc" }],
    select: LEAD_STAFF_SELECT,
  })) as LeadRow[];

  const candidates = (await loadCandidates(options.classId ?? null, limit)).slice(0, limit);
  const studentIds = candidates.map((candidate) => candidate.student.id);

  const [workProfiles, withdrawnRows] = await Promise.all([
    getWorkProfiles(studentIds),
    loadWithdrawals(studentIds),
  ]);
  const withdrawn = withdrawnKeysByStudent(withdrawnRows);

  return candidates.map((candidate) => {
    const leads: RosterLead[] = [];

    for (const row of leadRows) {
      // A class-scoped lead is only a candidate for that class's students.
      if (row.classId && row.classId !== candidate.classId) continue;

      const lead = toMatchLead(row);
      const result = fit(
        toMatchStudent(candidate, {
          workProfile: workProfiles.get(candidate.student.id) ?? null,
          withdrewFromEmployer:
            withdrawn.get(candidate.student.id)?.has(employerNameKey(row.employer.name)) ?? false,
          employerId: lead.employerId,
        }),
        lead,
      );
      if (result.hardBlocks.length > 0) continue;

      leads.push({
        jobLeadId: lead.id,
        title: lead.title,
        employerName: lead.employerName,
        score: result.score,
        reasons: result.reasons,
      });
    }

    leads.sort((a, b) => b.score - a.score || a.jobLeadId.localeCompare(b.jobLeadId));

    return {
      studentId: candidate.student.id,
      displayName: candidate.student.displayName,
      leads: leads.slice(0, leadsPerStudent),
    };
  });
}

// ---------------------------------------------------------------------------
// rankLeadsForStudent — the student's own view and Sage's search_jobs
// ---------------------------------------------------------------------------

/**
 * The open leads visible to one student, best first, hard blocks removed.
 *
 * Student-scoped: it reads only leads that are open and either program-wide or
 * attached to a class the student is actively enrolled in — the same rule the
 * `job_lead_read` RLS policy enforces underneath, stated here too so the query
 * is right on its own and not only because a policy caught it.
 */
export async function rankLeadsForStudent(
  studentId: string,
  options: { limit?: number } = {},
): Promise<LeadFit[]> {
  const limit = Math.min(options.limit ?? MAX_LEADS, MAX_LEADS);

  const enrollments = await prisma.studentClassEnrollment.findMany({
    where: { studentId, status: { in: [...ENROLLED_STATUSES] } },
    select: { classId: true, class: { select: { jobConfig: { select: { region: true } } } } },
  });
  const classIds = enrollments.map((enrollment) => enrollment.classId);
  const classRegion =
    enrollments.find((enrollment) => enrollment.class?.jobConfig?.region)?.class?.jobConfig
      ?.region ?? "";

  const [leadRows, workProfiles, discovery, resumeRecord, certifications, withdrawnRows] =
    await Promise.all([
      // LEAD COLUMNS ONLY. Filtering or selecting through `employer` here would
      // run against a policy with no student branch, and Prisma answers that
      // with zero rows or an inconsistency error — a silently empty job list
      // for the student, which is the worst possible failure for this feature.
      // An employer marked do_not_contact has its open leads paused instead,
      // so `status: "open"` covers that case using a lead column.
      prisma.jobLead.findMany({
        where: {
          status: "open",
          OR: [{ classId: null }, { classId: { in: classIds } }],
        },
        take: limit,
        orderBy: [{ postedAt: "desc" }, { id: "asc" }],
        select: LEAD_STUDENT_SELECT,
      }),
      getWorkProfiles([studentId]),
      prisma.careerDiscovery.findUnique({
        where: { studentId },
        select: { topClusters: true, hollandCode: true, transferableSkills: true },
      }),
      prisma.resumeData.findUnique({ where: { studentId }, select: { data: true } }),
      prisma.certification.findMany({
        where: { studentId, verificationStatus: VERIFIED },
        select: { certType: true },
      }),
      loadWithdrawals([studentId]),
    ]);

  const resume = resumeRecord ? parseStoredResumeData(resumeRecord.data) : null;
  const withdrawnKeys = withdrawnKeysByStudent(withdrawnRows).get(studentId) ?? new Set<string>();

  const leads = (leadRows as LeadBaseRow[]).map(toStudentMatchLead);
  const withdrawnEmployerIds = leads
    .filter((lead) => withdrawnKeys.has(employerNameKey(lead.employerName)))
    .map((lead) => lead.employerId);

  const student: MatchStudent = {
    studentId,
    workProfile: workProfiles.get(studentId) ?? null,
    verifiedCertIds: certifications.map((cert) => cert.certType),
    discovery: discovery
      ? { topClusters: discovery.topClusters, hollandCode: discovery.hollandCode }
      : null,
    resumeSkills: [
      ...(resume?.skills ?? []),
      ...parseTransferableSkillNames(discovery?.transferableSkills),
    ],
    classRegion,
    withdrawnEmployerIds,
  };

  // The ordering rule lives in matching-shared.ts so the `matching-quality`
  // benchmark can measure the ranking a student actually gets without standing
  // up a database — and, more to the point, without a second copy of the sort
  // that could drift from this one.
  return rankLeadFits(student, leads);
}
