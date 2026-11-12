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
const CLASS_ID = "cwritethroughclassxxxxxx3";

let db: typeof import("@/lib/db");
let signals: typeof import("./signals");
let rls: typeof import("@/lib/rls-context");
let cache: typeof import("@/lib/cache");
let calls: EngineCall[];
/** What the admin client's class-member lookup answers; a throw stands for a failed lookup. */
let classMembers: () => unknown = () => [{ studentId: A.id }];
/** The row a Message create returns: a write whose `select` drops studentId returns one without it. */
const FULL_MESSAGE_ROW = { id: "msg-1", studentId: A.id, conversationId: "conv-1" };
let messageRow: Record<string, unknown> = FULL_MESSAGE_ROW;

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
  if (call.action === "updateOne" && call.modelName === "StudentClassEnrollment") return { id: "enr-1", studentId: A.id, classId: CLASS_ID };
  if (call.action === "createOne" && call.modelName === "ClassRequirement") return { id: "creq-1", classId: CLASS_ID };
  if (call.action === "updateOne" && call.modelName === "Pathway") return { id: "path-1", active: false };
  if (call.action === "updateOne" && call.modelName === "Conversation") return { id: "conv-1", studentId: A.id };
  if (call.action === "createOne" && call.modelName === "Message") return messageRow;
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
  stubEngine(db.prismaAdmin, (call) => {
    if (call.action === "findMany" && call.modelName === "Certification") return [{ studentId: A.id }];
    if (call.action === "findMany" && call.modelName === "StudentClassEnrollment") return classMembers();
    return answer(call);
  });
});
beforeEach(() => {
  cache.invalidateAllChatContext();
  classMembers = () => [{ studentId: A.id }];
  messageRow = FULL_MESSAGE_ROW;
});

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

describe("kept slow signals, cleared by writes to the inputs F2 left unwatched", () => {
  async function slowReads(session: { id: string; role: string }): Promise<number> {
    const before = calls.length;
    await asStudent(session, () => signals.getSlowSignals(session));
    return calls.slice(before).filter((call) => call.action !== "executeRaw").length;
  }
  /** Keeps both students' slow signals; returns the read count of a fresh read. */
  async function keepBoth(): Promise<number> {
    const full = await slowReads(A);
    await slowReads(B);
    assert.equal(await slowReads(A), 0, "the slow signals were not kept");
    return full;
  }
  /** Plants a Sage chat layer for A and says whether a later read found it kept. */
  async function sageLayer(): Promise<{ kept: () => Promise<boolean> }> {
    const key = `chat:pathway:${A.id}`;
    await cache.cached(key, 600, async () => "warm");
    return { kept: async () => {
      let reread = false;
      await cache.cached(key, 600, async () => { reread = true; return "fresh"; });
      return !reread;
    } };
  }
  const asStaff = <T>(work: () => Promise<T>) =>
    rls.withRlsContext({ userId: "teacher-1", role: "teacher", studentId: "" }, work);

  it("an enrollment write clears that student's slow signals and no one else's", async () => {
    const full = await keepBoth();
    await asStaff(() => db.prisma.studentClassEnrollment.update({ where: { id: "enr-1" }, data: { status: "archived" } }));
    assert.equal(await slowReads(A), full, "A's slow signals outlived A's enrollment write");
    assert.equal(await slowReads(B), 0, "B's slow signals were cleared by A's enrollment write");
  });

  it("a class requirement write clears the students enrolled in that class and no one else", async () => {
    const full = await keepBoth();
    await asStaff(() => db.prisma.classRequirement.create({
      data: { classId: CLASS_ID, itemType: "certification", itemId: "ready-to-work", title: "Ready to Work", status: "optional" },
    }));
    assert.equal(await slowReads(A), full, "the enrolled student's slow signals outlived the requirement write");
    assert.equal(await slowReads(B), 0, "a student outside the class was cleared");
  });

  it("a class requirement write clears everyone when the class lookup fails", async () => {
    const full = await keepBoth();
    classMembers = () => { throw new Error("admin pool down"); };
    await asStaff(() => db.prisma.classRequirement.create({
      data: { classId: CLASS_ID, itemType: "certification", itemId: "ready-to-work", title: "Ready to Work", status: "required" },
    }));
    assert.equal(await slowReads(A), full);
    assert.equal(await slowReads(B), full, "a failed lookup left a student's slow signals kept");
  });

  it("switching a pathway off clears everyone", async () => {
    const full = await keepBoth();
    await asStaff(() => db.prisma.pathway.update({ where: { id: "path-1" }, data: { active: false } }));
    assert.equal(await slowReads(A), full);
    assert.equal(await slowReads(B), full);
  });

  it("a conversation stage change clears that student's slow signals only, and leaves Sage's layers kept", async () => {
    const full = await keepBoth();
    const sage = await sageLayer();
    await asStudent(A, () => db.prisma.conversation.update({ where: { id: "conv-1" }, data: { stage: "onboarding" } }));
    assert.equal(await slowReads(A), full, "A's slow signals outlived A's stage change");
    assert.equal(await slowReads(B), 0, "B's slow signals were cleared by A's stage change");
    assert.equal(await sage.kept(), true, "a stage change dropped Sage's cached chat layers");
  });

  it("a chat message clears that student's slow signals only, and leaves Sage's layers kept", async () => {
    const full = await keepBoth();
    const sage = await sageLayer();
    await asStudent(A, () => db.prisma.message.create({
      data: { conversationId: "conv-1", studentId: A.id, role: "assistant", content: "What kind of work do you enjoy?" },
    }));
    assert.equal(await slowReads(A), full, "A's slow signals outlived A's discovery turn");
    assert.equal(await slowReads(B), 0, "B's slow signals were cleared by A's message");
    assert.equal(await sage.kept(), true, "a chat message dropped Sage's cached chat layers");
  });

  it("a chat message that names no student clears every student's slow signals, and leaves Sage's layers kept", async () => {
    const full = await keepBoth();
    const sage = await sageLayer();
    messageRow = { id: "msg-2" };
    await asStudent(A, () => db.prisma.message.create({
      data: { student: { connect: { id: A.id } }, conversation: { connect: { id: "conv-1" } }, role: "user", content: "Hi" },
      select: { id: true },
    }));
    assert.equal(await slowReads(A), full, "A's slow signals outlived a message that named no student");
    assert.equal(await slowReads(B), full, "B's slow signals outlived a message that named no student");
    assert.equal(await sage.kept(), true, "a message that named no student dropped Sage's cached chat layers");
  });

  it("a conversation title change clears nothing", async () => {
    await keepBoth();
    await asStudent(A, () => db.prisma.conversation.update({ where: { id: "conv-1" }, data: { title: "First chat" } }));
    assert.equal(await slowReads(A), 0, "a title write cleared the kept slow signals");
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
