/**
 * F2: a student's write clears that student's cached dashboard reads, through
 * the REAL write-through extension on `prisma` (src/lib/db.ts), not a mock.
 * The engine transport is stubbed (./engine-stub.test-support.ts), so no
 * database is needed and every extension runs as in production.
 */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";
import type { EngineCall } from "./engine-stub.test-support";

process.env.DATABASE_URL ??= "postgresql://stub:stub@127.0.0.1:1/stub";
process.env.ADMIN_DATABASE_URL ??= process.env.DATABASE_URL;

const A = { id: "cwritethroughaaaaaaaaaaa1", role: "student" };
const B = { id: "cwritethroughbbbbbbbbbbbb2", role: "student" };

let db: typeof import("@/lib/db");
let signals: typeof import("./signals");
let rls: typeof import("@/lib/rls-context");
let cache: typeof import("@/lib/cache");
let calls: EngineCall[];

function answer(call: EngineCall): unknown {
  if (call.action === "executeRaw") return 1;
  if (call.action === "aggregate") return { _count: { _all: 1 } };
  if (call.action === "findUnique" && call.modelName === "Progression") return { state: "{}" };
  if (call.action === "createOne" && call.modelName === "Goal") return { id: "goal-1", studentId: A.id };
  if (call.action === "updateOne" && call.modelName === "Progression") return { id: "prog-1", studentId: A.id };
  if (call.action === "createOne" && call.modelName === "StudentTask") return { id: "task-1", studentId: A.id };
  return undefined;
}

const asStudent = <T>(session: { id: string }, work: () => Promise<T>) =>
  rls.withRlsContext({ userId: session.id, role: "student", studentId: session.id }, work);
/** Engine reads a shell read makes; 0 means it was served from the cache. */
async function shellReads(session: { id: string; role: string }): Promise<number> {
  const before = calls.length;
  await asStudent(session, () => signals.getStudentShell(session));
  return calls.slice(before).filter((call) => call.action !== "executeRaw").length;
}

before(async () => {
  const { stubEngine } = await import("./engine-stub.test-support");
  db = await import("@/lib/db");
  signals = await import("./signals");
  rls = await import("@/lib/rls-context");
  cache = await import("@/lib/cache");
  calls = stubEngine(db.prisma, answer);
});
beforeEach(() => { cache.invalidateAllChatContext(); });

describe("dashboard shell cache, cleared by the real write-through", () => {
  it("serves a second read from the cache", async () => {
    assert.equal(await shellReads(A), 3);
    assert.equal(await shellReads(A), 0);
  });

  it("a Goal write through `prisma` clears the writing student's shell and no one else's", async () => {
    await shellReads(A); await shellReads(B);
    await asStudent(A, () => db.prisma.goal.create({ data: { studentId: A.id, level: "monthly", content: "Get a forklift license" } }));
    assert.equal(await shellReads(A), 3, "A's shell outlived A's goal write");
    assert.equal(await shellReads(B), 0, "B's shell was cleared by A's write");
  });

  it("a write inside `prisma.$transaction` clears it too", async () => {
    await shellReads(A);
    await asStudent(A, () => db.prisma.$transaction(async (tx) =>
      tx.progression.update({ where: { studentId: A.id }, data: { state: "{}" } })));
    assert.equal(await shellReads(A), 3);
  });

  it("a `withAppTransaction` write skips the write-through, which is why tasks are never cached", async () => {
    await shellReads(A);
    await asStudent(A, () => db.withAppTransaction((tx) =>
      tx.studentTask.create({ data: { studentId: A.id, createdById: A.id, title: "Call the clinic" } })));
    assert.equal(await shellReads(A), 0);
  });
});
