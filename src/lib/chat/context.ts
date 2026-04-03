import { prisma } from "@/lib/db";
import { cached } from "@/lib/cache";
import { GOAL_PLANNING_STATUSES } from "@/lib/goals";
import {
  buildStudentStatusSignals,
  buildStudentStatusSummary,
} from "@/lib/student-status";
import { analyzeSkillGaps } from "@/lib/sage/skill-gap";
import {
  buildArcContextString,
  getOrCreateCoachingArc,
} from "@/lib/sage/coaching-arcs";
import {
  buildPathwayContextString,
  getLearningPathway,
} from "@/lib/learning-pathway";
import { type ConversationStage } from "@/lib/sage/system-prompts";

const BASE_CONTEXT_TTL_SECONDS = 30;
const SUPPLEMENTAL_CONTEXT_TTL_SECONDS = 120;

const SKILL_GAP_STAGES = new Set<ConversationStage>([
  "bhag",
  "monthly",
  "weekly",
  "daily",
]);

const PATHWAY_STAGES = new Set<ConversationStage>(["daily", "weekly", "tasks"]);

const COACHING_ARC_STAGES = new Set<ConversationStage>([
  "bhag",
  "monthly",
  "weekly",
  "daily",
  "tasks",
  "review",
  "checkin",
  "career_profile_review",
]);

interface CareerDiscoveryContext {
  status: string;
  sageSummary: string | null;
  topClusters: string[];
  hollandCode: string | null;
  riasecScores: string | null;
  nationalClusters: string | null;
  transferableSkills: string | null;
  workValues: string | null;
}

interface PriorSummary {
  summary: string;
  module: string;
  updatedAt: Date;
}

export interface BaseStudentPromptContext {
  goalsByLevel: Record<string, string>;
  goalsSummary: string;
  studentStatusSummary?: string;
  discoverySummary?: string;
  careerDiscovery: CareerDiscoveryContext | null;
  priorConversationContext: string;
}

export interface StudentPromptContext extends BaseStudentPromptContext {
  skillGapContext?: string;
  pathwayContext?: string;
  coachingArcContext?: string;
  careerProfileContext?: string;
}

export function formatPriorConversationContext(priorSummaries: PriorSummary[]): string {
  if (priorSummaries.length === 0) return "";

  const lines = priorSummaries.map((summary) => {
    const date = summary.updatedAt.toISOString().slice(0, 10);
    return `Session from ${date} (${summary.module}): ${summary.summary}`;
  });

  return `[PREVIOUS_CONVERSATIONS_START]\n${lines.join("\n")}\n[PREVIOUS_CONVERSATIONS_END]\n\n`;
}

export function buildCareerProfileContext(
  careerDiscovery: CareerDiscoveryContext | null,
): string | undefined {
  if (!careerDiscovery || careerDiscovery.status !== "complete") {
    return undefined;
  }

  const parts: string[] = [];
  if (careerDiscovery.hollandCode) {
    parts.push(`Holland Code: ${careerDiscovery.hollandCode}`);
  }
  if (careerDiscovery.riasecScores) {
    try {
      const scores = JSON.parse(careerDiscovery.riasecScores) as Record<string, number>;
      const scoreLines = Object.entries(scores)
        .sort(([, left], [, right]) => right - left)
        .map(([key, value]) => `  ${key}: ${Math.round(value * 100)}%`)
        .join("\n");
      parts.push(`RIASEC Scores:\n${scoreLines}`);
    } catch {
      // Ignore malformed JSON.
    }
  }
  if (careerDiscovery.transferableSkills) {
    try {
      const skills = JSON.parse(careerDiscovery.transferableSkills) as Array<{
        skill: string;
        category: string;
        evidence: string;
      }>;
      if (skills.length > 0) {
        parts.push(
          `Transferable Skills:\n${skills
            .map((skill) => `  - ${skill.skill} (${skill.category}): ${skill.evidence}`)
            .join("\n")}`,
        );
      }
    } catch {
      // Ignore malformed JSON.
    }
  }
  if (careerDiscovery.workValues) {
    try {
      const values = JSON.parse(careerDiscovery.workValues) as Array<{
        value: string;
        importance: string;
      }>;
      if (values.length > 0) {
        parts.push(
          `Work Values:\n${values
            .slice(0, 5)
            .map((value) => `  - ${value.value} (${value.importance})`)
            .join("\n")}`,
        );
      }
    } catch {
      // Ignore malformed JSON.
    }
  }
  if (careerDiscovery.nationalClusters) {
    try {
      const clusters = JSON.parse(careerDiscovery.nationalClusters) as Array<{
        cluster_name: string;
        score: number;
      }>;
      if (clusters.length > 0) {
        const topClusters = clusters
          .slice()
          .sort((left, right) => right.score - left.score)
          .slice(0, 3);
        parts.push(
          `Top Career Clusters:\n${topClusters
            .map((cluster) => `  - ${cluster.cluster_name} (${Math.round(cluster.score * 100)}% match)`)
            .join("\n")}`,
        );
      }
    } catch {
      // Ignore malformed JSON.
    }
  }
  if (careerDiscovery.sageSummary) {
    parts.push(`Assessment Summary: ${careerDiscovery.sageSummary}`);
  }

  return parts.length > 0 ? parts.join("\n\n") : undefined;
}

export function shouldLoadSkillGapContext(
  stage: ConversationStage,
  discoveryStatus?: string,
): boolean {
  return SKILL_GAP_STAGES.has(stage) && discoveryStatus === "complete";
}

export function shouldLoadPathwayContext(stage: ConversationStage): boolean {
  return PATHWAY_STAGES.has(stage);
}

export function shouldLoadCoachingArcContext(stage: ConversationStage): boolean {
  return COACHING_ARC_STAGES.has(stage);
}

export async function getBaseStudentPromptContext(
  studentId: string,
  conversationId: string,
  stage: ConversationStage,
): Promise<BaseStudentPromptContext> {
  return cached(
    `chat:base-context:${studentId}:${conversationId}:${stage}`,
    BASE_CONTEXT_TTL_SECONDS,
    async () => {
      const [
        goals,
        orientationItems,
        formSubmissions,
        orientationProgress,
        careerDiscovery,
        priorSummaries,
      ] = await Promise.all([
        prisma.goal.findMany({
          where: { studentId, status: { in: [...GOAL_PLANNING_STATUSES] } },
        }),
        prisma.orientationItem.findMany({
          select: {
            id: true,
            label: true,
            required: true,
          },
          orderBy: { sortOrder: "asc" },
        }),
        prisma.formSubmission.findMany({
          where: { studentId },
          select: {
            formId: true,
            status: true,
            updatedAt: true,
            reviewedAt: true,
            notes: true,
          },
        }),
        prisma.orientationProgress.findMany({
          where: { studentId },
          select: {
            itemId: true,
            completed: true,
            completedAt: true,
          },
        }),
        prisma.careerDiscovery.findUnique({
          where: { studentId },
          select: {
            status: true,
            sageSummary: true,
            topClusters: true,
            hollandCode: true,
            riasecScores: true,
            nationalClusters: true,
            transferableSkills: true,
            workValues: true,
          },
        }),
        prisma.conversation.findMany({
          where: {
            studentId,
            id: { not: conversationId },
            summary: { not: null },
          },
          orderBy: { updatedAt: "desc" },
          take: 3,
          select: { summary: true, module: true, updatedAt: true },
        }),
      ]);

      const goalsByLevel: Record<string, string> = {};
      for (const goal of goals) {
        goalsByLevel[goal.level] = goal.content;
      }

      const studentStatusSummary = buildStudentStatusSummary(
        buildStudentStatusSignals({
          formSubmissions,
          orientationItems,
          orientationProgress,
        }),
        {
          includePositiveSummary:
            stage === "orientation" || stage === "onboarding",
        },
      );

      const discoverySummary =
        careerDiscovery?.sageSummary && careerDiscovery.topClusters.length > 0
          ? `${careerDiscovery.sageSummary} (Top pathways: ${careerDiscovery.topClusters.join(", ")})`
          : undefined;

      return {
        goalsByLevel,
        goalsSummary:
          goals.length > 0
            ? goals.map((goal) => `- ${goal.level.toUpperCase()}: ${goal.content}`).join("\n")
            : "No planning goals set yet.",
        studentStatusSummary: studentStatusSummary || undefined,
        discoverySummary,
        careerDiscovery,
        priorConversationContext: formatPriorConversationContext(
          priorSummaries.map((summary) => ({
            summary: summary.summary ?? "",
            module: summary.module,
            updatedAt: summary.updatedAt,
          })),
        ),
      };
    },
  );
}

export async function getStudentPromptContext(
  studentId: string,
  conversationId: string,
  stage: ConversationStage,
): Promise<StudentPromptContext> {
  const baseContext = await getBaseStudentPromptContext(
    studentId,
    conversationId,
    stage,
  );

  const [skillGapContext, pathwayContext, coachingArcContext] =
    await Promise.all([
      shouldLoadSkillGapContext(stage, baseContext.careerDiscovery?.status)
        ? cached(
            `chat:skill-gap:${studentId}`,
            SUPPLEMENTAL_CONTEXT_TTL_SECONDS,
            async () => {
              const gapAnalysis = await analyzeSkillGaps(studentId);
              if (!gapAnalysis) return undefined;

              const haveList = gapAnalysis.skills
                .filter((skill) => skill.status === "have")
                .map((skill) => skill.name)
                .join(", ");
              const buildingList = gapAnalysis.skills
                .filter((skill) => skill.status === "building")
                .map(
                  (skill) =>
                    `${skill.name} (via ${skill.buildingVia ?? "certification"})`,
                )
                .join(", ");
              const needList = gapAnalysis.skills
                .filter(
                  (skill) =>
                    skill.status === "need" && skill.importance === "essential",
                )
                .map((skill) => skill.name)
                .join(", ");

              return [
                `SKILL GAP ANALYSIS for ${gapAnalysis.targetClusterName}:`,
                haveList ? `The student HAS these skills: ${haveList}.` : "",
                buildingList ? `They are BUILDING: ${buildingList}.` : "",
                needList
                  ? `They NEED (essential gaps): ${needList}. When setting goals, prioritize closing these essential skill gaps.`
                  : "No essential skill gaps — focus on reinforcing and applying existing skills.",
              ]
                .filter(Boolean)
                .join(" ");
            },
          )
        : Promise.resolve(undefined),
      shouldLoadPathwayContext(stage)
        ? cached(
            `chat:pathway:${studentId}`,
            SUPPLEMENTAL_CONTEXT_TTL_SECONDS,
            async () => {
              const pathway = await getLearningPathway(studentId);
              return pathway ? buildPathwayContextString(pathway) : undefined;
            },
          )
        : Promise.resolve(undefined),
      shouldLoadCoachingArcContext(stage)
        ? getOrCreateCoachingArc(studentId)
            .then((arc) =>
              arc.status === "active" ? buildArcContextString(arc) : undefined,
            )
            .catch(() => undefined)
        : Promise.resolve(undefined),
    ]);

  return {
    ...baseContext,
    skillGapContext,
    pathwayContext,
    coachingArcContext,
    careerProfileContext:
      stage === "career_profile_review"
        ? buildCareerProfileContext(baseContext.careerDiscovery)
        : undefined,
  };
}
