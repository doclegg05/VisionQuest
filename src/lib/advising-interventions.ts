import { createHash } from "node:crypto";
import { buildGoalEvidenceEntries, buildGoalReviewQueue } from "./goal-evidence";
import {
  buildStudentInterventionNotifications,
  buildTeacherInterventionNotifications,
  studentInterventionHref,
  teacherInterventionHref,
} from "./intervention-notifications";
import { enqueueJobWithCooldown } from "./jobs";
import { sendNotificationWithCooldown } from "./notifications";
import { isEmailDeliveryConfigured } from "./email";
import { logger } from "./logger";
import { studentLogKey } from "./log-keys";
import {
  findAssignedInstructors,
  listActiveTeachers,
  type StaffRecipient,
} from "./staff-recipients";
import type { AlertDescriptor } from "./advising-alerts";

export async function syncInterventionNotifications({
  studentId,
  studentName,
  studentLabel,
  studentEmail,
  alerts,
  evidenceEntries,
  reviewQueue,
  now = new Date(),
}: {
  studentId: string;
  studentName: string;
  studentLabel: string;
  studentEmail: string | null;
  alerts: AlertDescriptor[];
  evidenceEntries: ReturnType<typeof buildGoalEvidenceEntries>;
  reviewQueue: ReturnType<typeof buildGoalReviewQueue>;
  now?: Date;
}) {
  const studentSpecs = buildStudentInterventionNotifications({
    alerts,
    evidenceEntries,
    now,
  });

  await Promise.allSettled(
    studentSpecs.map((spec) =>
      sendNotificationWithCooldown(
        studentId,
        {
          type: spec.type,
          title: spec.title,
          body: spec.body,
        },
        spec.cooldownHours,
      ),
    ),
  );

  // Nudge emails are best-effort: the in-app notification above is persisted to
  // the Notification table, so a student sees the nudge on next login even with
  // no live SSE session — email is only an extra push. Skip enqueuing email
  // jobs when SMTP isn't configured; otherwise every nudge would create a
  // guaranteed-fail job (the send_email handler throws on missing SMTP).
  // Important low-volume mail (crisis/wellbeing) still enqueues and fails loud.
  const emailEnabled = isEmailDeliveryConfigured();

  const baseUrl = process.env.APP_BASE_URL?.replace(/\/$/, "") || "";
  if (emailEnabled && studentEmail) {
    await Promise.allSettled(
      studentSpecs.map((spec) => {
        const href = `${baseUrl}${studentInterventionHref(spec.type)}`;
        const dedupeHash = createHash("sha1")
          .update(`${studentId}:${spec.type}:${spec.title}:${spec.body}`)
          .digest("hex");

        return enqueueJobWithCooldown({
          type: "send_email",
          dedupeKey: `student-nudge:${dedupeHash}`,
          cooldownHours: spec.cooldownHours,
          payload: {
            to: studentEmail,
            subject: `VisionQuest reminder: ${spec.title}`,
            text:
              `Hi ${studentName},\n\n` +
              `${spec.body}\n\n` +
              `${baseUrl ? `Open VisionQuest: ${href}\n\n` : ""}` +
              "This reminder was sent automatically from VisionQuest.",
          },
        });
      }),
    );
  }

  const teacherSpecs = buildTeacherInterventionNotifications({
    studentName,
    studentId: studentLabel,
    alerts,
    reviewQueue,
  });

  if (teacherSpecs.length === 0) {
    return;
  }

  const teachers = await resolveNudgeRecipients(studentId);

  await Promise.allSettled(
    teachers.flatMap((teacher) =>
      teacherSpecs.map((spec) =>
        sendNotificationWithCooldown(
          teacher.id,
          {
            type: spec.type,
            title: spec.title,
            body: spec.body,
          },
          spec.cooldownHours,
          { client: "admin" },
        ),
      ),
    ),
  );

  await Promise.allSettled(
    teachers.flatMap((teacher) => {
      if (!emailEnabled || !teacher.email) return [];

      return teacherSpecs.map((spec) => {
        const href = `${baseUrl}${teacherInterventionHref(spec.type, studentId)}`;
        const dedupeHash = createHash("sha1")
          .update(`${teacher.id}:${studentId}:${spec.type}:${spec.title}:${spec.body}`)
          .digest("hex");

        return enqueueJobWithCooldown({
          type: "send_email",
          dedupeKey: `teacher-nudge:${dedupeHash}`,
          cooldownHours: spec.cooldownHours,
          payload: {
            to: teacher.email,
            subject: `VisionQuest teacher alert: ${spec.title}`,
            text:
              `Hi ${teacher.displayName},\n\n` +
              `${spec.body}\n\n` +
              `${baseUrl ? `Open student workspace: ${href}\n\n` : ""}` +
              "This reminder was sent automatically from VisionQuest.",
          },
        });
      });
    }),
  );
}

/**
 * Who is told that THIS student has an overdue task or a goal needing review.
 *
 * D8 (2026-09-01 review, decided 2026-09-07): assigned instructors first.
 * A teacher nudge names the student in its title and body, so delivering it
 * to every active teacher discloses one class's students to every other
 * class's instructor — a FERPA-relevant over-disclosure with no operational
 * benefit, since an unassigned teacher cannot act on the nudge anyway. The
 * program-wide audience survives only as the fallback: a student nobody is
 * assigned to, or a resolution that fails outright, still produces a nudge
 * somebody sees. Over-notifying beats a nudge nobody receives, the same
 * failure direction resolveWellbeingRecipients chose for the crisis path.
 *
 * Both branches read through prismaAdmin (see staff-recipients.ts): via
 * syncStudentAlerts this runs inside a STUDENT's RLS context on student
 * routes, where the app client returns zero teacher rows and
 * `notification_access` WITH CHECK rejects a Notification addressed to a
 * teacher. Only staff identities are read; the student's own nudge stays on
 * the app client.
 *
 * The structured log names the branch that fired and carries a recipient
 * count only — no student identifier, not even a correlation key: an
 * audience-size line does not need one, and the fallback's whole point is
 * that it is about the program, not the student
 * (.claude/rules/security.md, Data Privacy).
 */
async function resolveNudgeRecipients(studentId: string): Promise<StaffRecipient[]> {
  let assigned: StaffRecipient[] = [];
  try {
    assigned = await findAssignedInstructors(studentId);
  } catch (err) {
    // Under the student's RLS context the enrollment→instructor join raises
    // Prisma's inconsistency error rather than returning zero rows. Caught
    // here for the same reason the crisis path catches it: a broken lookup
    // must widen the audience, never silence the nudge.
    logger.error("Nudge: instructor resolution failed; falling back to all active teachers", {
      student: studentLogKey(studentId),
      alert: "intervention_nudge_instructor_resolution_failed",
      error: String(err),
    });
  }

  if (assigned.length > 0) {
    logger.debug("Nudge: delivering to assigned instructors", {
      alert: "intervention_nudge_assigned_instructors",
      recipientCount: assigned.length,
    });
    return assigned;
  }

  const everyone = await listActiveTeachers();
  logger.warn("Nudge: no assigned instructor resolved; delivering program-wide", {
    alert: "intervention_nudge_fallback_program_wide",
    recipientCount: everyone.length,
  });
  return everyone;
}
