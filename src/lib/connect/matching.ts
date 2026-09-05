// =============================================================================
// Match & Connect — the ranked views.
//
// Phase 3, Task 3.3. `fit()` and every scoring rule live in
// ./matching-shared.ts (Prisma-free, importable from a client component);
// this module is the loading half.
//
// Every loader here obeys one rule: a fixed number of queries, whatever the
// size of the roster or the board. `rankStudentsForLead` issues four,
// `summarizeLeadFits` three, `rankLeadsForStudent` six. None loops a query
// over a list. The N+1 guard in matching.test.ts counts the calls on a mocked
// client, so a per-student `findUnique` added later turns it red rather than
// quietly making a class of 30 into 90 round trips.
//
// All three are capped. An unbounded program-wide rank is a page that gets
// slower every term; MAX_CANDIDATES / MAX_LEADS bound the work, and the
// result says whether the cap was hit so a caller can page.
// =============================================================================

import { prisma } from "@/lib/db";

import { employerNameKey, readSubsidyFlags, type SubsidyFlags } from "./employers-shared";
import { parseLeadRequirements, parseLeadSchedule } from "./leads-shared";
import { fit, type FitResult, type MatchLead, type MatchStudent } from "./matching-shared";
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

interface LeadRow {
  id: string;
  title: string;
  description: string | null;
  employerId: string;
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
  employer: {
    id: string;
    name: string;
    status: string;
    hiredSpokesGradBefore: boolean;
    subsidyFlags: unknown;
  };
}

const LEAD_SELECT = {
  id: true,
  title: true,
  description: true,
  employerId: true,
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

function toMatchLead(row: LeadRow): MatchLead {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    employerId: row.employerId,
    employerName: row.employer.name,
    employerStatus: row.employer.status,
    employerHiredSpokesGradBefore: row.employer.hiredSpokesGradBefore,
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
 */
async function loadCandidates(classId: string | null, limit: number): Promise<Candidate[]> {
  const rows = await prisma.studentClassEnrollment.findMany({
    where: {
      status: "active",
      ...(classId ? { classId } : {}),
      student: { isActive: true, role: "student" },
    },
    take: limit + 1,
    orderBy: { studentId: "asc" },
    select: CANDIDATE_SELECT,
  });
  return rows as Candidate[];
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
 * Staff-only: the caller must already have established that the session may
 * see this class. The candidate pool is the lead's class when it names one,
 * and every actively enrolled student when the lead is program-wide.
 */
export async function rankStudentsForLead(
  jobLeadId: string,
  options: { limit?: number } = {},
): Promise<LeadMatchResult | null> {
  const limit = Math.min(options.limit ?? MAX_CANDIDATES, MAX_CANDIDATES);

  // 1 — the lead and its employer.
  const leadRow = await prisma.jobLead.findUnique({
    where: { id: jobLeadId },
    select: LEAD_SELECT,
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

  fits.sort((a, b) => b.fit.score - a.fit.score || a.displayName.localeCompare(b.displayName));
  blocked.sort((a, b) => a.displayName.localeCompare(b.displayName));

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

export interface LeadFitCounts {
  jobLeadId: string;
  fitCount: number;
  blockedCount: number;
}

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
    select: LEAD_SELECT,
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
    let blockedCount = 0;
    for (const candidate of pool) {
      const result = fit(
        toMatchStudent(candidate, {
          workProfile: workProfiles.get(candidate.student.id) ?? null,
          withdrewFromEmployer: withdrawn.get(candidate.student.id)?.has(employerKey) ?? false,
          employerId: lead.employerId,
        }),
        lead,
      );
      if (result.hardBlocks.length > 0) blockedCount += 1;
      else fitCount += 1;
    }
    return { jobLeadId: row.id, fitCount, blockedCount };
  });
}

// ---------------------------------------------------------------------------
// rankLeadsForStudent — the student's own view and Sage's search_jobs
// ---------------------------------------------------------------------------

export interface LeadFit {
  lead: MatchLead;
  fit: FitResult;
}

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
    where: { studentId, status: "active" },
    select: { classId: true, class: { select: { jobConfig: { select: { region: true } } } } },
  });
  const classIds = enrollments.map((enrollment) => enrollment.classId);
  const classRegion =
    enrollments.find((enrollment) => enrollment.class?.jobConfig?.region)?.class?.jobConfig
      ?.region ?? "";

  const [leadRows, workProfiles, discovery, resumeRecord, certifications, withdrawnRows] =
    await Promise.all([
      prisma.jobLead.findMany({
        where: {
          status: "open",
          employer: { status: { not: "do_not_contact" } },
          OR: [{ classId: null }, { classId: { in: classIds } }],
        },
        take: limit,
        orderBy: { postedAt: "desc" },
        select: LEAD_SELECT,
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

  const leads = (leadRows as LeadRow[]).map(toMatchLead);
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

  return leads
    .map((lead) => ({ lead, fit: fit(student, lead) }))
    .filter((entry) => entry.fit.hardBlocks.length === 0)
    .sort((a, b) => b.fit.score - a.fit.score);
}
