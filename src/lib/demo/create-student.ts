import type { Prisma } from "@prisma/client";
import { tryLogAuditEvent } from "@/lib/audit";
import { invalidateChatContext } from "@/lib/cache";
import { prismaAdmin } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { ensureDemoClassroom } from "./bootstrap";
import { getDemoLimits, type DemoLimits } from "./config";
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
 *
 * The caps are checked twice. A cheap pre-check comes first, so a visitor who
 * will be refused never starts the bootstrap. It reads with no lock, though, so
 * a burst of requests can all read the same count before any of them commits.
 * The second check runs inside the transaction that creates the student, after
 * taking `DEMO_STUDENT_CREATE_LOCK`: one request at a time counts and inserts,
 * so the caps hold however many arrive together.
 */

export type DemoStudentResult =
  | {
      kind: "created";
      student: { id: string; studentId: string; displayName: string; sessionVersion: number };
    }
  | { kind: "limited"; message: string };

/**
 * The Postgres advisory lock that serializes demo student creation. Whoever
 * holds it is the only request counting the demo students and inserting the
 * next one. It is a transaction lock, so Postgres drops it when the transaction
 * commits or rolls back, and there is no unlock to forget.
 *
 * Advisory locks share one flat keyspace per form. The repo's other
 * single-key lock, in src/lib/sage/memory/store.ts, uses `hashtext(...)`, which
 * only returns values inside the 32-bit range, and its two-key locks
 * (src/lib/nudges/sms-policy-shared.ts) are a separate keyspace. This key is
 * above the 32-bit range, so none of them can ever equal it.
 */
export const DEMO_STUDENT_CREATE_LOCK = 2_610_190_001;

const ONE_HOUR_MS = 3_600_000;

function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** What the cap checks need: the app's admin client, or a transaction on it. */
type StudentCounter = Pick<Prisma.TransactionClient, "student">;

function countDemoStudentsSince(client: StudentCounter, since: Date): Promise<number> {
  return client.student.count({ where: { demoAccount: "student", createdAt: { gte: since } } });
}

/**
 * The message for the first site-wide cap that is full, or null when there is
 * room: this hour first, then today. Counted from the database.
 */
async function siteCapRefusal(client: StudentCounter, limits: DemoLimits, now: Date): Promise<string | null> {
  const lastHour = await countDemoStudentsSince(client, new Date(now.getTime() - ONE_HOUR_MS));
  if (lastHour >= limits.siteHourly) return DEMO_LIMIT_HOURLY;

  const today = await countDemoStudentsSince(client, startOfUtcDay(now));
  if (today >= limits.siteDaily) return DEMO_LIMIT_DAILY;

  return null;
}

/**
 * Takes the creation lock, checks the caps again, and only then numbers and
 * writes the student and its enrollment together, so a failure part way leaves
 * no student without a class.
 *
 * A full cap returns before anything is written, so there is nothing to undo:
 * the transaction ends empty and the lock goes with it. The number in the
 * display name counts every demo student, starters included, which keeps two
 * visitors who draw the same names apart on the instructor's roster. It is read
 * under the lock, so two visitors never get the same number.
 */
async function insertStudent(classId: string, limits: DemoLimits, now: Date): Promise<DemoStudentResult> {
  return prismaAdmin.$transaction(async (tx): Promise<DemoStudentResult> => {
    // `::bigint` keeps the bound value a number Postgres can match to the
    // one-key form of the lock, whatever type the driver sends it as.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${DEMO_STUDENT_CREATE_LOCK}::bigint)`;

    const message = await siteCapRefusal(tx, limits, now);
    if (message !== null) return { kind: "limited", message };

    const sequence = (await tx.student.count({ where: { demoAccount: "student" } })) + 1;
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
    return { kind: "created", student };
  });
}

export async function createDemoStudent(networkKey: string, now: Date = new Date()): Promise<DemoStudentResult> {
  const limits = getDemoLimits();

  const network = await rateLimit(`demo-student:${networkKey}`, limits.perNetworkHourly, ONE_HOUR_MS);
  if (!network.success) return { kind: "limited", message: DEMO_LIMIT_NETWORK };

  const early = await siteCapRefusal(prismaAdmin, limits, now);
  if (early !== null) return { kind: "limited", message: early };

  // A rejection here is left to the caller, whose error handler answers a
  // generic 500. It is never retried and never logged with the clashing id.
  const { classId } = await ensureDemoClassroom();
  const result = await insertStudent(classId, limits, now);
  if (result.kind === "limited") return result;

  const { student } = result;

  // `prismaAdmin` has no chat-context write-through (see its doc block in
  // db.ts), so the new student's cached Sage context is dropped by hand once
  // the rows are committed.
  invalidateChatContext(student.id);

  // A failed audit write is logged by `tryLogAuditEvent` and must not turn a
  // student that now exists into a 500, so the result is not checked.
  await tryLogAuditEvent({
    actorId: student.id,
    actorRole: "student",
    action: "demo.student.create",
    targetType: "student",
    targetId: student.id,
    summary: "Demo student created.",
  });

  return result;
}
