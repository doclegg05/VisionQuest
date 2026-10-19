import { logAuditEvent } from "@/lib/audit";
import { invalidateChatContext } from "@/lib/cache";
import { prismaAdmin } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { ensureDemoClassroom } from "./bootstrap";
import { getDemoLimits } from "./config";
import { DEMO_LIMIT_DAILY, DEMO_LIMIT_HOURLY, DEMO_LIMIT_NETWORK } from "./copy";
import { makeDemoLogin, makeDemoStudentName } from "./names";

/**
 * Makes one fresh demo student for a visitor, unless a limit says no.
 *
 * The sign-in route that calls this has no session, so every database call goes
 * through `prismaAdmin`; the app client would see no rows under RLS.
 *
 * The site-wide limits are counted from the Student table, never from
 * `rateLimit`. That limiter fails open when its store is degraded
 * (src/lib/rate-limit.ts), and a limit that disappears when the database has a
 * bad moment is not a limit. The per-network check does use it, and is only a
 * speed bump: the caller chooses the address it counts (src/lib/client-ip.ts).
 */

export type DemoStudentResult =
  | {
      kind: "created";
      student: { id: string; studentId: string; displayName: string; sessionVersion: number };
    }
  | { kind: "limited"; message: string };

const ONE_HOUR_MS = 3_600_000;

function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function countDemoStudentsSince(since: Date): Promise<number> {
  return prismaAdmin.student.count({ where: { demoAccount: "student", createdAt: { gte: since } } });
}

/**
 * The message for the first limit that refuses a new student, or null when all
 * three allow one. In order: this network, the site this hour, the site today.
 */
async function refusalFor(networkKey: string, now: Date): Promise<string | null> {
  const limits = getDemoLimits();

  const network = await rateLimit(`demo-student:${networkKey}`, limits.perNetworkHourly, ONE_HOUR_MS);
  if (!network.success) return DEMO_LIMIT_NETWORK;

  const lastHour = await countDemoStudentsSince(new Date(now.getTime() - ONE_HOUR_MS));
  if (lastHour >= limits.siteHourly) return DEMO_LIMIT_HOURLY;

  const today = await countDemoStudentsSince(startOfUtcDay(now));
  if (today >= limits.siteDaily) return DEMO_LIMIT_DAILY;

  return null;
}

/**
 * Writes the student and its enrollment together, so a failure part way leaves
 * no student without a class. The number in the display name counts every demo
 * student, starters included, which keeps two visitors who draw the same names
 * apart on the instructor's roster.
 */
async function insertStudent(classId: string) {
  const sequence = (await prismaAdmin.student.count({ where: { demoAccount: "student" } })) + 1;

  return prismaAdmin.$transaction(async (tx) => {
    const student = await tx.student.create({
      data: {
        studentId: makeDemoLogin(),
        displayName: makeDemoStudentName(sequence),
        role: "student",
        demoAccount: "student",
      },
      select: { id: true, studentId: true, displayName: true, sessionVersion: true },
    });
    await tx.studentClassEnrollment.create({
      data: { classId, studentId: student.id, status: "active" },
    });
    return student;
  });
}

export async function createDemoStudent(networkKey: string, now: Date = new Date()): Promise<DemoStudentResult> {
  const message = await refusalFor(networkKey, now);
  if (message !== null) return { kind: "limited", message };

  // A rejection here is left to the caller, whose error handler answers a
  // generic 500. It is never retried and never logged with the clashing id.
  const { classId } = await ensureDemoClassroom();
  const student = await insertStudent(classId);

  // `prismaAdmin` has no chat-context write-through (see its doc block in
  // db.ts), so the new student's cached Sage context is dropped by hand once
  // the rows are committed.
  invalidateChatContext(student.id);

  await logAuditEvent({
    actorId: student.id,
    actorRole: "student",
    action: "demo.student.create",
    targetType: "student",
    targetId: student.id,
    summary: "Demo student created.",
  });

  return { kind: "created", student };
}
