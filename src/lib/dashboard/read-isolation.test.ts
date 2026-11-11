/**
 * F2b item 2: the dashboard's read groups run at REPEATABLE READ, the task
 * writes stay SERIALIZABLE, and both wait for a pool slot as long as the pool
 * does. Checked on the transaction options the REAL clients send to the
 * engine (./engine-stub.test-support.ts), plus a source pin on src/lib/db.ts
 * so an isolation change there trips a test even if no caller changes.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, beforeEach, describe, it } from "node:test";
import type { TransactionStart } from "./engine-stub.test-support";

process.env.DATABASE_URL ??= "postgresql://stub:[REDACTED]@127.0.0.1:1/stub";
process.env.ADMIN_DATABASE_URL ??= process.env.DATABASE_URL;

const A = { id: "cisolationaaaaaaaaaaaaaa1", role: "student" };
const POOL_WAIT_MS = 10_000;

let db: typeof import("@/lib/db");
let rls: typeof import("@/lib/rls-context");
let starts: TransactionStart[];

function answer(call: { action: string; modelName: string | undefined }): unknown {
  if (call.action === "executeRaw") return 1;
  if (call.action === "aggregate") return { _count: { _all: 1 } };
  if (call.action === "createOne" && call.modelName === "StudentTask") return { id: "task-1", studentId: A.id };
  if (call.action === "findFirst" || call.action === "findUnique") return null;
  if (call.action === "findMany") return [];
  return undefined;
}

const asStudent = <T>(work: () => Promise<T>) =>
  rls.withRlsContext({ userId: A.id, role: "student", studentId: A.id }, work);

async function startsOf(work: () => Promise<unknown>): Promise<TransactionStart[]> {
  const from = starts.length;
  await asStudent(work);
  return starts.slice(from);
}

function assertReadGroup(list: readonly TransactionStart[], label: string): void {
  assert.ok(list.length > 0, `${label} started no transaction`);
  for (const start of list) {
    assert.equal(start.isolationLevel, "RepeatableRead", `${label} ran at ${String(start.isolationLevel)}`);
    assert.equal(start.maxWait, POOL_WAIT_MS, `${label} waits ${String(start.maxWait)} ms for a connection`);
  }
}

before(async () => {
  const { stubEngine } = await import("./engine-stub.test-support");
  db = await import("@/lib/db");
  rls = await import("@/lib/rls-context");
  starts = [];
  stubEngine(db.prisma, answer, starts);
});
beforeEach(async () => { (await import("@/lib/cache")).invalidateAllChatContext(); });

describe("dashboard transaction isolation", () => {
  it("the shell and slow-signal reads run at REPEATABLE READ", async () => {
    const signals = await import("./signals");
    assertReadGroup(await startsOf(() => signals.getStudentShell(A)), "the shell read");
    assertReadGroup(await startsOf(() => signals.readSlowSignals(A.id)), "the slow-signal read");
  });

  it("the live reads run at REPEATABLE READ", async () => {
    const live = await import("./live");
    assertReadGroup(await startsOf(() => live.readLiveSignals(A.id)), "the live read");
    assertReadGroup(await startsOf(() => live.readPageLiveSignals(A.id)), "the page live read");
  });

  it("task writes stay SERIALIZABLE, with the same pool wait", async () => {
    const [start] = await startsOf(() => db.withAppTransaction((tx) =>
      tx.studentTask.create({ data: { studentId: A.id, createdById: A.id, title: "Call the clinic" } })));
    assert.equal(start?.isolationLevel, "Serializable");
    assert.equal(start?.maxWait, POOL_WAIT_MS);
  });
});

describe("src/lib/db.ts isolation source pin", () => {
  const source = readFileSync(new URL("../db.ts", import.meta.url), "utf8");
  const body = (name: string) => {
    const start = source.indexOf(`export async function ${name}<`);
    assert.ok(start >= 0, `${name} is gone from db.ts`);
    return source.slice(start, source.indexOf("\n}\n", start));
  };

  it("withAppTransaction is SERIALIZABLE and withAppReadTransaction is REPEATABLE READ", () => {
    assert.match(body("withAppTransaction"), /TransactionIsolationLevel\.Serializable/);
    assert.match(body("withAppReadTransaction"), /TransactionIsolationLevel\.RepeatableRead/);
  });

  it("both start through the one helper that sets maxWait", () => {
    assert.match(body("withAppTransaction"), /runAppTransaction\(/);
    assert.match(body("withAppReadTransaction"), /runAppTransaction\(/);
    const helper = source.slice(source.indexOf("async function runAppTransaction<"));
    assert.match(helper.slice(0, helper.indexOf("\n}\n")), /maxWait: TRANSACTION_MAX_WAIT_MS/);
  });
});
