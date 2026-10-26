import { prismaAdmin } from "@/lib/db";

/**
 * The demo instructor's current `sessionVersion`, read from the row.
 *
 * `ensureDemoClassroom()` remembers the version it saw when the process first
 * built the classroom. Anything that bumps the version later (an admin forcing
 * a sign-out) would leave that copy stale, and a cookie signed with it would be
 * refused by `getSession` at once. So the sign-in route reads the row each time.
 * The sign-in route has no session, so this goes through `prismaAdmin`.
 */
export async function readDemoInstructorSessionVersion(instructorId: string): Promise<number> {
  const instructor = await prismaAdmin.student.findUnique({
    where: { id: instructorId },
    select: { sessionVersion: true },
  });
  if (!instructor) {
    throw new Error("The demo instructor row is missing");
  }
  return instructor.sessionVersion;
}
