import "server-only";

import { buildStudentAlertDescriptors, type AlertDescriptor } from "./advising-alerts";
import { type DetectedAlertWriter, writeDetectedAlert } from "./alert-hold";
import { prisma } from "./db";
import { buildGoalEvidenceEntries, buildGoalReviewQueue } from "./goal-evidence";
import { parseState } from "./progression/engine";
import { toGoalResourceLinkView } from "./goal-resource-links";
import { buildPlacementAlertDescriptors } from "./placement-bridge";
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
    placementBridgeScope,
  } = context;

  const certification = studentSignals?.certifications.find(
    (candidate) => candidate.certType === "ready-to-work",
  );
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
        certifications: studentSignals.certifications.map((candidate) => ({
          certType: candidate.certType,
          status: candidate.status,
          startedAt: candidate.startedAt,
          completedAt: candidate.completedAt,
          requirements: candidate.requirements.map((requirement) => ({
            templateId: requirement.templateId,
            completed: requirement.completed,
            completedAt: requirement.completedAt,
            verifiedBy: requirement.verifiedBy,
            verifiedAt: requirement.verifiedAt,
          })),
        })),
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
            createdAt: goal.createdAt,
            sourceMessageId: goal.sourceMessageId,
            lastReviewedAt: goal.lastReviewedAt,
            confirmedAt: goal.confirmedAt,
          })),
          lastConversationAt: studentSignals.conversations[0]?.updatedAt || null,
          orientationComplete: progressionState?.orientationComplete || false,
          birthDate: studentSignals.spokesRecord?.birthDate ?? null,
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
                // P1-4: drives the certification_unverified alert.
                verificationStatus: certification.verificationStatus,
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

  // Phase 0A placement bridge: verified accepted applications raise a
  // "Record employment outcome" queue item until employment is recorded.
  const placementAlerts = studentSignals
    ? buildPlacementAlertDescriptors({
        scope: placementBridgeScope,
        activeClassIds: studentSignals.classEnrollments.map(
          (enrollment) => enrollment.classId
        ),
        applications: studentSignals.applications,
        spokesRecord: studentSignals.spokesRecord,
      })
    : [];

  return {
    studentSignals,
    goalEvidenceEntries,
    goalReviewItems,
    desiredAlerts: [
      ...baselineAlerts,
      ...goalAlerts,
      ...(motivationAlert ? [motivationAlert] : []),
      ...placementAlerts,
    ],
  };
}

type ExistingAlert = StudentAlertSyncContext["existing"][number];

/**
 * Writes one alert the sync wants open. `prev` is what the context read found, before this transaction, so a teacher
 * can dismiss or snooze the alert in between. Every status change is therefore conditional on the state that was read
 * (`writeDetectedAlert`, the detectors' writer), and a hold that landed since is kept.
 *
 * The context read lists no resolved rows, so an alert it did not find is resolved, missing, or open but of a type the
 * read leaves out. Only a row that is still resolved is reopened, as a new spell; anything else gets its text, or is
 * created if it does not exist.
 */
async function writeSyncAlert(
  tx: DetectedAlertWriter,
  studentId: string,
  prev: ExistingAlert | undefined,
  alert: AlertDescriptor,
  now: Date,
): Promise<void> {
  const text = {
    severity: alert.severity,
    title: alert.title,
    summary: alert.summary,
    sourceType: alert.sourceType,
    sourceId: alert.sourceId,
  };
  const detected = { studentId, alertKey: alert.alertKey, type: alert.type, ...text };
  if (prev) {
    await writeDetectedAlert(tx, prev, detected, now);
    return;
  }
  const { count } = await tx.studentAlert.updateMany({
    where: { alertKey: alert.alertKey, status: "resolved" },
    data: {
      ...text,
      status: "open",
      detectedAt: now,
      resolvedAt: null,
      snoozedUntil: null,
      snoozedBy: null,
    },
  });
  if (count === 0) await writeDetectedAlert(tx, undefined, detected, now);
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
      await writeSyncAlert(tx, studentId, existingByKey.get(alert.alertKey), alert, now);
    }

    const staleNonDismissedIds = existing
      .filter((alert) => !desiredKeys.has(alert.alertKey) && alert.status !== "dismissed")
      .map((alert) => alert.id);

    if (staleNonDismissedIds.length > 0) {
      await tx.studentAlert.updateMany({
        // Only rows still open or snoozed: a dismiss that landed after the read stays a dismiss.
        where: { id: { in: staleNonDismissedIds }, status: { in: ["open", "snoozed"] } },
        data: {
          status: "resolved",
          resolvedAt: now,
        },
      });
    }
  });
}
