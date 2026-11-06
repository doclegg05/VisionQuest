import { NextResponse } from "next/server";
import { z } from "zod";
import { forbidden, withAuth, type Session } from "@/lib/api-error";
import { assignInstructorRegion, removeInstructorRegion } from "@/lib/org-placement";
import { seesWholeState } from "@/lib/org-roles";
import { parseBody } from "@/lib/schemas";

const regionInstructorSchema = z.object({
  instructorId: z.string().cuid("Pick an instructor."),
  regionId: z.string().cuid("Pick a region."),
});

// Admins and program coordinators may use any region. A regional coordinator
// may use their own; the library checks that against live RegionCoordinator rows.
function assertMayPlace(session: Session): void {
  // Whole-state roles, or a regional coordinator (program coordinators are whole-state).
  if (!seesWholeState(session.role) && session.role !== "coordinator") throw forbidden();
}

export const POST = withAuth(async (session, req: Request) => {
  assertMayPlace(session);
  const body = await parseBody(req, regionInstructorSchema);
  await assignInstructorRegion(session, body);
  return NextResponse.json({ success: true, data: { assigned: true } });
});

export const DELETE = withAuth(async (session, req: Request) => {
  assertMayPlace(session);
  const body = await parseBody(req, regionInstructorSchema);
  await removeInstructorRegion(session, body);
  return NextResponse.json({ success: true, data: { removed: true } });
});
