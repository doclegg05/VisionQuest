/**
 * Typed read interface for "what Sage knows about a student."
 *
 * This is the read plane of the closed-loop Sage architecture
 * (docs/plans/2026-04-29-sage-closed-loop.md). Sage prompts and Sage-
 * adjacent UI both consume the bundle; nothing else queries Prisma
 * directly on Sage's behalf. Tier A introduces the type and the
 * assembler — wiring into `getBaseStudentPromptContext` happens in a
 * later step so this commit is purely additive.
 */

import { prisma } from "@/lib/db";
import { fetchStudentReadinessData } from "@/lib/progression/fetch-readiness-data";
import { buildStudentAlertDescriptors } from "@/lib/advising-alerts";
import {
  buildStudentStatusSignals,
  type StudentStatusSignals,
} from "@/lib/student-status";
import type { ConversationStage } from "@/lib/sage/system-prompts";

export type ContextViewer = "self" | "teacher" | "sage";

export type SageInsightCategory =
  | "goal"
  | "barrier"
  | "strength"
  | "context"
  | "concern";

export interface GoalSummary {
  id: string;
  level: string;
  content: string;
  status: string;
  updatedAt: Date;
  confirmedAt: Date | null;
}

export interface CertSummary {
  certType: string;
  status: string;
  completedRequiredCount: number;
  requiredCount: number;
  startedAt: Date | null;
  lastProgressAt: Date | null;
}

export interface ProgressionEventSummary {
  eventType: string;
  sourceType: string;
  xp: number;
  occurredAt: Date;
}

export interface AlertSummary {
  type: string;
  severity: string;
  title: string;
  summary: string;
  alertKey: string;
}

export interface SageInsightSummary {
  id: string;
  category: SageInsightCategory;
  content: string;
  confidence: number | null;
  status: string;
  createdAt: Date;
}

export interface ConversationContext {
  conversationId: string;
  stage: ConversationStage;
  recentMessageCount: number;
}

export interface StudentContextBundle {
  student: {
    id: string;
    displayName: string;
    classroomConfirmedAt: Date | null;
    role: string;
  };
  goals: {
    active: GoalSummary[];
    proposedAwaitingConfirmation: GoalSummary[];
    recentlyConfirmed: GoalSummary[];
    stalled: GoalSummary[];
  };
  certifications: CertSummary[];
  orientation: {
    complete: boolean;
    missingForms: string[];
    incompleteRequired: string[];
    progress: { completed: number; total: number };
  };
  recentEvents: ProgressionEventSummary[];
  alerts: AlertSummary[];
  insights: SageInsightSummary[];
  conversationContext: ConversationContext | null;
  meta: {
    assembledAt: Date;
    version: "v1";
    viewer: ContextViewer;
    tokenBudget: number | null;
    truncated: { recentEvents: number; insights: number };
  };
}

export interface AssembleOptions {
  viewer: ContextViewer;
  conversationId?: string;
  conversationStage?: ConversationStage;
  tokenBudget?: number;
  /** Override for tests; defaults to 30 days. */
  recentEventsWindowDays?: number;
  /** Override for tests; defaults to 50. */
  maxRecentEvents?: number;
  /** Override for tests; defaults to 20. */
  maxInsights?: number;
}

const DEFAULT_RECENT_WINDOW_DAYS = 30;
const DEFAULT_MAX_RECENT_EVENTS = 50;
const DEFAULT_MAX_INSIGHTS = 20;
const STALLED_DAYS = 21;
const RECENTLY_CONFIRMED_DAYS = 14;

/**
 * Assemble the typed context bundle for a single student.
 *
 * Composition over re-querying: leans on the existing helpers
 * (fetchStudentReadinessData, buildStudentStatusSignals,
 * buildStudentAlertDescriptors) so that one canonical computation of
 * readiness/alerts is used everywhere.
 *
 * Viewer parameter shapes which fields are populated, not which fields
 * exist. RLS at the Prisma layer is the actual security boundary —
 * this function trusts it.
 */
export async function assembleStudentContextBundle(
  studentId: string,
  options: AssembleOptions,
): Promise<StudentContextBundle> {
  const now = new Date();
  const windowDays =
    options.recentEventsWindowDays ?? DEFAULT_RECENT_WINDOW_DAYS;
  const recentEventsCap = options.maxRecentEvents ?? DEFAULT_MAX_RECENT_EVENTS;
  const insightsCap = options.maxInsights ?? DEFAULT_MAX_INSIGHTS;
  const recentSince = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
  const stalledBefore = new Date(now.getTime() - STALLED_DAYS * 24 * 60 * 60 * 1000);
  const confirmedSince = new Date(
    now.getTime() - RECENTLY_CONFIRMED_DAYS * 24 * 60 * 60 * 1000,
  );

  const [
    student,
    goals,
    certifications,
    orientationItems,
    formSubmissions,
    orientationProgress,
    recentEventsRaw,
    insightsRaw,
    recentMessageCount,
    readiness,
  ] = await Promise.all([
    prisma.student.findUniqueOrThrow({
      where: { id: studentId },
      select: {
        id: true,
        displayName: true,
        role: true,
        classroomConfirmedAt: true,
        createdAt: true,
        // birthDate lives on SpokesRecord, not Student. Pulled in here
        // so we can pass it through to buildStudentAlertDescriptors,
        // which needs it for the profile_birthdate_missing alert.
        spokesRecord: { select: { birthDate: true } },
      },
    }),
    prisma.goal.findMany({
      where: { studentId },
      select: {
        id: true,
        level: true,
        content: true,
        status: true,
        updatedAt: true,
        confirmedAt: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 200,
    }),
    prisma.certification.findMany({
      where: { studentId },
      select: {
        certType: true,
        status: true,
        startedAt: true,
        completedAt: true,
        requirements: {
          select: {
            completed: true,
            completedAt: true,
            verifiedAt: true,
            template: { select: { required: true } },
          },
        },
      },
    }),
    prisma.orientationItem.findMany({
      select: { id: true, label: true, required: true },
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
      select: { itemId: true, completed: true, completedAt: true },
    }),
    prisma.progressionEvent.findMany({
      where: { studentId, occurredAt: { gte: recentSince } },
      select: {
        eventType: true,
        sourceType: true,
        xp: true,
        occurredAt: true,
      },
      orderBy: { occurredAt: "desc" },
      take: recentEventsCap + 1,
    }),
    prisma.sageInsight.findMany({
      where: { studentId, status: "active" },
      select: {
        id: true,
        category: true,
        content: true,
        confidence: true,
        status: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: insightsCap + 1,
    }),
    options.conversationId
      ? prisma.message.count({ where: { conversationId: options.conversationId } })
      : Promise.resolve(0),
    fetchStudentReadinessData(studentId),
  ]);

  // Goals: bucket by status + recency.
  const goalSummaries: GoalSummary[] = goals.map((g) => ({
    id: g.id,
    level: g.level,
    content: g.content,
    status: g.status,
    updatedAt: g.updatedAt,
    confirmedAt: g.confirmedAt,
  }));
  const active = goalSummaries.filter((g) => g.status === "active");
  const proposedAwaitingConfirmation = goalSummaries.filter(
    (g) => g.status === "proposed",
  );
  const recentlyConfirmed = goalSummaries.filter(
    (g) =>
      g.status === "active" &&
      g.confirmedAt !== null &&
      g.confirmedAt >= confirmedSince,
  );
  const stalled = goalSummaries.filter(
    (g) => g.status === "active" && g.updatedAt < stalledBefore,
  );

  // Certifications: collapse requirements into counts. lastProgressAt is
  // derived (not a column) — latest of cert.startedAt/completedAt and any
  // required-requirement completedAt/verifiedAt. Mirrors the same
  // computation in src/lib/advising-sync.ts.
  const certSummaries: CertSummary[] = certifications.map((c) => {
    const requiredReqs = c.requirements.filter((r) => r.template.required);
    const candidateDates: (Date | null)[] = [
      c.startedAt,
      c.completedAt,
      ...requiredReqs.flatMap((r) => [r.completedAt, r.verifiedAt]),
    ];
    const validDates = candidateDates.filter((d): d is Date => d instanceof Date);
    const lastProgressAt =
      validDates.length > 0
        ? new Date(Math.max(...validDates.map((d) => d.getTime())))
        : null;
    return {
      certType: c.certType,
      status: c.status,
      completedRequiredCount: requiredReqs.filter(
        (r) => r.completed || Boolean(r.verifiedAt),
      ).length,
      requiredCount: requiredReqs.length,
      startedAt: c.startedAt,
      lastProgressAt,
    };
  });

  // Orientation: reuse buildStudentStatusSignals to derive form/checklist gaps.
  const statusSignals: StudentStatusSignals = buildStudentStatusSignals({
    formSubmissions: formSubmissions.map((f) => ({
      formId: f.formId,
      status: f.status,
      updatedAt: f.updatedAt.toISOString(),
      reviewedAt: f.reviewedAt ? f.reviewedAt.toISOString() : null,
      notes: f.notes,
    })),
    orientationItems,
    orientationProgress: orientationProgress.map((p) => ({
      itemId: p.itemId,
      completed: p.completed,
      completedAt: p.completedAt ? p.completedAt.toISOString() : null,
    })),
  });

  const orientation = {
    complete:
      readiness.orientationProgress.completed >=
      readiness.orientationProgress.total,
    missingForms: [
      ...statusSignals.requiredForms.missing.map((f) => f.id),
      ...statusSignals.requiredForms.needsRevision.map((f) => f.id),
    ],
    incompleteRequired: statusSignals.orientationChecklist.incompleteRequired.map(
      (i) => i.label,
    ),
    progress: readiness.orientationProgress,
  };

  // Alerts: derive from the existing builder.
  const alertDescriptors = buildStudentAlertDescriptors({
    now,
    tasks: [],
    appointments: [],
    signals: {
      studentId: student.id,
      studentCreatedAt: student.createdAt,
      lastActivityAt: recentEventsRaw[0]?.occurredAt ?? student.createdAt,
      applicationCount: 0, // populated when we add the optional reads
      eventRegistrationCount: 0,
      certification:
        certSummaries[0]
          ? {
              status: certSummaries[0].status,
              startedAt: certSummaries[0].startedAt,
              lastProgressAt: certSummaries[0].lastProgressAt,
              completedRequiredCount: certSummaries[0].completedRequiredCount,
              requiredCount: certSummaries[0].requiredCount,
            }
          : null,
      orientationStatus: statusSignals,
      orientationComplete: orientation.complete,
      birthDate: student.spokesRecord?.birthDate ?? null,
    },
  });
  const alertSummaries: AlertSummary[] = alertDescriptors.map((a) => ({
    type: a.type,
    severity: a.severity,
    title: a.title,
    summary: a.summary,
    alertKey: a.alertKey,
  }));

  // Trim recent events / insights to caps; record truncation in meta.
  const recentEventsTruncated = Math.max(0, recentEventsRaw.length - recentEventsCap);
  const recentEvents: ProgressionEventSummary[] = recentEventsRaw
    .slice(0, recentEventsCap)
    .map((e) => ({
      eventType: e.eventType,
      sourceType: e.sourceType,
      xp: e.xp,
      occurredAt: e.occurredAt,
    }));

  const insightsTruncated = Math.max(0, insightsRaw.length - insightsCap);
  const insights: SageInsightSummary[] = insightsRaw
    .slice(0, insightsCap)
    .map((i) => ({
      id: i.id,
      category: i.category as SageInsightCategory,
      content: i.content,
      confidence: i.confidence,
      status: i.status,
      createdAt: i.createdAt,
    }));

  const conversationContext: ConversationContext | null = options.conversationId
    ? {
        conversationId: options.conversationId,
        stage: options.conversationStage ?? "discovery",
        recentMessageCount,
      }
    : null;

  return {
    student: {
      id: student.id,
      displayName: student.displayName,
      classroomConfirmedAt: student.classroomConfirmedAt,
      role: student.role,
    },
    goals: { active, proposedAwaitingConfirmation, recentlyConfirmed, stalled },
    certifications: certSummaries,
    orientation,
    recentEvents,
    alerts: alertSummaries,
    insights,
    conversationContext,
    meta: {
      assembledAt: now,
      version: "v1",
      viewer: options.viewer,
      tokenBudget: options.tokenBudget ?? null,
      truncated: {
        recentEvents: recentEventsTruncated,
        insights: insightsTruncated,
      },
    },
  };
}

/**
 * Pure function: trim a sorted-desc event array to a cap, returning a
 * tuple of the kept events and the count that were dropped. Exposed
 * for testability — the assembler uses .slice() directly.
 */
export function trimRecentEvents(
  events: ProgressionEventSummary[],
  cap: number,
): { kept: ProgressionEventSummary[]; dropped: number } {
  if (events.length <= cap) return { kept: events, dropped: 0 };
  return { kept: events.slice(0, cap), dropped: events.length - cap };
}

/**
 * Pure function: keys a viewer is allowed to see in a bundle. Today
 * the bundle shape is uniform across viewers (RLS does the actual
 * filtering at the DB), so this is identity. Lives here so Tier B can
 * tighten viewer projections without changing the assembler signature.
 */
export function fieldsForViewer(viewer: ContextViewer): readonly (keyof StudentContextBundle)[] {
  const base = [
    "student",
    "goals",
    "certifications",
    "orientation",
    "recentEvents",
    "alerts",
    "insights",
    "conversationContext",
    "meta",
  ] as const satisfies readonly (keyof StudentContextBundle)[];
  // Reserved for Tier B: drop fields per viewer (e.g., teacher-only signals).
  void viewer;
  return base;
}
