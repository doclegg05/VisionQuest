// =============================================================================
// Match & Connect — the matcher, Prisma-free half.
//
// Phase 3, Task 3.3 (docs/superpowers/plans/2026-09-05-match-and-connect.md;
// rules in the design spec §5). `fit(student, lead)` is one pure function with
// two callers: `rankLeadsForStudent` (the student's own view and Sage's
// search_jobs) and `rankStudentsForLead` (the job developer console's reverse
// match). Both live in ./matching.ts, which is where Prisma is allowed.
//
// Two ideas run through the whole file:
//
//   1. A HARD BLOCK is a fact, not a preference. It removes the lead from the
//      student's view and shows the instructor why. Every one of them requires
//      a POSITIVE fact — a declared shift that does not overlap, a stated pay
//      that is under the floor, a recorded "no way to get there". Missing data
//      never blocks. A student who has not done the five-question intake must
//      see every job, ranked a little lower, not an empty list.
//
//   2. Nothing here is employer-facing. The design spec §5 is explicit: the
//      employer sees the packet and the subsidy, never a score or a ranking of
//      candidates. Scores and reasons are for staff and for the student
//      themselves.
//
// The soft score reuses the job-board scorer's own sub-functions unchanged
// (scoreLocation / scoreCluster / scoreRiasec / scoreSkills / scoreSourceTrust)
// so a lead and a scraped posting are ranked on the same axes, then adds four
// connect-specific terms a JobListing has no data for.
// =============================================================================

import {
  buildStudentJobProfile,
  getSkillOverlap,
  inferJobHollandCode,
  scoreCluster,
  scoreLocation,
  scoreRiasec,
  scoreSkills,
  scoreSourceTrust,
  type LocalJobPriority,
} from "@/lib/job-board/recommendation";

import { humanizeCertId } from "./employers-shared";
import {
  SHIFT_LABELS,
  describeLeadPay,
  leadHourlyRange,
  type LeadRequirements,
  type LeadSchedule,
} from "./leads-shared";
import {
  AVAILABILITY_DAYS,
  AVAILABILITY_SLOTS,
  availabilityOverlap,
  transportFeasible,
  type WorkProfile,
} from "./work-profile-shared";

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/**
 * Stable codes, so a console filter or a report can key off them. The words a
 * person reads come from `describeHardBlock` — a code must never reach a
 * screen.
 */
export const HARD_BLOCK = {
  availabilityNoOverlap: "availability_no_overlap",
  missingMustHaveCert: "missing_must_have_cert",
  payBelowFloor: "pay_below_floor",
  transportInfeasible: "transport_infeasible",
  leadNotOpen: "lead_not_open",
  employerDoNotContact: "employer_do_not_contact",
  studentWithdrewFromEmployer: "student_withdrew_from_employer",
} as const;

export type HardBlockCode = (typeof HARD_BLOCK)[keyof typeof HARD_BLOCK];

// Connect-specific score weights. The five reused sub-scorers already account
// for 125 points before any of these; the total is clamped to 100, so these
// act as tie-breakers between leads that score alike on the shared axes.
const WEIGHT_VERIFIED_MUST_HAVE = 7;
const WEIGHT_VERIFIED_NICE_TO_HAVE = 4;
const MAX_CERT_BONUS = 15;
const WEIGHT_AVAILABILITY = 10;
const WEIGHT_HIRED_BEFORE = 8;
const WEIGHT_PAY_ABOVE_FLOOR = 7;

const MAX_REASONS = 5;

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface MatchStudent {
  studentId: string;
  displayName?: string;
  /** null = they have not done the five-question intake. Never a block. */
  workProfile: WorkProfile | null;
  /**
   * VERIFIED certifications only. The caller filters on
   * `verificationStatus === "verified"` before building this — a self-reported
   * card must not clear a must-have requirement, because the employer will
   * ask to see it.
   */
  verifiedCertIds: string[];
  /** Real labels for those ids when the caller has them; ids are humanized otherwise. */
  certLabels?: Record<string, string>;
  discovery: { topClusters: string[]; hollandCode: string | null } | null;
  resumeSkills: string[];
  classRegion: string;
  /** Employers this student has already backed out of. */
  withdrawnEmployerIds: string[];
}

export interface MatchLead {
  id: string;
  title: string;
  description?: string | null;
  employerId: string;
  employerName: string;
  /** active | paused | do_not_contact */
  employerStatus: string;
  employerHiredSpokesGradBefore: boolean;
  /** open | filled | paused | closed */
  status: string;
  location: string;
  clusters: string[];
  requirements: LeadRequirements;
  schedule: LeadSchedule;
  payMin: number | null;
  payMax: number | null;
  payPeriod: string;
  transitNotes: string | null;
  distanceMiles: number | null;
  source: string;
}

export interface FitResult {
  /** 0..100. Always 0 when there is a hard block. */
  score: number;
  hardBlocks: HardBlockCode[];
  /** One grade-6 sentence per hard block, in the same order. */
  blockReasons: string[];
  /** Why this is a good fit, in grade-6 sentences. Empty when blocked. */
  reasons: string[];
}

// ---------------------------------------------------------------------------
// "Has the student actually told us anything?"
// ---------------------------------------------------------------------------

/**
 * True only when at least one cell of the 7x4 grid is ticked.
 *
 * This is the guard that keeps an unanswered intake from reading as "cannot
 * work any shift". It also makes `fit` correct whether `availabilityOverlap`
 * reports "not declared" as 0 (its original contract) or as null: either way,
 * an undeclared grid never reaches the block.
 */
function hasDeclaredAvailability(profile: WorkProfile | null): boolean {
  if (!profile) return false;
  return AVAILABILITY_DAYS.some((day) =>
    AVAILABILITY_SLOTS.some((slot) => profile.availability[day]?.[slot]),
  );
}

function overlapRatio(profile: WorkProfile | null, schedule: LeadSchedule): number | null {
  if (schedule.shifts.length === 0) return null;
  if (!hasDeclaredAvailability(profile)) return null;
  const raw = availabilityOverlap(profile, { shifts: schedule.shifts });
  return typeof raw === "number" ? raw : null;
}

// ---------------------------------------------------------------------------
// Hard blocks
// ---------------------------------------------------------------------------

function certLabel(student: MatchStudent, certId: string): string {
  return student.certLabels?.[certId] ?? humanizeCertId(certId);
}

function missingMustHaveCerts(student: MatchStudent, lead: MatchLead): string[] {
  const verified = new Set(student.verifiedCertIds);
  return lead.requirements.mustHaveCerts.filter((certId) => !verified.has(certId));
}

function payIsBelowFloor(student: MatchStudent, lead: MatchLead): boolean {
  const floor = student.workProfile?.payFloorHourly ?? null;
  if (floor === null) return false;

  const { min, max } = leadHourlyRange(lead);
  // The TOP of the range decides: a $12–$18 job clears a $15 floor, because
  // $18 is reachable. Only a lead whose best stated rate is under the floor is
  // genuinely not worth the student's time. A lead that states no pay at all
  // is unknown, and unknown is not "too little".
  const best = max ?? min;
  return best !== null && best < floor;
}

function transportIsInfeasible(student: MatchStudent, lead: MatchLead): boolean {
  // A named transit route is somebody having checked. Never block over it,
  // whatever the student's own transport answer says.
  if (lead.transitNotes && lead.transitNotes.trim().length > 0) return false;
  return (
    transportFeasible(student.workProfile, {
      transitNotes: lead.transitNotes,
      distanceMiles: lead.distanceMiles,
    }) === "no"
  );
}

function collectHardBlocks(student: MatchStudent, lead: MatchLead): HardBlockCode[] {
  const blocks: HardBlockCode[] = [];

  if (lead.status !== "open") blocks.push(HARD_BLOCK.leadNotOpen);
  if (lead.employerStatus === "do_not_contact") blocks.push(HARD_BLOCK.employerDoNotContact);
  if (student.withdrawnEmployerIds.includes(lead.employerId)) {
    blocks.push(HARD_BLOCK.studentWithdrewFromEmployer);
  }

  const overlap = overlapRatio(student.workProfile, lead.schedule);
  if (overlap === 0) blocks.push(HARD_BLOCK.availabilityNoOverlap);

  if (missingMustHaveCerts(student, lead).length > 0) {
    blocks.push(HARD_BLOCK.missingMustHaveCert);
  }
  if (payIsBelowFloor(student, lead)) blocks.push(HARD_BLOCK.payBelowFloor);
  if (transportIsInfeasible(student, lead)) blocks.push(HARD_BLOCK.transportInfeasible);

  return blocks;
}

/**
 * The sentence an instructor (and, for their own leads, a student) reads.
 * Plain, short, and about the situation rather than the person.
 */
export function describeHardBlock(
  code: HardBlockCode,
  student: MatchStudent,
  lead: MatchLead,
): string {
  switch (code) {
    case HARD_BLOCK.availabilityNoOverlap: {
      const shift = lead.schedule.shifts[0];
      const label = shift ? SHIFT_LABELS[shift].toLowerCase() : "this shift";
      return `The ${label} does not fit the hours they can work.`;
    }
    case HARD_BLOCK.missingMustHaveCert: {
      const missing = missingMustHaveCerts(student, lead).map((id) => certLabel(student, id));
      return `Needs the ${missing[0]} card. Not earned yet.`;
    }
    case HARD_BLOCK.payBelowFloor:
      return "Pays less than they need.";
    case HARD_BLOCK.transportInfeasible:
      return "No way to get there yet.";
    case HARD_BLOCK.leadNotOpen:
      return "This job is not open.";
    case HARD_BLOCK.employerDoNotContact:
      return "Do not contact this employer.";
    case HARD_BLOCK.studentWithdrewFromEmployer:
      return "They backed out of this employer before.";
  }
}

// ---------------------------------------------------------------------------
// Soft score
// ---------------------------------------------------------------------------

/**
 * The shape the job-board scorer's sub-functions expect. A lead is always
 * onsite — an employer-linked opening in this program is a place you go.
 */
function scoredJobShape(lead: MatchLead) {
  return {
    id: lead.id,
    title: lead.title,
    company: lead.employerName,
    description: lead.description ?? "",
    location: lead.location,
    clusters: lead.clusters,
    workMode: "onsite",
    // Not a job-board adapter name, so scoreSourceTrust scores it 0 today.
    // Kept honest rather than borrowing "careeronestop"'s trust bonus: a MACC
    // job order is trustworthy for different reasons, and inventing a source
    // name here would corrupt the job board's own trust signal.
    source: lead.source,
  };
}

function certBonus(student: MatchStudent, lead: MatchLead): number {
  const verified = new Set(student.verifiedCertIds);
  const mustHave = lead.requirements.mustHaveCerts.filter((id) => verified.has(id)).length;
  const niceToHave = lead.requirements.niceToHave.filter((id) => verified.has(id)).length;
  return Math.min(
    MAX_CERT_BONUS,
    mustHave * WEIGHT_VERIFIED_MUST_HAVE + niceToHave * WEIGHT_VERIFIED_NICE_TO_HAVE,
  );
}

function payIsAboveFloor(student: MatchStudent, lead: MatchLead): boolean {
  const floor = student.workProfile?.payFloorHourly ?? null;
  if (floor === null) return false;
  const { min, max } = leadHourlyRange(lead);
  const best = max ?? min;
  return best !== null && best >= floor;
}

// ---------------------------------------------------------------------------
// Reasons
// ---------------------------------------------------------------------------

function buildReasons(
  student: MatchStudent,
  lead: MatchLead,
  overlap: number | null,
): string[] {
  const reasons: string[] = [];

  const shift = lead.schedule.shifts[0];
  if (shift && overlap !== null && overlap > 0) {
    reasons.push(`${SHIFT_LABELS[shift]}. You can work then.`);
  }

  const verified = new Set(student.verifiedCertIds);
  const earned = [...lead.requirements.mustHaveCerts, ...lead.requirements.niceToHave].find(
    (certId) => verified.has(certId),
  );
  if (earned) {
    reasons.push(`Needs the ${certLabel(student, earned)} card you earned.`);
  }

  const pay = describeLeadPay(lead);
  if (pay) {
    reasons.push(payIsAboveFloor(student, lead) ? `${pay} Above the pay you need.` : pay);
  }

  if (lead.transitNotes && lead.transitNotes.trim().length > 0) {
    reasons.push("There is a bus route to this job.");
  }

  if (lead.employerHiredSpokesGradBefore) {
    reasons.push("They have hired SPOKES grads before.");
  }

  const sharedCluster = student.discovery
    ? lead.clusters.some((cluster) => student.discovery?.topClusters.includes(cluster))
    : false;
  if (sharedCluster) {
    reasons.push("This is the kind of work you picked.");
  }

  return reasons.slice(0, MAX_REASONS);
}

// ---------------------------------------------------------------------------
// fit
// ---------------------------------------------------------------------------

/**
 * How well one student fits one lead.
 *
 * A blocked fit scores 0 and carries no positive reasons: showing "85% match,
 * but they cannot get there" invites somebody to send it anyway.
 */
export function fit(
  student: MatchStudent,
  lead: MatchLead,
  priority: LocalJobPriority = "prefer_local",
): FitResult {
  const hardBlocks = collectHardBlocks(student, lead);
  if (hardBlocks.length > 0) {
    return {
      score: 0,
      hardBlocks,
      blockReasons: hardBlocks.map((code) => describeHardBlock(code, student, lead)),
      reasons: [],
    };
  }

  const job = scoredJobShape(lead);
  const jobProfile = buildStudentJobProfile({ resumeSkills: student.resumeSkills });

  const locationScore = scoreLocation(job, student.classRegion, priority);
  const clusterScore = student.discovery
    ? scoreCluster(lead.clusters, student.discovery.topClusters)
    : 0;
  const riasecScore = student.discovery
    ? scoreRiasec(inferJobHollandCode(lead.clusters), student.discovery.hollandCode)
    : 0;
  const skillScore = scoreSkills(getSkillOverlap(job, jobProfile));
  const trustScore = scoreSourceTrust(job, student.classRegion).score;

  const overlap = overlapRatio(student.workProfile, lead.schedule);
  const availabilityScore = overlap === null ? 0 : Math.round(overlap * WEIGHT_AVAILABILITY);
  const hiredBeforeScore = lead.employerHiredSpokesGradBefore ? WEIGHT_HIRED_BEFORE : 0;
  const payScore = payIsAboveFloor(student, lead) ? WEIGHT_PAY_ABOVE_FLOOR : 0;

  const score = Math.max(
    0,
    Math.min(
      100,
      locationScore +
        clusterScore +
        riasecScore +
        skillScore +
        trustScore +
        certBonus(student, lead) +
        availabilityScore +
        hiredBeforeScore +
        payScore,
    ),
  );

  return {
    score,
    hardBlocks: [],
    blockReasons: [],
    reasons: buildReasons(student, lead, overlap),
  };
}
