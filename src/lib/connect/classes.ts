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
