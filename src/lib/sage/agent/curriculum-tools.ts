/**
 * Curriculum builder + WIOA referral flag tools for Sage's career guide scaffold.
 */
import { prisma } from "@/lib/db";
import { proposeGoal } from "@/lib/sage/propose-goal";
import { recordMilestoneMemory } from "@/lib/sage/milestone-memory";
import type { AgentTool, AgentToolResult } from "./types";

const TERMINAL_LABELS: Record<string, string> = {
  employment: "earn a job in my target field",
  post_secondary: "transfer to post-secondary education",
  both: "earn a job and prepare for post-secondary education",
};

export const proposeCurriculum: AgentTool = {
  name: "propose_curriculum",
  description:
    "Given a confirmed Career & Education Plan, propose a BHAG + monthly certification/LMS milestone goal tree for instructor confirmation. Use only after the plan status is confirmed. Does not finalize goals.",
  parameters: {
    type: "object",
    properties: {
      note: {
        type: "string",
        description: "Optional instructor/student note about focus (e.g. start with IC3).",
      },
    },
    required: [],
  },
  requiredRoles: ["student", "teacher"],
  riskTier: "mutate_reversible",
  enabled: true,
  async execute(args, ctx): Promise<AgentToolResult> {
    const studentId =
      ctx.session.role === "student"
        ? ctx.session.id
        : typeof ctx.targetStudentId === "string"
          ? ctx.targetStudentId
          : "";
    if (!studentId) {
      return {
        status: "error",
        summary: "Pick a student first (Ask Sage from their record) before proposing a curriculum.",
      };
    }

    const plan = await prisma.careerEducationPlan.findUnique({
      where: { studentId },
    });
    if (!plan || plan.status !== "confirmed") {
      return {
        status: "error",
        summary:
          "The Career & Education Plan must be confirmed by an instructor before I can propose a curriculum.",
      };
    }

    const note = typeof args.note === "string" ? args.note.trim() : "";
    const clusterHint = plan.targetClusters[0] ?? "their chosen pathway";
    const outcome =
      TERMINAL_LABELS[plan.terminalOutcome ?? ""] ?? "reach their career or education goal";

    // Prefer an active Pathway matching a target cluster label when available.
    const pathways = await prisma.pathway.findMany({
      where: { active: true },
      select: { id: true, label: true, certifications: true, platforms: true, estimatedWeeks: true },
      take: 50,
    });
    const matched = pathways.find((p) =>
      plan.targetClusters.some((c) =>
        p.label.toLowerCase().includes(c.toLowerCase()) ||
        c.toLowerCase().includes(p.label.toLowerCase()),
      ),
    );

    const certTemplates = await prisma.certTemplate.findMany({
      where: { certType: "ready-to-work" },
      orderBy: { sortOrder: "asc" },
      take: 6,
      select: { id: true, label: true },
    });

    const certLabels =
      matched?.certifications?.length
        ? matched.certifications.slice(0, 4)
        : certTemplates.map((c) => c.label).slice(0, 4);

    const sourceMessageId = `curriculum:${ctx.conversationId}:${Date.now()}`;
    const bhagContent = `I will ${outcome} through SPOKES coursework and certifications in ${clusterHint}${
      note ? ` — ${note}` : ""
    }.`;

    const bhag = await proposeGoal({
      studentId,
      level: "bhag",
      content: bhagContent.slice(0, 1000),
      sourceMessageId: `${sourceMessageId}:bhag`,
      conversationId: ctx.conversationId,
      invokedBy: ctx.session.id,
      confidence: 0.8,
    });

    if (bhag.status === "rejected") {
      return { status: "error", summary: `Could not propose BHAG: ${bhag.reason}` };
    }

    const proposedMonthly: string[] = [];
    for (let i = 0; i < Math.min(certLabels.length, 3); i++) {
      const label = certLabels[i];
      const monthly = await proposeGoal({
        studentId,
        level: "monthly",
        content: `Complete progress toward ${label} (LMS practice + portfolio evidence).`,
        sourceMessageId: `${sourceMessageId}:monthly:${i}`,
        conversationId: ctx.conversationId,
        parentId: bhag.goalId,
        invokedBy: ctx.session.id,
        confidence: 0.75,
      });
      if (monthly.status !== "rejected") {
        proposedMonthly.push(label);
      }
    }

    if (matched) {
      await prisma.careerEducationPlan.update({
        where: { id: plan.id },
        data: { pathwayId: matched.id },
      });
    }

    await recordMilestoneMemory({
      studentId,
      kind: "curriculum_proposed",
      title: "Curriculum milestones proposed from Career & Education Plan",
      detail: `BHAG + ${proposedMonthly.length} monthly cert/LMS goals awaiting confirmation.`,
      sourceId: bhag.goalId,
    });

    return {
      status: "success",
      summary: `Proposed a BHAG and ${proposedMonthly.length} monthly milestone(s) for instructor confirmation.`,
      data: {
        bhagGoalId: bhag.goalId,
        monthlyLabels: proposedMonthly,
        pathwayId: matched?.id ?? null,
        pathwayLabel: matched?.label ?? null,
      },
      modelHint:
        "Tell the student their curriculum milestones are drafted and an instructor will confirm them before they become official. " +
        "Name the next concrete LMS/cert step in plain language. Do not claim goals are already active.",
    };
  },
};

export const flagWioaReferral: AgentTool = {
  name: "flag_wioa_referral",
  description:
    "When a student needs training, funding, or services SPOKES cannot provide with LMS/certifications/portfolio alone, flag the assigned instructor for a WIOA referral. Does not file the referral itself.",
  parameters: {
    type: "object",
    properties: {
      reason: {
        type: "string",
        description: "Why SPOKES resources are not enough (plain language).",
      },
    },
    required: ["reason"],
  },
  requiredRoles: ["student", "teacher"],
  riskTier: "mutate_reversible",
  enabled: true,
  async execute(args, ctx): Promise<AgentToolResult> {
    const reason = typeof args.reason === "string" ? args.reason.trim() : "";
    if (!reason) return { status: "error", summary: "A reason is required to flag a WIOA referral." };

    const studentId =
      ctx.session.role === "student"
        ? ctx.session.id
        : typeof ctx.targetStudentId === "string"
          ? ctx.targetStudentId
          : "";
    if (!studentId) {
      return {
        status: "error",
        summary: "Pick a student first before flagging a WIOA referral.",
      };
    }

    const alertKey = `wioa-referral:${studentId}:${ctx.conversationId ?? "manual"}`;
    await prisma.studentAlert.upsert({
      where: { alertKey },
      create: {
        studentId,
        alertKey,
        type: "wioa_referral_needed",
        severity: "medium",
        title: "WIOA referral may be needed",
        summary: reason.slice(0, 2000),
        sourceType: "sage_wioa_flag",
        sourceId: ctx.conversationId ?? null,
      },
      update: {
        status: "open",
        summary: reason.slice(0, 2000),
        resolvedAt: null,
        dismissedAt: null,
      },
    });

    return {
      status: "success",
      summary: "Flagged the instructor that a WIOA referral may be needed.",
      modelHint:
        "Tell the student you notified their instructor about a possible WIOA referral. " +
        "Do not claim the referral was filed. Offer to keep working on what SPOKES can provide (LMS, certs, portfolio, job prep).",
    };
  },
};

export const CURRICULUM_TOOLS: AgentTool[] = [proposeCurriculum, flagWioaReferral];
