import { prisma, prismaAdmin } from "@/lib/db";
import { badRequest, conflict, forbidden, type Session } from "@/lib/api-error";
import { listInstructorRegionIds } from "@/lib/region";
import { seesWholeState } from "@/lib/org-roles";

/**
 * Whether a session may put a classroom in this region. Whole-state roles may
 * use any active region; anyone else only a region they instruct in. Shared by
 * class creation and the class PATCH, so moving a class follows the same rule
 * as creating one.
 */
export async function assertRegionAllowed(session: Session, regionId: string): Promise<void> {
  if (!seesWholeState(session.role)) {
    const ownRegionIds = await listInstructorRegionIds(session.id);
    if (ownRegionIds.length === 0) {
      throw forbidden(
        "Ask your regional coordinator to add you to a region before creating a classroom.",
      );
    }
    if (!ownRegionIds.includes(regionId)) {
      throw forbidden("You can put classrooms only in your own region.");
    }
  }
  const region = await prisma.region.findUnique({
    where: { id: regionId },
    select: { id: true, status: true },
  });
  if (!region) throw badRequest("That region does not exist.");
  if (region.status !== "active") throw badRequest("Cannot assign a class to an archived region.");
}

export interface NewClassInput {
  name: string;
  code: string;
  programType: string;
  regionId: string;
  description: string | null;
  startDate: Date | null;
  endDate: Date | null;
  createdById: string;
  instructorIds: string[];
}

/**
 * Inserts a class and its instructor rows through `prismaAdmin`, in one
 * transaction (Ruling R19). Call it only after the route's own checks (region,
 * self included, co-teachers in region, assignment limit): those checks are the
 * only gate for this insert.
 *
 * Why not the RLS client: `spokes_class_access` WITH CHECK admits a teacher's
 * insert only for a class in `instructor_class_ids(me)`, which needs a
 * SpokesClassInstructor row that cannot exist before the class does. The code
 * check reads every class for the same reason: RLS would hide a code another
 * instructor already uses and the insert would fail on the unique index.
 * `src/lib/org-tree-rls.test.ts` pins the refusal.
 */
export async function createClassWithInstructors(input: NewClassInput) {
  return prismaAdmin.$transaction(async (tx) => {
    const existing = await tx.spokesClass.findUnique({
      where: { code: input.code },
      select: { id: true },
    });
    if (existing) throw conflict("That class code is already in use.");

    const created = await tx.spokesClass.create({
      data: {
        name: input.name,
        code: input.code,
        programType: input.programType,
        regionId: input.regionId,
        description: input.description,
        startDate: input.startDate,
        endDate: input.endDate,
        createdById: input.createdById,
      },
      select: { id: true, name: true, code: true, status: true, programType: true, regionId: true },
    });
    if (input.instructorIds.length > 0) {
      await tx.spokesClassInstructor.createMany({
        data: input.instructorIds.map((instructorId) => ({ classId: created.id, instructorId })),
      });
    }
    return created;
  });
}
