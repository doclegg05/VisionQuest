/**
 * Thin persistence caller for the Campaign Orchestrator planner
 * (advanceCampaign() in ./campaign-orchestrator). All I/O for the planner is
 * confined to this module so advanceCampaign() itself stays pure and
 * unit-testable without a database. Writes the CampaignStep audit row and
 * advances CareerCampaign.currentStage in one transaction so the two can
 * never drift out of sync with each other.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { AdvanceCampaignResult } from "./campaign-orchestrator";

export interface RecordCampaignStepResult {
  stepId: string;
}

export async function recordCampaignStep(
  campaignId: string,
  advance: AdvanceCampaignResult,
): Promise<RecordCampaignStepResult> {
  const [step] = await prisma.$transaction([
    prisma.campaignStep.create({
      data: {
        campaignId,
        stage: advance.stepToLog.stage,
        proposedActions: advance.stepToLog.proposedActions as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    }),
    prisma.careerCampaign.update({
      where: { id: campaignId },
      data: { currentStage: advance.nextStage },
    }),
  ]);

  return { stepId: step.id };
}
