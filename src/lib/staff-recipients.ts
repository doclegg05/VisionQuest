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
export const MANAGED_ENROLLMENT_STATUSES = [
  "active",
  "inactive",
  "completed",
  "withdrawn",
] as const;

/**
 * The unique, active instructor accounts assigned to the classes a student is
 * (non-archived) enrolled in. Returns [] when none resolve.
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
    },
    select: {
      class: {
        select: {
          instructors: {
            select: {
              instructor: {
                select: { id: true, email: true, displayName: true, isActive: true },
              },
            },
          },
        },
      },
    },
  });

  const activeInstructors = enrollments
    .flatMap((enrollment) => enrollment.class.instructors)
    .map((link) => link.instructor)
    .filter((instructor) => instructor.isActive);

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
