/**
 * RTW Next Steps Engine
 *
 * Computes prioritized next actions for a student's Ready to Work journey.
 * Pure function — takes data, returns actions. No DB calls.
 */

export interface RtwRequirement {
  templateId: string;
  label: string;
  required: boolean;
  needsFile: boolean;
  needsVerify: boolean;
  completed: boolean;
  verifiedBy: string | null;
  fileId: string | null;
  sortOrder: number;
  url: string | null;
}

export interface RtwNextStep {
  templateId: string;
  label: string;
  action: "complete" | "upload_file" | "waiting_verification" | "start_orientation" | "build_resume" | "visit_platform";
  description: string;
  href: string;
  priority: number;
  clusterMatch: boolean;
}

interface NextStepsInput {
  requirements: RtwRequirement[];
  orientationComplete: boolean;
  resumeCreated: boolean;
  platformsVisited: number;
  hasGoals: boolean;
  topClusterCertIds?: string[];
}

/**
 * Compute up to `count` prioritized next actions toward RTW.
 *
 * Priority logic:
 * 1. Things the student can act on right now (complete, upload file)
 * 2. Pre-requisite areas (orientation, goals, portfolio)
 * 3. Things waiting on others (teacher verification)
 *
 * Cluster-matched items get a priority boost.
 */
export function computeNextRtwSteps(
  input: NextStepsInput,
  count = 3,
): RtwNextStep[] {
  const steps: RtwNextStep[] = [];
  const clusterCertSet = new Set(input.topClusterCertIds || []);

  // Orientation is a gating prerequisite
  if (!input.orientationComplete) {
    steps.push({
      templateId: "__orientation",
      label: "Complete orientation",
      action: "start_orientation",
      description: "Finish onboarding forms and orientation checklist.",
      href: "/orientation",
      priority: 1,
      clusterMatch: false,
    });
  }

  // Goals are foundational
  if (!input.hasGoals) {
    steps.push({
      templateId: "__goals",
      label: "Set your first goal",
      action: "complete",
      description: "Talk to Sage to define your big dream and start planning.",
      href: "/chat",
      priority: 2,
      clusterMatch: false,
    });
  }

  // Process cert requirements
  for (const req of input.requirements) {
    if (!req.required) continue;

    const isClusterMatch = clusterCertSet.size > 0 && clusterCertSet.has(req.templateId);
    const clusterBoost = isClusterMatch ? -0.5 : 0;

    if (!req.completed) {
      if (req.needsFile && !req.fileId) {
        // Needs file upload before it can be completed
        steps.push({
          templateId: req.templateId,
          label: req.label,
          action: "upload_file",
          description: "Upload the required file, then mark this complete.",
          href: "/certifications",
          priority: 4 + clusterBoost,
          clusterMatch: isClusterMatch,
        });
      } else {
        // Can be completed right now
        steps.push({
          templateId: req.templateId,
          label: req.label,
          action: "complete",
          description: req.url ? "Complete this lesson, then check it off." : "Mark this requirement when you've finished it.",
          href: "/certifications",
          priority: 3 + clusterBoost,
          clusterMatch: isClusterMatch,
        });
      }
    } else if (req.needsVerify && !req.verifiedBy) {
      // Completed but waiting on teacher verification
      steps.push({
        templateId: req.templateId,
        label: req.label,
        action: "waiting_verification",
        description: "Done! Waiting for your instructor to verify.",
        href: "/certifications",
        priority: 8 + clusterBoost,
        clusterMatch: isClusterMatch,
      });
    }
  }

  // Resume / portfolio
  if (!input.resumeCreated) {
    steps.push({
      templateId: "__resume",
      label: "Build your resume",
      action: "build_resume",
      description: "Start your employment portfolio with a resume.",
      href: "/portfolio",
      priority: 5,
      clusterMatch: false,
    });
  }

  // Platform exploration
  if (input.platformsVisited === 0) {
    steps.push({
      templateId: "__platforms",
      label: "Visit a learning platform",
      action: "visit_platform",
      description: "Explore the training platforms available to you.",
      href: "/courses",
      priority: 6,
      clusterMatch: false,
    });
  }

  steps.sort((a, b) => a.priority - b.priority);
  return steps.slice(0, count);
}

/**
 * Build a short text summary of RTW progress for Sage's system prompt.
 */
export function buildRtwProgressSummary(
  requirements: RtwRequirement[],
  orientationComplete: boolean,
): string {
  const required = requirements.filter((r) => r.required);
  const done = required.filter((r) => r.completed);
  const verified = required.filter((r) => r.completed && (!r.needsVerify || r.verifiedBy));
  const pendingVerify = required.filter((r) => r.completed && r.needsVerify && !r.verifiedBy);
  const incomplete = required.filter((r) => !r.completed);

  const lines: string[] = [];
  lines.push(`RTW Progress: ${done.length}/${required.length} requirements completed (${verified.length} fully verified).`);

  if (!orientationComplete) {
    lines.push("Orientation is not yet complete — this is a prerequisite.");
  }

  if (pendingVerify.length > 0) {
    lines.push(`Awaiting teacher verification: ${pendingVerify.map((r) => r.label).join(", ")}.`);
  }

  if (incomplete.length > 0) {
    const nextUp = incomplete.sort((a, b) => a.sortOrder - b.sortOrder);
    lines.push(`Next up: ${nextUp.slice(0, 3).map((r) => r.label).join(", ")}.`);
  }

  if (done.length === required.length && verified.length === required.length) {
    lines.push("ALL REQUIREMENTS COMPLETE AND VERIFIED. Student is Ready to Work!");
  }

  return lines.join("\n");
}
