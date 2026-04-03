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
import { prisma } from "./db";
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

  const baseUrl = process.env.APP_BASE_URL?.replace(/\/$/, "") || "";
  if (studentEmail) {
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

  const teachers = await prisma.student.findMany({
    where: {
      role: "teacher",
      isActive: true,
    },
    select: {
      id: true,
      email: true,
      displayName: true,
    },
  });

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
        ),
      ),
    ),
  );

  await Promise.allSettled(
    teachers.flatMap((teacher) => {
      if (!teacher.email) return [];

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
