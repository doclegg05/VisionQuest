import { prismaAdmin } from "@/lib/db";
import { isStaffRole, type Session } from "@/lib/api-error";
import { canPerformElevatedStaffAction } from "@/lib/classroom";

/**
 * Region-scoped forms rollup for the coordinator dashboard.
 *
 * WHY prismaAdmin, and why this module does not call region.ts
 * ------------------------------------------------------------
 * `rlsContextFor` (src/lib/api-error.ts) collapses a coordinator session to
 * RLS role "student" with the coordinator's own id — coordinator policies do
 * not exist yet (Slice D). Under that context every table this rollup needs
 * is blind to a real coordinator:
 *
 *   RegionCoordinator  → `region_coordinator_admin_only` (admin only)
 *   SpokesClass        → `spokes_class_access` (admin, own-enrollment, or
 *                         instructing teacher — a coordinator is none of them)
 *   FormResponse       → `form_response_access` (own rows, managed students,
 *                         or admin)
 *
 * So `coordinatorHasRegion` and `classIdsInRegion` in src/lib/region.ts,
 * which both run on the app client, return false/[] for every real
 * coordinator — the reason the whole dashboard is dark for them today. This
 * module therefore reads through `prismaAdmin` and enforces the scope in the
 * query instead of relying on RLS to enforce it.
 *
 * The invariant that makes that safe, and which every function here must
 * keep: **no read is wider than one named region**. The caller supplies a
 * regionId, `coordinatorCanReadRegion` proves this session is assigned to
 * exactly that region, and every subsequent clause is bounded by that
 * region's classes. Nothing here takes a caller-supplied class or student id,
 * and nothing returns an individual student's answers — only counts. Adding a
 * per-student row to this module would be a different privacy decision and
 * belongs on the admin export route, which is gated by
 * `canPerformElevatedStaffAction` and is deliberately left alone.
 *
 * If `ADMIN_DATABASE_URL` is unset, `prismaAdmin` degrades to `vq_app` (F63)
 * and every count here returns 0 rather than leaking — fail-closed, and the
 * same blindness the app client already has.
 */

export interface RegionFormTemplateRow {
  templateId: string;
  title: string;
  isOfficial: boolean;
  /** Assignments targeting this region's classes, or its students directly. */
  assignmentCount: number;
  /** Submitted or reviewed responses from students enrolled in this region. */
  responseCount: number;
  /** responseCount / studentCount, or null when the region has no students. */
  completionRate: number | null;
}

export interface RegionFormRollup {
  regionId: string;
  classCount: number;
  studentCount: number;
  templates: RegionFormTemplateRow[];
}

/**
 * Is this session allowed to read the named region?
 *
 * Admin: any region that exists. Coordinator: only a region they hold a
 * RegionCoordinator row for. Everyone else: no — the route's
 * `withCoordinatorAuth` wrapper has already refused them, and this is the
 * second, fail-closed answer rather than an assumption that it did.
 *
 * Mirrors `coordinatorHasRegion` (src/lib/region.ts) exactly, on the admin
 * client, for the reason in this module's header. The lookup is keyed by
 * (regionId, session.id): it can only ever answer a question about the
 * caller's own assignment, never widen one.
 */
export async function coordinatorCanReadRegion(
  session: Session,
  regionId: string,
): Promise<boolean> {
  if (session.role === "admin") {
    const exists = await prismaAdmin.region.count({ where: { id: regionId } });
    return exists > 0;
  }
  if (session.role !== "coordinator") return false;

  const row = await prismaAdmin.regionCoordinator.findUnique({
    where: { regionId_coordinatorId: { regionId, coordinatorId: session.id } },
    select: { regionId: true },
  });
  return Boolean(row);
}

/**
 * Non-archived class ids in the region. Mirrors `classIdsInRegion`
 * (src/lib/region.ts) on the admin client — same filter, same exclusion of
 * archived classes, so the coordinator's forms numbers and their rollup
 * numbers describe the same set of classes.
 */
async function regionClassIds(regionId: string): Promise<string[]> {
  const rows = await prismaAdmin.spokesClass.findMany({
    where: { regionId, status: { not: "archived" } },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

/**
 * Per-template completion counts for one region.
 *
 * Response counting deliberately includes students whose enrollment is no
 * longer active: a submitted official form is a record of something that
 * happened, and dropping it would silently shorten the coordinator's numbers
 * — the same reasoning the admin CSV export states for
 * `includeArchivedEnrollments`. `studentCount` is the region's ACTIVE roster,
 * so `completionRate` can exceed 1 for a template that outlived a cohort; the
 * two raw counts are returned alongside it so the reader can see why.
 */
export async function getRegionFormRollup(regionId: string): Promise<RegionFormRollup> {
  const classIds = await regionClassIds(regionId);

  if (classIds.length === 0) {
    return { regionId, classCount: 0, studentCount: 0, templates: [] };
  }

  const [templates, studentIds] = await Promise.all([
    prismaAdmin.formTemplate.findMany({
      where: { status: "active" },
      select: { id: true, title: true, isOfficial: true },
      orderBy: [{ isOfficial: "desc" }, { title: "asc" }],
    }),
    prismaAdmin.student
      .findMany({
        where: {
          role: "student",
          classEnrollments: { some: { classId: { in: classIds }, status: "active" } },
        },
        select: { id: true },
      })
      .then((rows) => rows.map((row) => row.id)),
  ]);

  const rows = await Promise.all(
    templates.map(async (template) => {
      const [assignmentCount, responseCount] = await Promise.all([
        prismaAdmin.formAssignment.count({
          where: {
            templateId: template.id,
            OR: [
              { scope: "class", targetId: { in: classIds } },
              { scope: "student", targetId: { in: studentIds } },
            ],
          },
        }),
        prismaAdmin.formResponse.count({
          where: {
            templateId: template.id,
            status: { in: ["submitted", "reviewed"] },
            // The region scope. Enrollment status is unfiltered here on
            // purpose (see the doc block); the CLASS set is what bounds it.
            student: { classEnrollments: { some: { classId: { in: classIds } } } },
          },
        }),
      ]);

      return {
        templateId: template.id,
        title: template.title,
        isOfficial: template.isOfficial,
        assignmentCount,
        responseCount,
        completionRate:
          studentIds.length === 0 ? null : Number((responseCount / studentIds.length).toFixed(3)),
      };
    }),
  );

  return {
    regionId,
    classCount: classIds.length,
    studentCount: studentIds.length,
    templates: rows,
  };
}

/**
 * Can this role actually reach the bulk form CSV at
 * /api/teacher/forms/[templateId]/export?
 *
 * That route composes TWO gates — `withTeacherAuth` (teacher or admin) and
 * `canPerformElevatedStaffAction` (admin or coordinator) — whose intersection
 * is admins. The coordinator panel asks this question instead of testing a
 * role string of its own, so the link cannot outlive the gate: if either gate
 * on the export route moves, this answer moves with it. A coordinator being
 * shown a link that 403s is the C7 defect, and a hardcoded `role === "admin"`
 * in the UI would only relocate it.
 */
export function canReachFormCsvExport(role: string): boolean {
  return isStaffRole(role) && canPerformElevatedStaffAction(role);
}
