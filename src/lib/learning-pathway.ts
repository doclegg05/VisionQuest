// =============================================================================
// Learning Pathway
// Derives a student's ordered learning roadmap from their career discovery
// and combines static cert metadata with dynamic Certification DB records.
// =============================================================================

import { prisma } from "./db";
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

// Average hours per week a SPOKES student is expected to work on certs
const HOURS_PER_WEEK = 5;

export async function getLearningPathway(
  studentId: string,
): Promise<LearningPathway | null> {
  const careerDiscovery = await prisma.careerDiscovery.findUnique({
    where: { studentId },
    select: { status: true, topClusters: true },
  });

  if (!careerDiscovery || careerDiscovery.status !== "complete") {
    return null;
  }

  const topClusterId = careerDiscovery.topClusters[0];
  if (!topClusterId) return null;

  const cluster = getClusterById(topClusterId);
  if (!cluster) return null;

  if (!cluster.pathwayOrder || cluster.pathwayOrder.length === 0) return null;

  // Fetch all Certification records for this student (certType matches SPOKES cert IDs)
  const dbCertRecords = await prisma.certification.findMany({
    where: { studentId },
    select: { certType: true, status: true },
  });

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
      prerequisites = certMeta.prerequisites;
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
    clusterId: cluster.id,
    clusterName: cluster.label,
    steps: finalSteps,
    completedCount,
    totalCount,
    estimatedWeeksRemaining,
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
