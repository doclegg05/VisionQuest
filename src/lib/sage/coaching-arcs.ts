/**
 * Structured Coaching Arcs — multi-week Sage programs.
 *
 * Provides arc templates, state management, milestone tracking,
 * and context-string generation for Sage system prompt injection.
 */

import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ArcMilestone {
  week: number;
  label: string;
  description: string;
  focus: string;
  targetStages: string[];
  completionSignals: string[];
}

export interface ArcTemplate {
  id: string;
  name: string;
  description: string;
  durationWeeks: number;
  milestones: ArcMilestone[];
}

export interface CoachingArcState {
  id: string;
  studentId: string;
  arcType: string;
  weekNumber: number;
  status: string;
  startedAt: Date;
  milestones: MilestoneRecord[];
  currentMilestone: ArcMilestone;
  template: ArcTemplate;
}

export interface MilestoneRecord {
  week: number;
  completedAt?: string;
  signals: string[];
}

// ─── Template ────────────────────────────────────────────────────────────────

export const STANDARD_6WEEK_ARC: ArcTemplate = {
  id: "standard_6week",
  name: "Standard 6-Week Program",
  description: "A structured 6-week coaching journey from career discovery through launch readiness.",
  durationWeeks: 6,
  milestones: [
    {
      week: 1,
      label: "Discovery & Orientation",
      description: "Explore career interests and get oriented to the program.",
      focus: "Career assessment and program onboarding",
      targetStages: ["discovery", "orientation"],
      completionSignals: [
        "CareerDiscovery complete",
        "50%+ orientation items done",
      ],
    },
    {
      week: 2,
      label: "Dream Big",
      description: "Form a Big Hairy Audacious Goal and break it into monthly goals.",
      focus: "BHAG formation and monthly goal breakdown",
      targetStages: ["onboarding", "bhag", "monthly"],
      completionSignals: ["BHAG set", "monthly goals set"],
    },
    {
      week: 3,
      label: "Build Momentum",
      description: "Set weekly goals and start on the first certification.",
      focus: "Weekly goals and first certification",
      targetStages: ["weekly", "daily", "tasks"],
      completionSignals: ["Weekly goals set", "1+ certification started"],
    },
    {
      week: 4,
      label: "Review & Adjust",
      description: "Review progress and navigate obstacles.",
      focus: "Progress review and obstacle navigation",
      targetStages: ["checkin", "review"],
      completionSignals: ["Weekly review completed", "goals adjusted"],
    },
    {
      week: 5,
      label: "Career Prep",
      description: "Build resume, portfolio, and develop skills.",
      focus: "Resume building, portfolio, and skill development",
      targetStages: ["daily", "tasks"],
      completionSignals: ["Resume created", "1+ portfolio item added"],
    },
    {
      week: 6,
      label: "Launch Ready",
      description: "Prepare for job search and finish certifications.",
      focus: "Job search prep, final certifications, and celebration",
      targetStages: ["checkin", "review"],
      completionSignals: ["1+ certification earned", "readiness score 75+"],
    },
  ],
};

const ARC_TEMPLATES: Record<string, ArcTemplate> = {
  standard_6week: STANDARD_6WEEK_ARC,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getMilestoneForWeek(template: ArcTemplate, weekNumber: number): ArcMilestone {
  const clamped = Math.max(1, Math.min(weekNumber, template.durationWeeks));
  return template.milestones[clamped - 1];
}

function parseDbMilestones(raw: unknown): MilestoneRecord[] {
  if (!Array.isArray(raw)) return [];
  return raw as MilestoneRecord[];
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Get or create the student's coaching arc.
 * Creates a standard_6week arc if none exists.
 */
export async function getOrCreateCoachingArc(studentId: string): Promise<CoachingArcState> {
  const existing = await prisma.coachingArc.findUnique({
    where: { studentId_arcType: { studentId, arcType: "standard_6week" } },
  });

  if (existing && existing.status !== "completed") {
    const template = ARC_TEMPLATES[existing.arcType] ?? STANDARD_6WEEK_ARC;
    const milestones = parseDbMilestones(existing.milestones);
    return {
      id: existing.id,
      studentId: existing.studentId,
      arcType: existing.arcType,
      weekNumber: existing.weekNumber,
      status: existing.status,
      startedAt: existing.startedAt,
      milestones,
      currentMilestone: getMilestoneForWeek(template, existing.weekNumber),
      template,
    };
  }

  // Create fresh arc
  const emptyMilestones: Prisma.InputJsonValue = [];
  const created = await prisma.coachingArc.upsert({
    where: { studentId_arcType: { studentId, arcType: "standard_6week" } },
    create: {
      studentId,
      arcType: "standard_6week",
      weekNumber: 1,
      milestones: emptyMilestones,
      status: "active",
    },
    update: {
      weekNumber: 1,
      milestones: emptyMilestones,
      status: "active",
      startedAt: new Date(),
    },
  });

  return {
    id: created.id,
    studentId: created.studentId,
    arcType: created.arcType,
    weekNumber: 1,
    status: "active",
    startedAt: created.startedAt,
    milestones: [],
    currentMilestone: STANDARD_6WEEK_ARC.milestones[0],
    template: STANDARD_6WEEK_ARC,
  };
}

/**
 * Advance the arc to the next week.
 * Caps at durationWeeks; sets status to "completed" when the final week passes.
 */
export async function advanceArcWeek(studentId: string): Promise<void> {
  const arc = await prisma.coachingArc.findUnique({
    where: { studentId_arcType: { studentId, arcType: "standard_6week" } },
  });

  if (!arc || arc.status !== "active") return;

  const template = ARC_TEMPLATES[arc.arcType] ?? STANDARD_6WEEK_ARC;
  const nextWeek = arc.weekNumber + 1;
  const milestones = parseDbMilestones(arc.milestones);

  // Mark current week as completed in the milestones log
  const updatedMilestones: MilestoneRecord[] = [
    ...milestones.filter((m) => m.week !== arc.weekNumber),
    {
      week: arc.weekNumber,
      completedAt: new Date().toISOString(),
      signals: getMilestoneForWeek(template, arc.weekNumber).completionSignals,
    },
  ];

  const milestonesJson = updatedMilestones as unknown as Prisma.InputJsonValue;

  if (nextWeek > template.durationWeeks) {
    await prisma.coachingArc.update({
      where: { id: arc.id },
      data: {
        weekNumber: template.durationWeeks,
        status: "completed",
        milestones: milestonesJson,
      },
    });
  } else {
    await prisma.coachingArc.update({
      where: { id: arc.id },
      data: {
        weekNumber: nextWeek,
        milestones: milestonesJson,
      },
    });
  }
}

/**
 * Check if the current week's milestones are met by querying real student data.
 */
export async function checkArcMilestones(
  studentId: string,
): Promise<{ complete: boolean; progress: string[] }> {
  const arc = await prisma.coachingArc.findUnique({
    where: { studentId_arcType: { studentId, arcType: "standard_6week" } },
  });

  if (!arc) return { complete: false, progress: [] };

  const week = arc.weekNumber;
  const progress: string[] = [];

  if (week === 1) {
    const [discovery, orientationDone, orientationTotal] = await Promise.all([
      prisma.careerDiscovery.findUnique({
        where: { studentId },
        select: { status: true },
      }),
      prisma.orientationProgress.count({ where: { studentId, completed: true } }),
      prisma.orientationItem.count(),
    ]);

    if (discovery?.status === "complete") progress.push("CareerDiscovery complete");
    const orientationPct = orientationTotal > 0 ? (orientationDone / orientationTotal) * 100 : 0;
    if (orientationPct >= 50) progress.push("50%+ orientation done");
    return { complete: progress.length >= 2, progress };
  }

  if (week === 2) {
    const goals = await prisma.goal.findMany({
      where: { studentId, status: { in: ["active", "in_progress"] } },
      select: { level: true },
    });
    const levels = new Set(goals.map((g) => g.level));
    if (levels.has("bhag")) progress.push("BHAG set");
    if (levels.has("monthly")) progress.push("monthly goals set");
    return { complete: progress.length >= 2, progress };
  }

  if (week === 3) {
    const [goals, certs] = await Promise.all([
      prisma.goal.findMany({
        where: { studentId, status: { in: ["active", "in_progress"] } },
        select: { level: true },
      }),
      prisma.certification.count({ where: { studentId } }),
    ]);
    const levels = new Set(goals.map((g) => g.level));
    if (levels.has("weekly")) progress.push("Weekly goals set");
    if (certs >= 1) progress.push("1+ certification started");
    return { complete: progress.length >= 2, progress };
  }

  if (week === 4) {
    const reviewEvents = await prisma.progressionEvent.count({
      where: {
        studentId,
        eventType: { in: ["weekly_review", "checkin_complete"] },
      },
    });
    if (reviewEvents >= 1) progress.push("Weekly review completed");
    // Goals adjusted if they have active weekly goals (implies they've been setting/resetting)
    const weeklyGoals = await prisma.goal.count({
      where: { studentId, level: "weekly", status: { in: ["active", "in_progress"] } },
    });
    if (weeklyGoals > 0) progress.push("goals adjusted");
    return { complete: progress.length >= 2, progress };
  }

  if (week === 5) {
    const [resume, portfolio] = await Promise.all([
      prisma.resumeData.findUnique({ where: { studentId }, select: { id: true } }),
      prisma.portfolioItem.count({ where: { studentId } }),
    ]);
    if (resume) progress.push("Resume created");
    if (portfolio >= 1) progress.push("1+ portfolio item added");
    return { complete: progress.length >= 2, progress };
  }

  if (week === 6) {
    const [completedCerts] = await Promise.all([
      prisma.certification.count({ where: { studentId, status: "complete" } }),
    ]);
    if (completedCerts >= 1) progress.push("1+ certification earned");
    // Readiness score check is deferred — arc advancement happens by calendar time anyway
    return { complete: completedCerts >= 1, progress };
  }

  return { complete: false, progress };
}

/**
 * Build a context string for injection into the Sage system prompt.
 */
export function buildArcContextString(arc: CoachingArcState): string {
  const { weekNumber, currentMilestone, template } = arc;
  const signals = currentMilestone.completionSignals.join(", ");
  return [
    `COACHING ARC: The student is in Week ${weekNumber} of ${template.durationWeeks} (${currentMilestone.label}).`,
    `This week's focus: ${currentMilestone.focus}.`,
    `Milestones to hit: ${signals}.`,
    `Adjust your coaching emphasis accordingly — ${currentMilestone.description}.`,
    `Relevant conversation stages this week: ${currentMilestone.targetStages.join(", ")}.`,
  ].join(" ");
}
