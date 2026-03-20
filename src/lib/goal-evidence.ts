import { goalCountsTowardPlan } from "@/lib/goals";
import type {
  GoalPlanEntry,
  GoalResourceLinkStatus,
  GoalResourceLinkView,
  GoalResourceType,
} from "@/lib/goal-resource-links";
import type { ProgressionState } from "@/lib/progression/engine";

export const GOAL_EVIDENCE_STATUSES = [
  "not_started",
  "in_progress",
  "submitted",
  "completed",
  "approved",
  "blocked",
] as const;
export type GoalEvidenceStatus = (typeof GOAL_EVIDENCE_STATUSES)[number];

export const GOAL_EVIDENCE_SOURCES = [
  "none",
  "student_update",
  "system",
  "teacher_review",
] as const;
export type GoalEvidenceSource = (typeof GOAL_EVIDENCE_SOURCES)[number];

export const GOAL_REVIEW_ITEM_KINDS = [
  "goal_needs_resource",
  "goal_resource_stale",
  "goal_review_pending",
] as const;
export type GoalReviewItemKind = (typeof GOAL_REVIEW_ITEM_KINDS)[number];

export interface GoalEvidenceGoal {
  id: string;
  content: string;
  status: string;
  createdAt?: Date | string | null;
}

export interface GoalEvidenceFormSubmission {
  id: string;
  formId: string;
  status: string;
  createdAt: Date | string;
  updatedAt: Date | string;
  reviewedAt: Date | string | null;
  notes: string | null;
}

export interface GoalEvidenceOrientationProgress {
  itemId: string;
  completed: boolean;
  completedAt: Date | string | null;
}

export interface GoalEvidenceCertificationRequirement {
  templateId?: string;
  completed: boolean;
  completedAt: Date | string | null;
  verifiedBy: string | null;
  verifiedAt: Date | string | null;
}

export interface GoalEvidenceCertification {
  status: string | null;
  startedAt: Date | string | null;
  completedAt: Date | string | null;
  requirements: GoalEvidenceCertificationRequirement[];
}

export interface GoalEvidencePortfolioItem {
  id: string;
  title: string;
  type: string;
  createdAt: Date | string;
  updatedAt?: Date | string | null;
}

export interface GoalEvidenceResumeData {
  id: string;
}

export interface GoalEvidencePublicCredentialPage {
  isPublic: boolean;
  updatedAt: Date | string;
}

export interface GoalEvidenceApplication {
  id: string;
  opportunityId?: string;
  status: string;
  updatedAt: Date | string;
  appliedAt: Date | string | null;
}

export interface GoalEvidenceEventRegistration {
  id: string;
  eventId?: string;
  status: string;
  updatedAt: Date | string;
  registeredAt: Date | string;
}

export interface GoalEvidenceEntry {
  goalId: string;
  linkId: string;
  resourceType: GoalResourceType;
  resourceId: string;
  title: string;
  linkStatus: GoalResourceLinkStatus;
  evidenceStatus: GoalEvidenceStatus;
  evidenceSource: GoalEvidenceSource;
  reviewNeeded: boolean;
  evidenceLabel: string;
  summary: string;
  lastObservedAt: Date | string | null;
  dueAt: Date | string | null;
  notes: string | null;
}

export interface GoalReviewQueueItem {
  key: string;
  kind: GoalReviewItemKind;
  severity: "medium" | "high";
  goalId: string;
  goalTitle: string;
  linkId: string | null;
  resourceTitle: string | null;
  summary: string;
  dueAt: Date | string | null;
  detectedAt: Date | string | null;
}

function toDate(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function latestDate(...values: Array<Date | string | null | undefined>) {
  return values.reduce<Date | null>((latest, value) => {
    const date = toDate(value);
    if (!date) return latest;
    if (!latest || date.getTime() > latest.getTime()) return date;
    return latest;
  }, null);
}

function isObservedStatus(status: GoalEvidenceStatus) {
  return status !== "not_started";
}

function manualEvidence(link: GoalResourceLinkView) {
  if (link.status === "completed") {
    return {
      evidenceStatus: "completed" as const,
      evidenceSource: "student_update" as const,
      reviewNeeded: false,
      evidenceLabel: "Student marked complete",
      summary: "Student marked this resource complete.",
      lastObservedAt: link.updatedAt,
    };
  }

  if (link.status === "in_progress") {
    return {
      evidenceStatus: "in_progress" as const,
      evidenceSource: "student_update" as const,
      reviewNeeded: false,
      evidenceLabel: "Student started work",
      summary: "Student marked this resource as in progress.",
      lastObservedAt: link.updatedAt,
    };
  }

  if (link.status === "blocked") {
    return {
      evidenceStatus: "blocked" as const,
      evidenceSource: "student_update" as const,
      reviewNeeded: false,
      evidenceLabel: "Student reported a blocker",
      summary: "Student marked this resource as blocked.",
      lastObservedAt: link.updatedAt,
    };
  }

  if (link.status === "dismissed") {
    return {
      evidenceStatus: "blocked" as const,
      evidenceSource: "student_update" as const,
      reviewNeeded: false,
      evidenceLabel: "Resource dismissed",
      summary: "This resource was dismissed from the current plan.",
      lastObservedAt: link.updatedAt,
    };
  }

  return {
    evidenceStatus: "not_started" as const,
    evidenceSource: "none" as const,
    reviewNeeded: false,
    evidenceLabel: "Waiting for activity",
    summary: "No student progress has been observed yet.",
    lastObservedAt: null,
  };
}

function evidenceFromForm(
  link: GoalResourceLinkView,
  submissionsByFormId: Map<string, GoalEvidenceFormSubmission>,
) {
  const submission = submissionsByFormId.get(link.resourceId);
  if (!submission) return manualEvidence(link);

  if (submission.status === "approved") {
    return {
      evidenceStatus: "approved" as const,
      evidenceSource: "teacher_review" as const,
      reviewNeeded: false,
      evidenceLabel: "Approved",
      summary: "Form submission was approved by an instructor.",
      lastObservedAt: submission.reviewedAt || submission.updatedAt,
    };
  }

  if (submission.status === "rejected") {
    return {
      evidenceStatus: "blocked" as const,
      evidenceSource: "teacher_review" as const,
      reviewNeeded: false,
      evidenceLabel: "Needs revision",
      summary: submission.notes
        ? `Form submission needs revision: ${submission.notes}`
        : "Form submission was reviewed and needs revision.",
      lastObservedAt: submission.reviewedAt || submission.updatedAt,
    };
  }

  return {
    evidenceStatus: "submitted" as const,
    evidenceSource: "system" as const,
    reviewNeeded: true,
    evidenceLabel: "Awaiting review",
    summary: "Form has been uploaded and is waiting for instructor review.",
    lastObservedAt: submission.updatedAt,
  };
}

function evidenceFromOrientation(
  link: GoalResourceLinkView,
  progressByItemId: Map<string, GoalEvidenceOrientationProgress>,
) {
  const progress = progressByItemId.get(link.resourceId);
  if (!progress?.completed) return manualEvidence(link);

  return {
    evidenceStatus: "completed" as const,
    evidenceSource: "system" as const,
    reviewNeeded: false,
    evidenceLabel: "Completed",
    summary: "Orientation step has been marked complete.",
    lastObservedAt: progress.completedAt,
  };
}

function evidenceFromPlatform(link: GoalResourceLinkView, progressionState: ProgressionState | null) {
  if (progressionState?.platformsVisited.includes(link.resourceId)) {
    return {
      evidenceStatus: "in_progress" as const,
      evidenceSource: "system" as const,
      reviewNeeded: false,
      evidenceLabel: "Visited",
      summary: "Student has opened this learning platform.",
      lastObservedAt: null,
    };
  }

  return manualEvidence(link);
}

function evidenceFromPortfolioTask(
  link: GoalResourceLinkView,
  portfolioItems: GoalEvidencePortfolioItem[],
  resumeData: GoalEvidenceResumeData | null,
  publicCredentialPage: GoalEvidencePublicCredentialPage | null,
) {
  const latestPortfolioAt = latestDate(...portfolioItems.map((item) => item.updatedAt || item.createdAt));
  if (link.resourceId === "resume-refresh" && resumeData) {
    return {
      evidenceStatus: "completed" as const,
      evidenceSource: "system" as const,
      reviewNeeded: false,
      evidenceLabel: "Resume saved",
      summary: "Resume data exists for this student.",
      lastObservedAt: null,
    };
  }

  if (link.resourceId === "portfolio-proof" && portfolioItems.length > 0) {
    return {
      evidenceStatus: "completed" as const,
      evidenceSource: "system" as const,
      reviewNeeded: false,
      evidenceLabel: "Portfolio item added",
      summary: "Student has added at least one portfolio item.",
      lastObservedAt: latestPortfolioAt,
    };
  }

  if (link.resourceId === "credential-share") {
    if (publicCredentialPage?.isPublic) {
      return {
        evidenceStatus: "approved" as const,
        evidenceSource: "system" as const,
        reviewNeeded: false,
        evidenceLabel: "Public credential live",
        summary: "Student has published a public credential page.",
        lastObservedAt: publicCredentialPage.updatedAt,
      };
    }

    if (portfolioItems.length > 0) {
      return {
        evidenceStatus: "in_progress" as const,
        evidenceSource: "system" as const,
        reviewNeeded: false,
        evidenceLabel: "Preparing shareable work",
        summary: "Student has portfolio items but nothing public is live yet.",
        lastObservedAt: latestPortfolioAt,
      };
    }
  }

  return manualEvidence(link);
}

function evidenceFromCertification(
  link: GoalResourceLinkView,
  certification: GoalEvidenceCertification | null,
) {
  if (!certification) return manualEvidence(link);

  const pendingReviewAt = latestDate(
    ...certification.requirements
      .filter((requirement) => requirement.completed && !requirement.verifiedBy)
      .map((requirement) => requirement.completedAt),
  );
  if (pendingReviewAt) {
    return {
      evidenceStatus: "submitted" as const,
      evidenceSource: "system" as const,
      reviewNeeded: true,
      evidenceLabel: "Awaiting verification",
      summary: "Certification evidence is waiting for teacher verification.",
      lastObservedAt: pendingReviewAt,
    };
  }

  if (certification.status === "completed") {
    return {
      evidenceStatus: "approved" as const,
      evidenceSource: "teacher_review" as const,
      reviewNeeded: false,
      evidenceLabel: "Certification complete",
      summary: "Ready to Work certification is complete.",
      lastObservedAt: certification.completedAt,
    };
  }

  const inProgressAt = latestDate(
    certification.startedAt,
    ...certification.requirements.flatMap((requirement) => [
      requirement.completedAt,
      requirement.verifiedAt,
    ]),
  );
  if (inProgressAt) {
    return {
      evidenceStatus: "in_progress" as const,
      evidenceSource: "system" as const,
      reviewNeeded: false,
      evidenceLabel: "Certification activity recorded",
      summary: "Certification tracking has recorded progress.",
      lastObservedAt: inProgressAt,
    };
  }

  return manualEvidence(link);
}

function evidenceFromCareerStep(
  link: GoalResourceLinkView,
  applications: GoalEvidenceApplication[],
  eventRegistrations: GoalEvidenceEventRegistration[],
) {
  if (link.resourceId.startsWith("opportunity:")) {
    const opportunityId = link.resourceId.slice("opportunity:".length);
    const application = applications.find((item) => item.opportunityId === opportunityId);
    if (!application) return manualEvidence(link);

    if (["applied", "interviewing", "offer"].includes(application.status)) {
      return {
        evidenceStatus: "completed" as const,
        evidenceSource: "system" as const,
        reviewNeeded: false,
        evidenceLabel: "Application tracked",
        summary: "Student has recorded progress against this assigned opportunity.",
        lastObservedAt: application.appliedAt || application.updatedAt,
      };
    }

    return {
      evidenceStatus: "in_progress" as const,
      evidenceSource: "system" as const,
      reviewNeeded: false,
      evidenceLabel: "Opportunity saved",
      summary: "Student saved this opportunity but has not marked it applied yet.",
      lastObservedAt: application.updatedAt,
    };
  }

  if (link.resourceId.startsWith("event:")) {
    const eventId = link.resourceId.slice("event:".length);
    const registration = eventRegistrations.find((item) => item.eventId === eventId);
    if (!registration) return manualEvidence(link);

    return {
      evidenceStatus: "completed" as const,
      evidenceSource: "system" as const,
      reviewNeeded: false,
      evidenceLabel: "Event registered",
      summary: "Student has registered for this assigned event.",
      lastObservedAt: registration.registeredAt || registration.updatedAt,
    };
  }

  if (link.resourceId === "application-submit") {
    const completedApplication = applications.find((application) =>
      ["applied", "interviewing", "offer"].includes(application.status)
    );
    if (completedApplication) {
      return {
        evidenceStatus: "completed" as const,
        evidenceSource: "system" as const,
        reviewNeeded: false,
        evidenceLabel: "Application tracked",
        summary: "Student has recorded an active application outcome.",
        lastObservedAt: completedApplication.appliedAt || completedApplication.updatedAt,
      };
    }

    const savedApplication = applications.find((application) => application.status === "saved");
    if (savedApplication) {
      return {
        evidenceStatus: "in_progress" as const,
        evidenceSource: "system" as const,
        reviewNeeded: false,
        evidenceLabel: "Opportunity saved",
        summary: "Student has started tracking an opportunity but has not marked it applied yet.",
        lastObservedAt: savedApplication.updatedAt,
      };
    }
  }

  if (link.resourceId === "event-register") {
    const registration = eventRegistrations.find((event) => event.status === "registered");
    if (registration) {
      return {
        evidenceStatus: "completed" as const,
        evidenceSource: "system" as const,
        reviewNeeded: false,
        evidenceLabel: "Event registered",
        summary: "Student has registered for a career event.",
        lastObservedAt: registration.registeredAt || registration.updatedAt,
      };
    }
  }

  return manualEvidence(link);
}

export function buildGoalEvidenceEntries({
  links,
  progressionState,
  formSubmissions = [],
  orientationProgress = [],
  certification = null,
  portfolioItems = [],
  resumeData = null,
  publicCredentialPage = null,
  applications = [],
  eventRegistrations = [],
}: {
  links: GoalResourceLinkView[];
  progressionState: ProgressionState | null;
  formSubmissions?: GoalEvidenceFormSubmission[];
  orientationProgress?: GoalEvidenceOrientationProgress[];
  certification?: GoalEvidenceCertification | null;
  portfolioItems?: GoalEvidencePortfolioItem[];
  resumeData?: GoalEvidenceResumeData | null;
  publicCredentialPage?: GoalEvidencePublicCredentialPage | null;
  applications?: GoalEvidenceApplication[];
  eventRegistrations?: GoalEvidenceEventRegistration[];
}): GoalEvidenceEntry[] {
  const submissionsByFormId = new Map(formSubmissions.map((submission) => [submission.formId, submission]));
  const progressByItemId = new Map(orientationProgress.map((item) => [item.itemId, item]));

  return links.map((link) => {
    const observed = (() => {
      switch (link.resourceType) {
        case "form":
          return evidenceFromForm(link, submissionsByFormId);
        case "orientation":
          return evidenceFromOrientation(link, progressByItemId);
        case "platform":
          return evidenceFromPlatform(link, progressionState);
        case "portfolio_task":
          return evidenceFromPortfolioTask(link, portfolioItems, resumeData, publicCredentialPage);
        case "certification":
          return evidenceFromCertification(link, certification);
        case "career_step":
          return evidenceFromCareerStep(link, applications, eventRegistrations);
        default:
          return manualEvidence(link);
      }
    })();

    return {
      goalId: link.goalId,
      linkId: link.id,
      resourceType: link.resourceType,
      resourceId: link.resourceId,
      title: link.title,
      linkStatus: link.status,
      evidenceStatus: observed.evidenceStatus,
      evidenceSource: observed.evidenceSource,
      reviewNeeded: observed.reviewNeeded,
      evidenceLabel: observed.evidenceLabel,
      summary: observed.summary,
      lastObservedAt: observed.lastObservedAt,
      dueAt: link.dueAt,
      notes: link.notes,
    };
  });
}

function buildGoalTitle(goal: GoalEvidenceGoal) {
  return goal.content.length > 96 ? `${goal.content.slice(0, 93)}...` : goal.content;
}

function activeAssignedLinks(links: GoalResourceLinkView[]) {
  return links.filter((link) => link.linkType === "assigned" && link.status !== "dismissed");
}

function severityForAge(ageDays: number, overdue: boolean) {
  return overdue || ageDays >= 14 ? "high" : "medium";
}

export function buildGoalReviewQueue({
  goals,
  links,
  evidenceEntries,
  now = new Date(),
}: {
  goals: GoalEvidenceGoal[];
  links: GoalResourceLinkView[];
  evidenceEntries: GoalEvidenceEntry[];
  now?: Date;
}): GoalReviewQueueItem[] {
  const queue: GoalReviewQueueItem[] = [];
  const assignedLinksByGoal = new Map<string, GoalResourceLinkView[]>();
  for (const link of activeAssignedLinks(links)) {
    const existing = assignedLinksByGoal.get(link.goalId) || [];
    existing.push(link);
    assignedLinksByGoal.set(link.goalId, existing);
  }

  for (const goal of goals.filter((item) => goalCountsTowardPlan(item.status))) {
    const goalLinks = assignedLinksByGoal.get(goal.id) || [];
    if (goalLinks.length === 0) {
      const ageDays = toDate(goal.createdAt)
        ? (now.getTime() - toDate(goal.createdAt)!.getTime()) / 86400000
        : 0;
      queue.push({
        key: `goal_needs_resource:${goal.id}`,
        kind: "goal_needs_resource",
        severity: ageDays >= 7 ? "high" : "medium",
        goalId: goal.id,
        goalTitle: buildGoalTitle(goal),
        linkId: null,
        resourceTitle: null,
        summary: "This goal does not have an assigned resource or next step yet.",
        dueAt: null,
        detectedAt: goal.createdAt || null,
      });
    }
  }

  const goalById = new Map(goals.map((goal) => [goal.id, goal]));
  for (const evidence of evidenceEntries) {
    const goal = goalById.get(evidence.goalId);
    if (!goal || !goalCountsTowardPlan(goal.status)) continue;

    const dueAt = toDate(evidence.dueAt);
    const overdue = Boolean(dueAt && dueAt.getTime() < now.getTime());

    if (evidence.reviewNeeded) {
      const ageDays = evidence.lastObservedAt
        ? (now.getTime() - toDate(evidence.lastObservedAt)!.getTime()) / 86400000
        : 0;
      queue.push({
        key: `goal_review_pending:${evidence.linkId}`,
        kind: "goal_review_pending",
        severity: severityForAge(ageDays, overdue),
        goalId: goal.id,
        goalTitle: buildGoalTitle(goal),
        linkId: evidence.linkId,
        resourceTitle: evidence.title,
        summary: `${evidence.title} has student work waiting for teacher review.`,
        dueAt: evidence.dueAt,
        detectedAt: evidence.lastObservedAt,
      });
      continue;
    }

    if (isObservedStatus(evidence.evidenceStatus)) {
      continue;
    }

    const assignedAt = toDate(links.find((link) => link.id === evidence.linkId)?.createdAt);
    if (!assignedAt) continue;

    const ageDays = (now.getTime() - assignedAt.getTime()) / 86400000;
    if (ageDays < 7) continue;

    queue.push({
      key: `goal_resource_stale:${evidence.linkId}`,
      kind: "goal_resource_stale",
      severity: severityForAge(ageDays, overdue),
      goalId: goal.id,
      goalTitle: buildGoalTitle(goal),
      linkId: evidence.linkId,
      resourceTitle: evidence.title,
      summary: `${evidence.title} was assigned, but no student activity has been observed in the last 7 days.`,
      dueAt: evidence.dueAt,
      detectedAt: assignedAt,
    });
  }

  return queue.sort((left, right) => {
    if (left.severity !== right.severity) {
      return left.severity === "high" ? -1 : 1;
    }

    const leftDue = toDate(left.dueAt)?.getTime() ?? Number.POSITIVE_INFINITY;
    const rightDue = toDate(right.dueAt)?.getTime() ?? Number.POSITIVE_INFINITY;
    if (leftDue !== rightDue) return leftDue - rightDue;

    const leftDetected = toDate(left.detectedAt)?.getTime() ?? 0;
    const rightDetected = toDate(right.detectedAt)?.getTime() ?? 0;
    return rightDetected - leftDetected;
  });
}

function toIsoOrNull(value: Date | string | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

export function serializeGoalEvidenceEntries(entries: GoalEvidenceEntry[]): GoalEvidenceEntry[] {
  return entries.map((entry) => ({
    ...entry,
    lastObservedAt: toIsoOrNull(entry.lastObservedAt),
    dueAt: toIsoOrNull(entry.dueAt),
  }));
}

export function serializeGoalReviewQueue(items: GoalReviewQueueItem[]): GoalReviewQueueItem[] {
  return items.map((item) => ({
    ...item,
    dueAt: toIsoOrNull(item.dueAt),
    detectedAt: toIsoOrNull(item.detectedAt),
  }));
}

export function buildGoalReviewQueueFromPlans({
  goals,
  goalPlans,
  evidenceEntries,
  now = new Date(),
}: {
  goals: GoalEvidenceGoal[];
  goalPlans: GoalPlanEntry[];
  evidenceEntries: GoalEvidenceEntry[];
  now?: Date;
}) {
  return buildGoalReviewQueue({
    goals,
    links: goalPlans.flatMap((plan) => plan.links),
    evidenceEntries,
    now,
  });
}
