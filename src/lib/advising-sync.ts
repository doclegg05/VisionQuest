import { buildStudentAlertDescriptors, type AlertDescriptor } from "./advising-alerts";
import { prisma } from "./db";
import { buildGoalEvidenceEntries, buildGoalReviewQueue } from "./goal-evidence";
import { parseState } from "./progression/engine";
import { toGoalResourceLinkView } from "./goal-resource-links";
import { buildStudentStatusSignals } from "./student-status";
import type { loadStudentAlertSyncContext } from "./advising-sync-context";

type StudentAlertSyncContext = Awaited<ReturnType<typeof loadStudentAlertSyncContext>>;

function latestDate(...values: Array<Date | null | undefined>) {
  return values.reduce<Date | null>((latest, value) => {
    if (!value) return latest;
    if (!latest || value.getTime() > latest.getTime()) return value;
    return latest;
  }, null);
}

export function buildStudentAlertSyncPlan({
  studentId,
  now,
  context,
}: {
  studentId: string;
  now: Date;
  context: StudentAlertSyncContext;
}) {
  const {
    tasks,
    appointments,
    studentSignals,
    orientationItems,
    recentMoodEntries,
    compliance,
  } = context;

  const certification = studentSignals?.certifications[0];
  const requiredCertificationRequirements = certification?.requirements.filter(
    (requirement) => requirement.template.required
  ) || [];
  const lastCertificationProgressAt = latestDate(
    certification?.completedAt || null,
    certification?.startedAt || null,
    ...requiredCertificationRequirements.flatMap((requirement) => [
      requirement.completedAt,
      requirement.verifiedAt,
    ])
  );
  const progressionState = studentSignals?.progression?.state
    ? parseState(studentSignals.progression.state)
    : null;
  const studentStatusSignals = studentSignals
    ? buildStudentStatusSignals({
        formSubmissions: studentSignals.formSubmissions,
        orientationItems,
        orientationProgress: studentSignals.orientationProgress,
      })
    : null;
  const goalLinks = (studentSignals?.goalResourceLinks || [])
    .map((link) => toGoalResourceLinkView(link))
    .filter((link): link is NonNullable<typeof link> => !!link);
  const goalEvidenceEntries = studentSignals
    ? buildGoalEvidenceEntries({
        links: goalLinks,
        progressionState,
        formSubmissions: studentSignals.formSubmissions,
        orientationProgress: studentSignals.orientationProgress,
        certification: certification
          ? {
              status: certification.status,
              startedAt: certification.startedAt,
              completedAt: certification.completedAt,
              requirements: certification.requirements.map((requirement) => ({
                templateId: requirement.templateId,
                completed: requirement.completed,
                completedAt: requirement.completedAt,
                verifiedBy: requirement.verifiedBy,
                verifiedAt: requirement.verifiedAt,
              })),
            }
          : null,
        portfolioItems: studentSignals.portfolioItems,
        resumeData: studentSignals.resumeData,
        publicCredentialPage: studentSignals.publicCredentialPage,
        applications: studentSignals.applications,
        eventRegistrations: studentSignals.eventRegistrations,
      })
    : [];
  const goalReviewItems = studentSignals
    ? buildGoalReviewQueue({
        goals: studentSignals.goals.map((goal) => ({
          id: goal.id,
          content: goal.content,
          status: goal.status,
          createdAt: goal.createdAt,
        })),
        links: goalLinks,
        evidenceEntries: goalEvidenceEntries,
        now,
      })
    : [];
  const lastActivityAt = latestDate(
    studentSignals?.createdAt || null,
    studentSignals?.conversations[0]?.updatedAt || null,
    studentSignals?.goals[0]?.updatedAt || null,
    studentSignals?.formSubmissions[0]?.updatedAt || null,
    ...((studentSignals?.orientationProgress || []).map((progress) => progress.completedAt)),
    studentSignals?.portfolioItems[0]?.updatedAt || null,
    studentSignals?.files[0]?.uploadedAt || null,
    studentSignals?.appointments[0]?.updatedAt || null,
    studentSignals?.assignedTasks[0]?.updatedAt || null,
    studentSignals?.applications[0]?.updatedAt || null,
    studentSignals?.eventRegistrations[0]?.updatedAt || null,
    studentSignals?.publicCredentialPage?.updatedAt || null
  );
  const baselineAlerts = buildStudentAlertDescriptors({
    tasks,
    appointments,
    signals: studentSignals
      ? {
          studentId,
          studentCreatedAt: studentSignals.createdAt,
          lastActivityAt,
          applicationCount: studentSignals._count.applications,
          eventRegistrationCount: studentSignals._count.eventRegistrations,
          orientationStatus: studentStatusSignals,
          goals: studentSignals.goals.map((goal) => ({
            id: goal.id,
            level: goal.level,
            status: goal.status,
            updatedAt: goal.updatedAt,
          })),
          lastConversationAt: studentSignals.conversations[0]?.updatedAt || null,
          orientationComplete: progressionState?.orientationComplete || false,
          requirementCompliance: compliance
            ? {
                requiredCount: compliance.requiredCount,
                requiredMet: compliance.requiredMet,
                missingTitles: compliance.items
                  .filter((i) => i.requiredStatus === "required" && !i.met)
                  .map((i) => i.title),
              }
            : null,
          certification: certification
            ? {
                status: certification.status,
                startedAt: certification.startedAt,
                lastProgressAt: lastCertificationProgressAt,
                completedRequiredCount: requiredCertificationRequirements.filter(
                  (requirement) => requirement.completed || Boolean(requirement.verifiedAt)
                ).length,
                requiredCount: requiredCertificationRequirements.length,
              }
            : null,
        }
      : undefined,
    now,
  });
  const goalAlerts = goalReviewItems.map<AlertDescriptor>((item) => ({
    alertKey: item.key,
    type: item.kind,
    severity: item.severity,
    title: item.kind === "goal_needs_resource"
      ? "Goal needs a support plan"
      : item.kind === "goal_review_pending"
        ? "Student work is waiting for review"
        : item.kind === "goal_platform_stale"
          ? "Platform visited but no follow-through"
          : "Assigned goal resource is stalled",
    summary: item.kind === "goal_needs_resource"
      ? `${item.goalTitle} does not have an assigned resource or next step yet.`
      : item.kind === "goal_review_pending"
        ? `${item.resourceTitle || "Assigned work"} has student evidence waiting for teacher review.`
        : item.kind === "goal_platform_stale"
          ? `${item.resourceTitle || "Learning platform"} was visited but no follow-through evidence has appeared.`
          : `${item.resourceTitle || "Assigned work"} has no observed student activity after assignment.`,
    sourceType: item.linkId ? "goal_resource_link" : "goal",
    sourceId: item.linkId || item.goalId,
  }));
  const motivationAlert: AlertDescriptor | null = (() => {
    const sorted = [...recentMoodEntries].sort(
      (a, b) => a.extractedAt.getTime() - b.extractedAt.getTime()
    );
    if (
      sorted.length === 3 &&
      sorted[0].score > sorted[1].score &&
      sorted[1].score > sorted[2].score
    ) {
      return {
        alertKey: `motivation_declining:${studentId}`,
        type: "motivation_declining",
        severity: "high",
        title: "Motivation declining",
        summary: `Student's self-reported motivation has declined over the last 3 check-ins (${sorted[0].score} → ${sorted[1].score} → ${sorted[2].score})`,
        sourceType: "mood_entry",
        sourceId: studentId,
      };
    }
    return null;
  })();

  return {
    studentSignals,
    goalEvidenceEntries,
    goalReviewItems,
    desiredAlerts: [
      ...baselineAlerts,
      ...goalAlerts,
      ...(motivationAlert ? [motivationAlert] : []),
    ],
  };
}

export async function applyStudentAlertSyncPlan({
  studentId,
  now,
  existing,
  desiredAlerts,
}: {
  studentId: string;
  now: Date;
  existing: StudentAlertSyncContext["existing"];
  desiredAlerts: AlertDescriptor[];
}) {
  const desiredKeys = new Set(desiredAlerts.map((alert) => alert.alertKey));
  const existingByKey = new Map(existing.map((alert) => [alert.alertKey, alert]));

  await prisma.$transaction(async (tx) => {
    for (const alert of desiredAlerts) {
      const prev = existingByKey.get(alert.alertKey);
      const isSnoozed = prev?.status === "snoozed" && prev.snoozedUntil && prev.snoozedUntil > now;
      const isDismissed = prev?.status === "dismissed";

      if (isSnoozed || isDismissed) {
        await tx.studentAlert.update({
          where: { alertKey: alert.alertKey },
          data: {
            severity: alert.severity,
            title: alert.title,
            summary: alert.summary,
            sourceType: alert.sourceType,
            sourceId: alert.sourceId,
          },
        });
      } else {
        await tx.studentAlert.upsert({
          where: { alertKey: alert.alertKey },
          update: {
            severity: alert.severity,
            status: "open",
            title: alert.title,
            summary: alert.summary,
            sourceType: alert.sourceType,
            sourceId: alert.sourceId,
            detectedAt: now,
            resolvedAt: null,
            snoozedUntil: null,
            snoozedBy: null,
          },
          create: {
            studentId,
            alertKey: alert.alertKey,
            type: alert.type,
            severity: alert.severity,
            status: "open",
            title: alert.title,
            summary: alert.summary,
            sourceType: alert.sourceType,
            sourceId: alert.sourceId,
            detectedAt: now,
          },
        });
      }
    }

    const staleNonDismissedIds = existing
      .filter((alert) => !desiredKeys.has(alert.alertKey) && alert.status !== "dismissed")
      .map((alert) => alert.id);

    if (staleNonDismissedIds.length > 0) {
      await tx.studentAlert.updateMany({
        where: { id: { in: staleNonDismissedIds } },
        data: {
          status: "resolved",
          resolvedAt: now,
        },
      });
    }
  });
}
