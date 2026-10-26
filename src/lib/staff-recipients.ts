import { isStaffRole } from "./api-error";
import { prismaAdmin } from "./db";

/**
 * Staff identities that receive an in-app notification (and, when mail is
 * configured, an email) about one student.
 *
 * Both queries below run on `prismaAdmin` deliberately. Their callers reach
 * them from inside a STUDENT's RLS context — `syncStudentAlerts` on student
 * routes, the chat/mood crisis path — where the app client returns zero staff
 * rows and `notification_access` WITH CHECK rejects a Notification addressed
 * to a teacher. Only staff identities are read here; a student's own rows
 * stay on the app client. If `ADMIN_DATABASE_URL` is unset, `prismaAdmin`
 * degrades to `vq_app` and both queries return [] (F63) — the callers'
 * empty-recipient alarms are the signal for that.
 */
export interface StaffRecipient {
  id: string;
  email: string | null;
  displayName: string;
}

/**
 * Enrollment statuses under which a class instructor still "manages" the
 * student. Mirrors NON_ARCHIVED_ENROLLMENT_STATUSES in src/lib/classroom.ts —
 * kept local so this module stays dependency-light for the safety-critical
 * callers. If the two ever drift, the failure mode is resolving fewer
 * (possibly zero) instructors, which every caller answers by falling back to
 * all active teachers: the safe direction.
 */
/** A class in this status no longer makes its instructors the student's. */
const ARCHIVED_CLASS_STATUS = "archived";

export const MANAGED_ENROLLMENT_STATUSES = [
  "active",
  "inactive",
  "completed",
  "withdrawn",
] as const;

/**
 * The unique, active, STAFF instructor accounts assigned to the non-archived
 * classes a student is (non-archived) enrolled in. Returns [] when none
 * resolve.
 *
 * Three filters, and each one is a gate rather than an optimisation:
 *
 *   isActive            a deactivated account is not a person to notify.
 *   isStaffRole         W2 (2026-09-07 audit): SpokesClassInstructor has no
 *                       role constraint, so a coordinator — or any non-staff
 *                       account — can be linked as an instructor.
 *                       `assertStaffRecipient` in notifications.ts refuses
 *                       exactly `teacher | admin` on the admin client, so
 *                       resolving anyone else produces a recipient whose
 *                       in-app write throws while the callers' email loops
 *                       would still mail a body naming the student. The same
 *                       predicate is imported rather than a second list
 *                       written here, so the two can never disagree.
 *   class not archived  S1: an instructor whose only link to this student is
 *                       an archived cohort is not their instructor any more.
 *                       region-rollup.ts and classroom.ts both draw the line
 *                       here.
 *
 * The filters are applied in JavaScript, over a `where` that already narrows
 * the same three things. The duplication is deliberate: the `where` keeps the
 * query small, and the JS pass is the enforced gate, so the behaviour is
 * provable against a mocked client as well as a real one. Drift can only make
 * this resolve FEWER instructors, which every caller answers by falling back
 * to all active teachers — the safe direction.
 *
 * Throws rather than swallowing: under a student's RLS context this join
 * raises Prisma's inconsistency error instead of returning zero rows, and a
 * caller must be able to tell "nobody is assigned" from "the lookup broke".
 * Every caller catches and falls back program-wide.
 */
export async function findAssignedInstructors(studentId: string): Promise<StaffRecipient[]> {
  const enrollments = await prismaAdmin.studentClassEnrollment.findMany({
    where: {
      studentId,
      status: { in: [...MANAGED_ENROLLMENT_STATUSES] },
      class: { status: { not: ARCHIVED_CLASS_STATUS } },
    },
    select: {
      class: {
        select: {
          status: true,
          instructors: {
            select: {
              instructor: {
                select: {
                  id: true,
                  email: true,
                  displayName: true,
                  isActive: true,
                  role: true,
                },
              },
            },
          },
        },
      },
    },
  });

  const activeInstructors = enrollments
    .filter((enrollment) => enrollment.class.status !== ARCHIVED_CLASS_STATUS)
    .flatMap((enrollment) => enrollment.class.instructors)
    .map((link) => link.instructor)
    .filter((instructor) => instructor.isActive && isStaffRole(instructor.role));

  return [
    ...new Map(
      activeInstructors.map((instructor): [string, StaffRecipient] => [
        instructor.id,
        {
          id: instructor.id,
          email: instructor.email,
          displayName: instructor.displayName,
        },
      ]),
    ).values(),
  ];
}

/**
 * Every active teacher account, program-wide. The fallback audience: broader
 * than any one student's instructors, so it is only ever reached when
 * assigned-instructor resolution returns nothing or fails.
 */
export async function listActiveTeachers(): Promise<StaffRecipient[]> {
  return prismaAdmin.student.findMany({
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
}
