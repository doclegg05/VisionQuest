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

type TeacherNudgeSpec = ReturnType<typeof buildTeacherInterventionNotifications>[number];
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

  const delivered = await deliverTeacherNudges(studentId, teacherSpecs);

  await Promise.allSettled(
    delivered.flatMap((teacher) => {
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
 * Who is told that THIS student has an overdue task or a goal needing review,
 * and whether anybody actually received it.
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
 * W2 (2026-09-07 audit): the fallback keys on what was DELIVERED, not on what
 * resolved. `sendNotificationWithCooldown({ client: "admin" })` refuses a
 * non-staff recipient by throwing, and `Promise.allSettled` swallows it — so
 * a resolved-but-undeliverable audience used to end the whole path silently,
 * with the student's nudge reaching nobody. A recipient counts as delivered
 * when their write did not throw; a cooldown-suppressed write (`false`) is a
 * delivery, because that recipient already holds this nudge and re-widening
 * to the program on their account would spam every teacher.
 *
 * The delivered set is also what the email loop iterates. That loop has no
 * staff check of its own, so following delivery rather than resolution is
 * what keeps a student-naming email off an address the in-app write already
 * refused.
 *
 * Both reads go through prismaAdmin (see staff-recipients.ts): via
 * syncStudentAlerts this runs inside a STUDENT's RLS context on student
 * routes, where the app client returns zero teacher rows and
 * `notification_access` WITH CHECK rejects a Notification addressed to a
 * teacher. Only staff identities are read; the student's own nudge stays on
 * the app client.
 *
 * The structured log names the branch that fired and carries counts. The
 * failure line carries `studentLogKey(studentId)` — a one-way correlation
 * key, never the raw id — because a broken lookup is worth tracing back to
 * one student; the audience-size lines carry no student field at all
 * (.claude/rules/security.md, Data Privacy).
 */
async function deliverTeacherNudges(
  studentId: string,
  teacherSpecs: TeacherNudgeSpec[],
): Promise<StaffRecipient[]> {
  const assigned = await resolveAssignedInstructors(studentId);

  let attempted = assigned;
  let delivered = await sendToAll(assigned, teacherSpecs);

  if (delivered.length > 0) {
    logger.debug("Nudge: delivered to assigned instructors", {
      alert: "intervention_nudge_assigned_instructors",
      recipientCount: delivered.length,
    });
    return delivered;
  }

  // Nobody assigned, or nobody assigned could be written to. Widen.
  const everyone = await listActiveTeachers();
  logger.warn("Nudge: no assigned instructor received it; delivering program-wide", {
    alert: "intervention_nudge_fallback_program_wide",
    recipientCount: everyone.length,
  });
  attempted = everyone;
  delivered = await sendToAll(everyone, teacherSpecs);

  if (delivered.length === 0) {
    // The nudge reached nobody. Same shape and same reason as
    // `wellbeing_no_recipients`: this is the line that fires when
    // ADMIN_DATABASE_URL is unset and prismaAdmin has silently degraded to
    // vq_app, and it must never be quiet.
    logger.error("Nudge: no staff recipients received it; nobody was notified", {
      alert: "intervention_nudge_no_recipients",
      attemptedCount: attempted.length,
    });
  }

  return delivered;
}

/** The assigned instructors, or [] if resolution returned nothing or threw. */
async function resolveAssignedInstructors(studentId: string): Promise<StaffRecipient[]> {
  try {
    return await findAssignedInstructors(studentId);
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
    return [];
  }
}

/**
 * Attempt every (recipient × spec) nudge and return the recipients whose
 * writes all completed. A rejected write means the admin client refused that
 * recipient — they were not notified, and must not be emailed either.
 */
async function sendToAll(
  recipients: StaffRecipient[],
  teacherSpecs: TeacherNudgeSpec[],
): Promise<StaffRecipient[]> {
  const outcomes = await Promise.all(
    recipients.map(async (recipient) => {
      const results = await Promise.allSettled(
        teacherSpecs.map((spec) =>
          sendNotificationWithCooldown(
            recipient.id,
            {
              type: spec.type,
              title: spec.title,
              body: spec.body,
            },
            spec.cooldownHours,
            { client: "admin" },
          ),
        ),
      );
      // "Delivered" is "not refused". A `false` return is the cooldown
      // saying this recipient already has the nudge.
      const reached = results.some((result) => result.status === "fulfilled");
      return reached ? recipient : null;
    }),
  );

  return outcomes.filter((recipient): recipient is StaffRecipient => recipient !== null);
}
