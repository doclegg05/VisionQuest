import { goalCountsTowardPlan } from "./goals";
import { parseState } from "./progression/engine";
import { computeReadinessScore } from "./progression/readiness-score";

// ---------------------------------------------------------------------------
// Input shape — matches what the API route fetches from Prisma
// ---------------------------------------------------------------------------

export interface KpiStudentRow {
  id: string;
  createdAt: Date;
  conversations: { createdAt: Date }[];
  goals: {
    id: string;
    level: string;
    status: string;
    createdAt: Date;
    resourceLinks: {
      id: string;
      linkType: string;
      status: string;
      createdAt: Date;
      updatedAt: Date;
    }[];
  }[];
  progressionState: string | null;
  certifications: { status: string; startedAt: Date; completedAt: Date | null }[];
  portfolioItems: { id: string }[];
  resumeData: { id: string } | null;
  publicCredentialPage: { isPublic: boolean } | null;
  orientationProgress: { completed: boolean; completedAt: Date | null }[];
}

// ---------------------------------------------------------------------------
// Output shapes
// ---------------------------------------------------------------------------

export interface GoalAdoptionKpis {
  totalStudents: number;
  withBhag: number;
  withBhagPct: number;
  withMonthlyGoal: number;
  withMonthlyGoalPct: number;
  withWeeklyGoal: number;
  withWeeklyGoalPct: number;
  totalActiveGoals: number;
  goalsWithLinkedResources: number;
  goalsWithResourcesPct: number;
}

export interface ResourcePipelineKpis {
  totalAssignedLinks: number;
  linksWithEvidence: number;
  linksWithEvidencePct: number;
  linksCompleted: number;
  linksCompletedPct: number;
  studentsWithAnyEvidence: number;
  studentsWithAnyEvidencePct: number;
}

export interface TimeToMilestoneKpis {
  medianDaysToFirstGoal: number | null;
  avgDaysToFirstGoal: number | null;
  medianDaysGoalToResource: number | null;
  avgDaysGoalToResource: number | null;
  medianDaysResourceToEvidence: number | null;
  avgDaysResourceToEvidence: number | null;
}

export interface ReadinessDistributionKpis {
  distribution: { bucket: string; count: number }[];
  medianScore: number | null;
  avgScore: number | null;
  studentsAbove50: number;
  studentsAbove50Pct: number;
  studentsAbove75: number;
  studentsAbove75Pct: number;
}

export interface AcademicFunnelStep {
  label: string;
  value: number;
  pct: number;
}

export interface AcademicKpiPayload {
  generatedAt: string;
  goalAdoption: GoalAdoptionKpis;
  resourcePipeline: ResourcePipelineKpis;
  timeToMilestone: TimeToMilestoneKpis;
  readinessDistribution: ReadinessDistributionKpis;
  academicFunnel: AcademicFunnelStep[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function daysBetween(earlier: Date, later: Date): number {
  return (later.getTime() - earlier.getTime()) / 86_400_000;
}

function pct(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Math.round((numerator / denominator) * 100);
}

function round1(value: number | null): number | null {
  if (value === null) return null;
  return Math.round(value * 10) / 10;
}

const LINK_NO_EVIDENCE_STATUSES = new Set(["assigned", "suggested"]);

// ---------------------------------------------------------------------------
// Main computation
// ---------------------------------------------------------------------------

export function computeAcademicKpis(
  students: KpiStudentRow[],
  now: Date = new Date(),
): AcademicKpiPayload {
  const total = students.length;

  // --- Goal adoption accumulators ---
  let withBhag = 0;
  let withMonthly = 0;
  let withWeekly = 0;
  let totalActiveGoals = 0;
  let goalsWithLinkedResources = 0;

  // --- Resource pipeline accumulators ---
  let totalAssignedLinks = 0;
  let linksWithEvidence = 0;
  let linksCompleted = 0;
  let studentsWithAnyEvidence = 0;

  // --- Time-to-milestone arrays ---
  const daysToFirstGoal: number[] = [];
  const daysGoalToResource: number[] = [];
  const daysResourceToEvidence: number[] = [];

  // --- Readiness scores ---
  const readinessScores: number[] = [];

  // --- Funnel counters ---
  let funnelConversation = 0;
  let funnelBhag = 0;
  let funnelMonthly = 0;
  let funnelAssignedResource = 0;
  let funnelEvidenceSubmitted = 0;
  let funnelCertProgress = 0;
  let funnelReadiness50 = 0;

  for (const student of students) {
    const activeGoals = student.goals.filter((g) => goalCountsTowardPlan(g.status));

    // Goal adoption
    const hasBhag = activeGoals.some((g) => g.level === "bhag");
    const hasMonthly = activeGoals.some((g) => g.level === "monthly");
    const hasWeekly = activeGoals.some((g) => g.level === "weekly");
    if (hasBhag) withBhag++;
    if (hasMonthly) withMonthly++;
    if (hasWeekly) withWeekly++;
    totalActiveGoals += activeGoals.length;

    // Per-goal: linked resources + time-to-milestone
    let studentHasEvidence = false;
    let studentHasAssignedLink = false;

    // Time to first goal
    if (activeGoals.length > 0) {
      const earliestGoal = activeGoals.reduce(
        (min, g) => (g.createdAt < min ? g.createdAt : min),
        activeGoals[0].createdAt,
      );
      const delta = daysBetween(student.createdAt, earliestGoal);
      if (delta >= 0) daysToFirstGoal.push(delta);
    }

    for (const goal of activeGoals) {
      const assignedLinks = goal.resourceLinks.filter((l) => l.linkType === "assigned");
      if (assignedLinks.length > 0) {
        goalsWithLinkedResources++;
      }

      for (const link of assignedLinks) {
        totalAssignedLinks++;
        studentHasAssignedLink = true;

        const hasEv = !LINK_NO_EVIDENCE_STATUSES.has(link.status);
        if (hasEv) {
          linksWithEvidence++;
          studentHasEvidence = true;

          // Time from resource assignment to evidence
          const evidenceDelta = daysBetween(link.createdAt, link.updatedAt);
          if (evidenceDelta >= 0) daysResourceToEvidence.push(evidenceDelta);
        }
        if (link.status === "completed") {
          linksCompleted++;
        }

        // Time from goal creation to resource assignment
        const assignDelta = daysBetween(goal.createdAt, link.createdAt);
        if (assignDelta >= 0) daysGoalToResource.push(assignDelta);
      }
    }

    if (studentHasEvidence) studentsWithAnyEvidence++;

    // Readiness score
    const progState = parseState(student.progressionState);
    const studentBhagCompleted = student.goals.some((g) => g.level === "bhag" && g.status === "completed");
    const readiness = computeReadinessScore({ ...progState, bhagCompleted: studentBhagCompleted, orientationProgress: { completed: 0, total: 0 } });
    readinessScores.push(readiness.score);

    // Funnel
    if (student.conversations.length > 0) funnelConversation++;
    if (hasBhag) funnelBhag++;
    if (hasMonthly) funnelMonthly++;
    if (studentHasAssignedLink) funnelAssignedResource++;
    if (studentHasEvidence) funnelEvidenceSubmitted++;
    if (
      student.certifications.some(
        (c) => c.status === "in_progress" || c.status === "completed",
      )
    ) {
      funnelCertProgress++;
    }
    if (readiness.score >= 50) funnelReadiness50++;
  }

  // --- Readiness distribution ---
  const buckets = [
    { bucket: "0-24", count: 0 },
    { bucket: "25-49", count: 0 },
    { bucket: "50-74", count: 0 },
    { bucket: "75-99", count: 0 },
    { bucket: "100", count: 0 },
  ];
  for (const score of readinessScores) {
    if (score >= 100) buckets[4].count++;
    else if (score >= 75) buckets[3].count++;
    else if (score >= 50) buckets[2].count++;
    else if (score >= 25) buckets[1].count++;
    else buckets[0].count++;
  }

  const studentsAbove50 = readinessScores.filter((s) => s >= 50).length;
  const studentsAbove75 = readinessScores.filter((s) => s >= 75).length;

  return {
    generatedAt: now.toISOString(),
    goalAdoption: {
      totalStudents: total,
      withBhag,
      withBhagPct: pct(withBhag, total),
      withMonthlyGoal: withMonthly,
      withMonthlyGoalPct: pct(withMonthly, total),
      withWeeklyGoal: withWeekly,
      withWeeklyGoalPct: pct(withWeekly, total),
      totalActiveGoals,
      goalsWithLinkedResources,
      goalsWithResourcesPct: pct(goalsWithLinkedResources, totalActiveGoals),
    },
    resourcePipeline: {
      totalAssignedLinks,
      linksWithEvidence,
      linksWithEvidencePct: pct(linksWithEvidence, totalAssignedLinks),
      linksCompleted,
      linksCompletedPct: pct(linksCompleted, totalAssignedLinks),
      studentsWithAnyEvidence,
      studentsWithAnyEvidencePct: pct(studentsWithAnyEvidence, total),
    },
    timeToMilestone: {
      medianDaysToFirstGoal: round1(median(daysToFirstGoal)),
      avgDaysToFirstGoal: round1(average(daysToFirstGoal)),
      medianDaysGoalToResource: round1(median(daysGoalToResource)),
      avgDaysGoalToResource: round1(average(daysGoalToResource)),
      medianDaysResourceToEvidence: round1(median(daysResourceToEvidence)),
      avgDaysResourceToEvidence: round1(average(daysResourceToEvidence)),
    },
    readinessDistribution: {
      distribution: buckets,
      medianScore: round1(median(readinessScores)),
      avgScore: round1(average(readinessScores)),
      studentsAbove50,
      studentsAbove50Pct: pct(studentsAbove50, total),
      studentsAbove75,
      studentsAbove75Pct: pct(studentsAbove75, total),
    },
    academicFunnel: [
      { label: "Enrolled", value: total, pct: 100 },
      { label: "First Sage conversation", value: funnelConversation, pct: pct(funnelConversation, total) },
      { label: "Confirmed BHAG", value: funnelBhag, pct: pct(funnelBhag, total) },
      { label: "Active monthly plan", value: funnelMonthly, pct: pct(funnelMonthly, total) },
      { label: "Assigned resource", value: funnelAssignedResource, pct: pct(funnelAssignedResource, total) },
      { label: "Evidence submitted", value: funnelEvidenceSubmitted, pct: pct(funnelEvidenceSubmitted, total) },
      { label: "Certification progress", value: funnelCertProgress, pct: pct(funnelCertProgress, total) },
      { label: "Readiness \u2265 50", value: funnelReadiness50, pct: pct(funnelReadiness50, total) },
    ],
  };
}
