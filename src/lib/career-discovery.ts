import { prisma } from "@/lib/db";
import type { RiasecScores, NationalClusterScore, TransferableSkill, WorkValue } from "@/lib/sage/discovery-extractor";

export interface CareerDiscoveryData {
  id: string;
  status: string;
  hollandCode: string | null;
  riasecScores: RiasecScores | null;
  nationalClusters: NationalClusterScore[] | null;
  transferableSkills: TransferableSkill[] | null;
  workValues: WorkValue[] | null;
  sageSummary: string | null;
  completedAt: Date | null;
}

function parseJsonField<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function getCareerDiscovery(
  studentId: string,
): Promise<CareerDiscoveryData | null> {
  const record = await prisma.careerDiscovery.findUnique({
    where: { studentId },
    select: {
      id: true,
      status: true,
      hollandCode: true,
      riasecScores: true,
      nationalClusters: true,
      transferableSkills: true,
      workValues: true,
      sageSummary: true,
      completedAt: true,
    },
  });

  if (!record) return null;

  return {
    id: record.id,
    status: record.status,
    hollandCode: record.hollandCode,
    riasecScores: parseJsonField<RiasecScores>(record.riasecScores),
    nationalClusters: parseJsonField<NationalClusterScore[]>(record.nationalClusters),
    transferableSkills: parseJsonField<TransferableSkill[]>(record.transferableSkills),
    workValues: parseJsonField<WorkValue[]>(record.workValues),
    sageSummary: record.sageSummary,
    completedAt: record.completedAt,
  };
}
