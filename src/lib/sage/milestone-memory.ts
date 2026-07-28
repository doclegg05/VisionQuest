/**
 * Record a durable SageMemory fact when a program gate completes
 * (cert verified, orientation done, goal confirmed, career plan confirmed).
 */
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { sourceHashFor } from "@/lib/sage/memory/schema";

export type MilestoneKind =
  | "orientation_complete"
  | "cert_verified"
  | "goal_confirmed"
  | "career_plan_confirmed"
  | "curriculum_proposed";

export async function recordMilestoneMemory(params: {
  studentId: string;
  kind: MilestoneKind;
  title: string;
  detail?: string;
  sourceId?: string;
}): Promise<void> {
  const { studentId, kind, title, detail, sourceId } = params;
  const content = [title, detail].filter(Boolean).join(" — ").slice(0, 500);
  if (!content.trim()) return;

  const candidate = {
    subjectType: "student" as const,
    subjectId: studentId,
    kind: "semantic" as const,
    content,
    category: "progress" as const,
    confidence: kind === "career_plan_confirmed" || kind === "goal_confirmed" ? 0.9 : 0.75,
    sourceType: "operation" as const,
    sourceId: sourceId ?? `milestone:${kind}`,
  };

  try {
    const hash = sourceHashFor(candidate);
    const existing = await prisma.sageMemory.findFirst({
      where: {
        subjectType: "student",
        subjectId: studentId,
        sourceHash: hash,
        validTo: null,
      },
      select: { id: true },
    });
    if (existing) return;

    await prisma.sageMemory.create({
      data: {
        subjectType: candidate.subjectType,
        subjectId: candidate.subjectId,
        kind: candidate.kind,
        content: candidate.content,
        category: candidate.category,
        confidence: candidate.confidence,
        sourceType: candidate.sourceType,
        sourceId: candidate.sourceId,
        sourceHash: hash,
      },
    });
  } catch (err) {
    // Soft-fail: milestone memory must never block the gate write path.
    logger.warn("milestone memory write failed", {
      studentId,
      kind,
      error: String(err),
    });
  }
}
