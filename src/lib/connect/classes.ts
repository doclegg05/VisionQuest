// =============================================================================
// "Whose classes are these?" — for the Connect surfaces only.
//
// Match & Connect Phase 3. This deliberately answers the question NARROWLY
// than `src/lib/classroom.ts` does, and the difference is load-bearing:
//
//   `canManageAnyClass` admits admin, teacher AND coordinator, so
//   `listManagedClasses` returns every class in the program to a plain
//   teacher. That is the repo's settled intent for classroom administration.
//
//   `job_lead_write`, the RLS policy this phase added, admits a teacher only
//   for `instructor_class_ids()` — the classes they actually instruct. So on
//   the Connect surfaces the app must ask the same question the database will,
//   or a teacher gets offered a class in a picker and then a policy rejection
//   on submit, which reads as a bug rather than a boundary.
//
// Admin stays unrestricted, as everywhere else in this schema.
// =============================================================================

import type { Session } from "@/lib/api-error";
import { notFound } from "@/lib/api-error";
import { NON_ARCHIVED_ENROLLMENT_STATUSES } from "@/lib/classroom";
import { prisma } from "@/lib/db";

/** The minimum a caller has to know about the actor to be scoped. */
export interface ClassActor {
  id: string;
  role: string;
}

/**
 * Enrollment statuses that still count as "in the program".
 *
 * The app-side mirror of `visionquest.active_enrolled_class_ids()` in
 * migration 20260905110000, and it must stay in step with it. `completed` is
 * included because a graduate IS the placement population — cutting them would
 * hide every class-scoped lead from exactly the students this feature exists
 * for. `withdrawn` is the status that ends access.
 *
 * Exported so the matcher and the WorkForce WV export share one list rather
 * than each re-typing the strings.
 */
export const ENROLLED_STATUSES = ["active", "completed"] as const;

/**
 * The Prisma filter for "a class this actor may write leads into".
 *
 * `instructors.some.instructorId` is the app expression of
 * `instructor_class_ids()`; the relation is `SpokesClass.instructors ->
 * SpokesClassInstructor.instructorId`.
 */
export function connectClassWhere(actor: ClassActor) {
  if (actor.role === "admin") return {};
  return { instructors: { some: { instructorId: actor.id } } };
}

/**
 * The classes a Connect surface may offer this actor — pickers, the export's
 * class selector, the board's listing source.
 *
 * NOT `listManagedClasses`: that one returns the whole program to a plain
 * teacher (see the module header), which would put another instructor's
 * classroom in a dropdown that the database will then refuse.
 *
 * `includeArchived` is for the WorkForce WV export, whose whole population is
 * students who have finished — an archived class is exactly the one a job
 * developer still needs to send out.
 */
export async function listConnectClasses(
  session: Session,
  options: { includeArchived?: boolean } = {},
) {
  return prisma.spokesClass.findMany({
    where: {
      ...(options.includeArchived ? {} : { status: { not: "archived" } }),
      ...connectClassWhere(session),
    },
    select: { id: true, name: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
}

/**
 * The caller may only attach a lead to a class they instruct.
 *
 * Runs BEFORE any write, so a teacher aiming at somebody else's classroom gets
 * a clear "that class wasn't found" instead of a policy rejection surfacing as
 * a 500. `job_lead_write`'s class clause is the floor underneath this; neither
 * is a substitute for the other.
 *
 * A null classId (program-wide) is always allowed: it is the default, and it
 * is what every backfilled Opportunity became.
 */
export async function assertClassIsManaged(
  classId: string | null | undefined,
  actor: ClassActor,
): Promise<void> {
  if (!classId) return;
  const spokesClass = await prisma.spokesClass.findFirst({
    where: { id: classId, ...connectClassWhere(actor) },
    select: { id: true },
  });
  // "Not found", not "forbidden": a caller should not learn that a class they
  // cannot touch exists.
  if (!spokesClass) throw notFound("That class wasn't found.");
}

/**
 * The student ids a Connect REPORTING surface (the funnel, the DoHS export)
 * may aggregate over — mirrors `managed_student_ids()`, the Postgres
 * function `Connection`/`SpokesRecord`/`Application` RLS actually calls, NOT
 * `classroom.ts`'s `listManagedStudentIds`.
 *
 * That distinction is load-bearing (SEC-W1, 2026-09 review): with no
 * `classId`, `listManagedStudentIds`'s `canManageAny && !classId` branch
 * returns EVERY student in the program to any teacher — the intentional
 * "single staff workspace" convention for classroom-administration surfaces
 * (intervention queue, grant-KPI, readiness reports). RLS still enforces the
 * true boundary underneath any query built from that list, but the app-level
 * filter being wider than what RLS actually admits means an EMPTY result and
 * a REFUSED result look identical from here — exactly the ambiguity
 * `assertClassIsManaged` exists to remove for the classId case. This
 * function removes it for the "no classId, plain teacher" case too, by
 * asking the real question up front instead of relying on RLS to quietly
 * discard rows the app never should have queried for.
 *
 * Status list is `NON_ARCHIVED_ENROLLMENT_STATUSES` (`classroom.ts`), not
 * this module's own `ENROLLED_STATUSES` — that one is Connect-matching
 * eligibility ("in the program to be matched against a lead"), a narrower,
 * different question. `managed_student_ids()`'s SQL admits
 * `('active','inactive','completed','withdrawn')`, which is exactly
 * `NON_ARCHIVED_ENROLLMENT_STATUSES`.
 */
export async function connectManagedStudentIds(
  actor: ClassActor,
  classId?: string,
): Promise<string[]> {
  const isAdmin = actor.role === "admin";

  if (isAdmin && !classId) {
    const students = await prisma.student.findMany({
      where: { role: "student" },
      select: { id: true },
    });
    return students.map((student) => student.id);
  }

  const students = await prisma.student.findMany({
    where: {
      role: "student",
      classEnrollments: {
        some: {
          ...(classId ? { classId } : {}),
          status: { in: [...NON_ARCHIVED_ENROLLMENT_STATUSES] },
          ...(isAdmin ? {} : { class: { instructors: { some: { instructorId: actor.id } } } }),
        },
      },
    },
    select: { id: true },
  });
  return students.map((student) => student.id);
}
