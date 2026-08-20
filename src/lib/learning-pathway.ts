// =============================================================================
// Learning Pathway
// Derives a student's ordered learning roadmap from their career discovery
// and combines static cert metadata with dynamic Certification DB records.
// =============================================================================

import { prisma } from "./db";
import { loadPrerequisiteMap } from "./progression-edges";
import { CAREER_CLUSTERS, getClusterById } from "./spokes/career-clusters";
import { CERTIFICATIONS } from "./spokes/certifications";
import { PLATFORMS } from "./spokes/platforms";

export interface PathwayStep {
  id: string;
  type: "certification" | "platform";
  name: string;
  description: string;
  estimatedHours: number;
  status: "complete" | "in_progress" | "not_started" | "locked";
  prerequisites: string[];
  isCurrent: boolean;
}

export interface LearningPathway {
  clusterId: string;
  clusterName: string;
  steps: PathwayStep[];
  completedCount: number;
  totalCount: number;
  estimatedWeeksRemaining: number;
}

/**
 * Discriminated result of loading a student's learning pathway. Distinguishes
 * two states that used to both collapse to `null`:
 *
 * - "not_started": career discovery itself is not complete.
 * - "awaiting_cluster": discovery IS complete, but there is no usable
 *   pathway to build yet — either the Sage extractor (or a teacher's
 *   discovery-override PATCH, src/app/api/teacher/students/[id]/discovery)
 *   never recorded a top cluster, or the recorded cluster id doesn't match a
 *   configured SPOKES cluster or has no pathway steps configured.
 *
 * Collapsing these two into one falsy value was the discovery-override
 * circular dead end: a student whose discovery the system already marked
 * complete was shown "Complete your career discovery" — telling them to redo
 * a step that was already done, with no way out.
 */
export type LearningPathwayResult =
  | { status: "ready"; pathway: LearningPathway }
  | { status: "awaiting_cluster" }
  | { status: "not_started" };

// Average hours per week a SPOKES student is expected to work on certs
const HOURS_PER_WEEK = 5;

export async function getLearningPathway(
  studentId: string,
): Promise<LearningPathwayResult> {
  const careerDiscovery = await prisma.careerDiscovery.findUnique({
    where: { studentId },
    select: { status: true, topClusters: true },
  });

  if (!careerDiscovery || careerDiscovery.status !== "complete") {
    return { status: "not_started" };
  }

  const topClusterId = careerDiscovery.topClusters[0];
  if (!topClusterId) return { status: "awaiting_cluster" };

  const cluster = getClusterById(topClusterId);
  if (!cluster) return { status: "awaiting_cluster" };

  if (!cluster.pathwayOrder || cluster.pathwayOrder.length === 0) {
    return { status: "awaiting_cluster" };
  }

  // Fetch all Certification records for this student (certType matches SPOKES cert IDs)
  const dbCertRecords = await prisma.certification.findMany({
    where: { studentId },
    select: { certType: true, status: true },
  });

  // Prerequisite structure now lives in ProgressionEdge rows (issue #140);
  // an empty table falls back to the static arrays inside the loader.
  const prereqMap = await loadPrerequisiteMap();

  const certStatusMap = new Map<string, "complete" | "in_progress">();
  for (const record of dbCertRecords) {
    const status = record.status === "completed" ? "complete" : "in_progress";
    certStatusMap.set(record.certType, status);
  }

  // Build steps from the pathway order
  const steps: PathwayStep[] = [];
  const completedIds = new Set<string>();

  for (const stepId of cluster.pathwayOrder) {
    const certMeta = CERTIFICATIONS.find((c) => c.id === stepId);
    const platformMeta = PLATFORMS.find((p) => p.id === stepId);

    let name = stepId;
    let description = "";
    let estimatedHours = 10;
    let prerequisites: string[] = [];
    let type: "certification" | "platform" = "certification";

    if (certMeta) {
      name = certMeta.shortName;
      description = certMeta.description;
      estimatedHours = certMeta.estimatedHours;
      prerequisites = prereqMap.get(stepId) ?? [];
      type = "certification";
    } else if (platformMeta) {
      name = platformMeta.name;
      description = platformMeta.description;
      estimatedHours = 5;
      prerequisites = [];
      type = "platform";
    }

    const dbStatus = certStatusMap.get(stepId);

    // Determine if all prerequisites are complete
    const prereqsMet = prerequisites.every((prereqId) => completedIds.has(prereqId));

    let status: PathwayStep["status"];
    if (dbStatus === "complete") {
      status = "complete";
      completedIds.add(stepId);
    } else if (!prereqsMet) {
      status = "locked";
    } else if (dbStatus === "in_progress") {
      status = "in_progress";
    } else {
      status = "not_started";
    }

    steps.push({
      id: stepId,
      type,
      name,
      description,
      estimatedHours,
      status,
      prerequisites,
      isCurrent: false,
    });
  }

  // Identify the first unlocked, non-complete step index
  const currentIdx = steps.findIndex(
    (s) => s.status !== "complete" && s.status !== "locked",
  );

  // Build final immutable steps array with isCurrent set
  const finalSteps: PathwayStep[] = steps.map((step, idx) => ({
    ...step,
    isCurrent: idx === currentIdx,
  }));

  const completedCount = finalSteps.filter((s) => s.status === "complete").length;
  const totalCount = steps.length;

  const remainingHours = finalSteps
    .filter((s) => s.status !== "complete")
    .reduce((sum, s) => sum + s.estimatedHours, 0);

  const estimatedWeeksRemaining = Math.ceil(remainingHours / HOURS_PER_WEEK);

  return {
    status: "ready",
    pathway: {
      clusterId: cluster.id,
      clusterName: cluster.label,
      steps: finalSteps,
      completedCount,
      totalCount,
      estimatedWeeksRemaining,
    },
  };
}

export function buildPathwayContextString(pathway: LearningPathway): string {
  const currentIdx = pathway.steps.findIndex((s) => s.isCurrent);
  const currentStep = currentIdx >= 0 ? pathway.steps[currentIdx] : undefined;
  const stepNumber = currentIdx >= 0 ? currentIdx + 1 : pathway.completedCount + 1;

  return [
    `The student is on step ${stepNumber} of ${pathway.totalCount} in their ${pathway.clusterName} pathway.`,
    currentStep
      ? `Their current step is ${currentStep.name} (${currentStep.estimatedHours} hours).`
      : "They have completed all steps in their pathway.",
    `They have completed ${pathway.completedCount} steps so far.`,
  ].join(" ");
}

// Derive the top SPOKES cluster ID from a student's career discovery without
// hitting the DB — used by functions that already have topClusters available.
export function getTopCluster(topClusters: string[]) {
  const id = topClusters[0];
  if (!id) return null;
  return CAREER_CLUSTERS.find((c) => c.id === id) ?? null;
}
