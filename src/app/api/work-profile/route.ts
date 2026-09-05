import { NextResponse } from "next/server";

import { forbidden, withAuth, type Session } from "@/lib/api-error";
import {
  getWorkProfile,
  upsertWorkProfile,
  workProfileInputSchema,
} from "@/lib/connect/work-profile";
import { parseBody } from "@/lib/schemas";

/**
 * The student's own work profile — the form fallback for Sage's five-question
 * intake (Match & Connect Task 2.2). Backs the "Work availability" section in
 * Settings.
 *
 * Always scoped to `session.id`. The Zod schema is `.strict()`, so a payload
 * carrying `studentId` or `updatedVia` is a 400 rather than a silently ignored
 * field: a client that tries to write someone else's row finds out. RLS is the
 * second line — `withAuth` runs the handler inside withRlsContext, and the
 * StudentWorkProfile policy admits only the student's own row (plus their
 * instructors).
 *
 * Teachers read a student's profile through the student-detail route, which
 * already audits the read; this endpoint is the student's own surface and
 * refuses staff outright rather than creating a work profile on a staff row.
 */

function requireStudent(session: Session): void {
  if (session.role !== "student") {
    throw forbidden("Only students have a work profile.");
  }
}

export const GET = withAuth(async (session: Session) => {
  requireStudent(session);
  const workProfile = await getWorkProfile(session.id);
  return NextResponse.json({ workProfile });
});

export const PUT = withAuth(async (session: Session, req: Request) => {
  requireStudent(session);
  const body = await parseBody(req, workProfileInputSchema);
  const workProfile = await upsertWorkProfile(session.id, body, "student");
  return NextResponse.json({ workProfile });
});
