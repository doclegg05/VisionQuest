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
  if (call.action === "updateOne" && call.modelName === "OrientationItem") return { id: "item-1" };
  if (call.action === "createOne" && call.modelName === "Certification") return { id: "cert-1", studentId: A.id };
  if (call.action === "deleteMany" || call.action === "updateMany" || call.action === "createMany") return { count: 1 };
  if (call.action === "updateOne" && call.modelName === "CertRequirement") return { id: "req-1", certificationId: "cert-1" };
  // The slow signals' reads: nothing found, except the counts above (1 each),
  // which is enough for the read to count as having seen the student's rows.
  if (call.action === "findFirst" || call.action === "findUnique") return null;
  if (call.action === "findMany") return [];
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
  // The owner lookup for a CertRequirement write runs on the admin client.
  stubEngine(db.prismaAdmin, (call) =>
    call.action === "findMany" && call.modelName === "Certification" ? [{ studentId: A.id }] : answer(call));
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

describe("the page-render shell (readPageShell)", () => {
  it("reads fresh over a kept shell and keeps what it read for the polls", async () => {
    await shellReads(A);
    const before = calls.length;
    await asStudent(A, () => signals.readPageShell(A));
    assert.equal(calls.slice(before).filter((call) => call.action !== "executeRaw").length, 3, "the page was served a kept shell");
    assert.equal(await shellReads(A), 0, "the poll did not get the shell the page kept");
  });

  it("a Goal write that lands during the page's read leaves nothing pre-write kept", async () => {
    const held = holdNextEngineRequest();
    const page = asStudent(A, () => signals.readPageShell(A));
    await held.reached;
    await asStudent(A, () => db.prisma.goal.create({ data: { studentId: A.id, level: "monthly", content: "Book the GED test" } }));
    held.release();
    await page;
    assert.equal(await shellReads(A), 3, "a shell read that began before A's goal write was kept after it");
  });
});

describe("layout gate keys, cleared by the real write-through", () => {
  /** Plants a satisfied gate for A, runs `write`, and says whether the gate was read again. */
  async function gateReread(layer: string, write: () => Promise<unknown>): Promise<boolean> {
    const { studentCacheKey } = await import("./student-cache");
    const key = studentCacheKey(A, layer);
    await cache.cached(key, 600, async () => true);
    await asStudent(A, write);
    let reread = false;
    await cache.cached(key, 600, async () => { reread = true; return false; });
    return reread;
  }

  it("replacing the recovery answers clears the kept recovery gate", async () => {
    const reread = await gateReread("gate:recovery-questions", () => db.prisma.$transaction(async (tx) => {
      await tx.securityQuestionAnswer.deleteMany({ where: { studentId: A.id } });
      await tx.securityQuestionAnswer.createMany({ data: [{ studentId: A.id, questionKey: "first-job", answerHash: "h" }] });
    }));
    assert.equal(reread, true, "the recovery gate outlived a SecurityQuestionAnswer write");
  });

  it("revoking a consent clears the kept Sage notice gate", async () => {
    const reread = await gateReread("gate:sage-notice:v1", () => db.prisma.consentRecord.updateMany({
      where: { studentId: A.id, scope: "sage_notice:v1", revokedAt: null }, data: { revokedAt: new Date() },
    }));
    assert.equal(reread, true, "the Sage notice gate outlived a ConsentRecord write");
  });
});

describe("dashboard globals, cleared by the real write-through", () => {
  it("an OrientationItem write through `prisma` clears the kept orientation total", async () => {
    const { globalCacheKey } = await import("./student-cache");
    const key = globalCacheKey("orientation-item-count");
    await cache.cached(key, 600, async () => 8);
    await rls.withRlsContext({ userId: "admin-1", role: "admin", studentId: "" }, () =>
      db.prisma.orientationItem.update({ where: { id: "item-1" }, data: { label: "Sign the attendance policy" } }));
    let reread = false;
    await cache.cached(key, 600, async () => { reread = true; return 9; });
    assert.equal(reread, true, "the orientation total outlived an OrientationItem write");
  });
});

describe("kept slow signals, cleared by the real write-through", () => {
  /** Engine reads a slow-signal read makes; 0 means it was served kept. */
  async function slowReads(session: { id: string; role: string }): Promise<number> {
    const before = calls.length;
    await asStudent(session, () => signals.getSlowSignals(session));
    return calls.slice(before).filter((call) => call.action !== "executeRaw").length;
  }

  it("a Certification write through `prisma` clears the writing student's slow signals and no one else's", async () => {
    const full = await slowReads(A);
    assert.ok(full > 0);
    await slowReads(B);
    assert.equal(await slowReads(A), 0, "the second read was not served kept");
    await asStudent(A, () => db.prisma.certification.create({ data: { studentId: A.id, certType: "ready-to-work" } }));
    assert.equal(await slowReads(A), full, "A's slow signals outlived A's certification write");
    assert.equal(await slowReads(B), 0, "B's slow signals were cleared by A's write");
  });

  it("one student's requirement tick clears that student's slow signals and no one else's", async () => {
    const full = await slowReads(A);
    await slowReads(B);
    await asStudent(A, () => db.prisma.certRequirement.update({ where: { id: "req-1" }, data: { completed: true } }));
    assert.equal(await slowReads(A), full, "A's slow signals outlived A's requirement tick");
    assert.equal(await slowReads(B), 0, "B's slow signals were cleared by A's requirement tick");
  });

  it("a Goal write that lands during the page's read leaves nothing pre-write kept", async () => {
    const full = await slowReads(A);
    cache.invalidateAllChatContext();
    const held = holdNextEngineRequest();
    const page = asStudent(A, () => signals.readAndKeepSlowSignals(A));
    await held.reached;
    await asStudent(A, () => db.prisma.goal.create({ data: { studentId: A.id, level: "monthly", content: "Finish the resume" } }));
    held.release();
    await page;
    assert.equal(await slowReads(A), full, "a read that began before A's goal write was kept after it");
  });
});

/**
 * Parks the next engine request until `release`; `reached` resolves once it
 * arrives. Every other request passes straight through.
 */
function holdNextEngineRequest(): { reached: Promise<void>; release: () => void } {
  const engine: unknown = Reflect.get(db.prisma, "_engine");
  if (typeof engine !== "object" || engine === null) throw new Error("no engine");
  const original: unknown = Reflect.get(engine, "request");
  if (typeof original !== "function") throw new Error("no engine request");
  let arrive = () => {};
  let release = () => {};
  const reached = new Promise<void>((resolve) => { arrive = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  Reflect.set(engine, "request", async (...args: unknown[]) => {
    Reflect.set(engine, "request", original);
    arrive();
    await gate;
    return Reflect.apply(original, engine, args);
  });
  return { reached, release };
}
