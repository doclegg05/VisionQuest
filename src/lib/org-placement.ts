import { prismaAdmin } from "@/lib/db";
import { forbidden, notFound, type Session } from "@/lib/api-error";
import { tryLogAuditEvent } from "@/lib/audit";
import { seesWholeState } from "@/lib/org-roles";
import { coordinatorHasRegion } from "@/lib/region";

/**
 * Who has not been placed in the organization tree yet.
 *
 * An instructor is unplaced when they have no region and no class. An
 * applicant is waiting when their account has no enrollment that is not
 * archived. Both lists are for admins and program coordinators.
 *
 * These reads use `prismaAdmin` on purpose. An unplaced instructor has no class,
 * and a waiting applicant has no enrollment, so under RLS no one in the tree
 * can see either row. Every function checks the caller's role first, in the
 * same function, and every query has an explicit filter and a field list.
 */

export interface UnplacedStaffRow {
  id: string;
  displayName: string;
  role: string;
  createdAt: Date;
}

export interface WaitingApplicantRow {
  id: string;
  displayName: string;
  county: string | null;
  createdAt: Date;
}

const UNPLACED_WHERE = {
  role: "teacher",
  instructorRegions: { none: {} },
  instructedClasses: { none: {} },
} as const;

/**
 * A teacher with no `RegionInstructor` row and no class assignment.
 *
 * Callers pass the session's own id only. This reads through `prismaAdmin`
 * with no role check, so it must never take an id from a request.
 */
export async function isUnplacedInstructor(staffId: string): Promise<boolean> {
  const row = await prismaAdmin.student.findFirst({
    where: { id: staffId, ...UNPLACED_WHERE },
    select: { id: true },
  });
  return row !== null;
}

function assertWholeState(actor: Session): void {
  if (!seesWholeState(actor.role)) throw forbidden();
}

export async function listUnplacedStaff(actor: Session): Promise<UnplacedStaffRow[]> {
  assertWholeState(actor);
  return prismaAdmin.student.findMany({
    where: { ...UNPLACED_WHERE },
    select: { id: true, displayName: true, role: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
}

/** Students with no enrollment that is not archived. */
export async function listApplicantsWaiting(actor: Session): Promise<WaitingApplicantRow[]> {
  assertWholeState(actor);
  const rows = await prismaAdmin.student.findMany({
    where: { role: "student", classEnrollments: { none: { status: { not: "archived" } } } },
    select: { id: true, displayName: true, createdAt: true, spokesRecord: { select: { county: true } } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((row) => ({
    id: row.id,
    displayName: row.displayName,
    county: row.spokesRecord?.county ?? null,
    createdAt: row.createdAt,
  }));
}

export interface UnregionedClassRow {
  id: string;
  name: string;
  instructorCount: number;
  activeStudents: number;
}

/**
 * Classes that are not archived and have no region. A regional coordinator
 * cannot see them, so they wait here for an admin to give them a region.
 */
export async function listUnregionedClasses(actor: Session): Promise<UnregionedClassRow[]> {
  assertWholeState(actor);
  const rows = await prismaAdmin.spokesClass.findMany({
    where: { regionId: null, status: { not: "archived" } },
    select: {
      id: true,
      name: true,
      _count: { select: { instructors: true, enrollments: { where: { status: "active" } } } },
    },
    orderBy: { name: "asc" },
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    instructorCount: row._count.instructors,
    activeStudents: row._count.enrollments,
  }));
}

/** Admins and program coordinators may assign any region; a regional coordinator only their own. */
async function assertMayAssign(actor: Session, regionId: string): Promise<void> {
  // Whole-state roles, or a regional coordinator (program coordinators are whole-state).
  if (!seesWholeState(actor.role) && actor.role !== "coordinator") throw forbidden();
  if (!(await coordinatorHasRegion(actor, regionId))) throw forbidden("That region is not yours to assign.");
}

/**
 * A regional coordinator may place only an instructor who is unplaced or
 * already in one of their own regions, so they cannot pull another region's
 * instructor into theirs. Whole-state callers may place any instructor.
 */
function placeableBy(actor: Session) {
  if (seesWholeState(actor.role)) return {};
  return {
    OR: [
      { instructorRegions: { none: {} }, instructedClasses: { none: {} } },
      { instructorRegions: { some: { region: { coordinators: { some: { coordinatorId: actor.id } } } } } },
    ],
  };
}

async function requireInstructor(actor: Session, instructorId: string): Promise<void> {
  const row = await prismaAdmin.student.findFirst({
    where: { id: instructorId, role: "teacher", ...placeableBy(actor) },
    select: { id: true },
  });
  if (!row) throw notFound("Instructor not found.");
}

export async function assignInstructorRegion(
  actor: Session,
  input: { instructorId: string; regionId: string },
): Promise<void> {
  await assertMayAssign(actor, input.regionId);
  await requireInstructor(actor, input.instructorId);

  await prismaAdmin.regionInstructor.upsert({
    where: { regionId_instructorId: { regionId: input.regionId, instructorId: input.instructorId } },
    create: { regionId: input.regionId, instructorId: input.instructorId, assignedById: actor.id },
    update: {},
  });

  await tryLogAuditEvent({
    actorId: actor.id,
    actorRole: actor.role,
    action: "org_placement.assign_region",
    targetType: "student",
    targetId: input.instructorId,
    summary: "Assigned an instructor to a region.",
    metadata: { regionId: input.regionId },
  });
}

/** Removes an instructor from a region. Same authority as assigning. */
export async function removeInstructorRegion(
  actor: Session,
  input: { instructorId: string; regionId: string },
): Promise<void> {
  await assertMayAssign(actor, input.regionId);
  await prismaAdmin.regionInstructor.deleteMany({
    where: { regionId: input.regionId, instructorId: input.instructorId },
  });

  await tryLogAuditEvent({
    actorId: actor.id,
    actorRole: actor.role,
    action: "org_placement.remove_region",
    targetType: "student",
    targetId: input.instructorId,
    summary: "Removed an instructor from a region.",
    metadata: { regionId: input.regionId },
  });
}
