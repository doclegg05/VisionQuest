import type { PrismaClient } from "@prisma/client";
import { DEMO_CLASS_CODE, DEMO_INSTRUCTOR_LOGIN, DEMO_STARTER_LOGIN_PREFIX } from "./config";

/** Owner-only, offline roster reset. Stop demo access on every server first.
 * Archive rather than delete: chats, files, goals and audit history survive.
 * A server restart on re-enabling demo mode clears the bootstrap cache and
 * creates four new starter students. Never expose this helper as a demo API.
 */
export async function resetDemoRoster(client: PrismaClient, options: { apply: boolean }) {
  return client.$transaction(async (tx) => {
    // Same lock as visitor creation. Serializable isolation also refuses a
    // concurrent enrollment edit rather than acting on a stale scope check.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${2_610_190_001}::bigint)`;
    const instructor = await tx.student.findUnique({
      where: { studentId: DEMO_INSTRUCTOR_LOGIN },
      select: { id: true, role: true, demoAccount: true },
    });
    const classroom = await tx.spokesClass.findUnique({
      where: { code: DEMO_CLASS_CODE }, select: { id: true, createdById: true },
    });
    if (!instructor && !classroom) return { students: 0, applied: false };
    if (!instructor || instructor.role !== "teacher" || instructor.demoAccount !== "instructor" ||
        !classroom || classroom.createdById !== instructor.id) {
      throw new Error("Demo classroom ownership check failed. No reset was applied.");
    }
    const students = await tx.student.findMany({
      where: {
        role: "student", demoAccount: "student",
        classEnrollments: { some: { classId: classroom.id } },
        OR: [{ isActive: true }, { studentId: { startsWith: DEMO_STARTER_LOGIN_PREFIX } }],
      },
      select: { id: true, studentId: true },
    });
    const ids = students.map((student) => student.id);
    const unsafeEnrollments = await tx.studentClassEnrollment.count({
      where: { OR: [
        { classId: classroom.id, student: { OR: [{ demoAccount: null }, { demoAccount: { not: "student" } }, { role: { not: "student" } }] } },
        { studentId: { in: ids }, classId: { not: classroom.id } },
      ] },
    });
    if (unsafeEnrollments) throw new Error("Demo roster overlaps another class or an unmarked account. No reset was applied.");
    if (!options.apply) return { students: ids.length, applied: false };
    await tx.studentClassEnrollment.updateMany({
      where: { classId: classroom.id, studentId: { in: ids }, student: { demoAccount: "student" } },
      data: { status: "archived", archivedAt: new Date(), archiveReason: "Owner reset of fictional demo roster" },
    });
    await tx.student.updateMany({
      where: { id: { in: ids }, role: "student", demoAccount: "student" },
      data: { isActive: false, sessionVersion: { increment: 1 } },
    });
    // Release just the starter login slots. Historical row IDs and all their
    // relations remain unchanged; bootstrap creates new starter rows later.
    for (const student of students.filter((row) => row.studentId.startsWith(DEMO_STARTER_LOGIN_PREFIX))) {
      await tx.student.update({
        where: { id: student.id, demoAccount: "student" },
        data: { studentId: `demo-archived-${student.id}` },
      });
    }
    await tx.student.update({
      where: { id: instructor.id, demoAccount: "instructor" },
      data: { sessionVersion: { increment: 1 } },
    });
    return { students: ids.length, applied: true };
  }, { isolationLevel: "Serializable", timeout: 30_000 });
}
