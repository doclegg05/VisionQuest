import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, beforeEach, describe, it, mock } from "node:test";
import { Prisma } from "@prisma/client";
import {
  countsByFunction,
  createQueryCounter,
  formatQueryBreakdown,
  queryCountLine,
  summarizeQueries,
} from "./query-counter.test-support";

// The counter is used the way every measurement test uses it: registered as
// the `@/lib/db` module, then reached through the real import. The types the
// calls below are checked against are therefore the real client's.

const counter = createQueryCounter();
mock.module("@/lib/db", { exports: counter.dbModule });

let db: typeof import("@/lib/db");

before(async () => {
  db = await import("@/lib/db");
});

beforeEach(() => {
  counter.reset();
  counter.useFixtures({});
});

async function loadGoals(studentId: string) {
  return db.prisma.goal.findMany({ where: { studentId } });
}

describe("query counter: recording", () => {
  it("records one entry per call with its client, model and operation", async () => {
    await db.prisma.goal.count({ where: { studentId: "s1" } });
    await db.prismaAdmin.student.findUnique({ where: { id: "s1" } });

    assert.deepEqual(
      counter.queries().map((q) => [q.client, q.model, q.operation]),
      [
        ["app", "goal", "count"],
        ["admin", "student", "findUnique"],
      ],
    );
  });

  it("counts parallel calls once each", async () => {
    await Promise.all([
      db.prisma.goal.count(),
      db.prisma.goal.count(),
      db.prisma.orientationItem.count(),
    ]);

    assert.equal(counter.queries().length, 3);
  });

  it("records a query when it is awaited and not before, as Prisma sends none until then", async () => {
    const pending = db.prisma.goal.count();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(counter.queries().length, 0);

    await pending;
    assert.equal(counter.queries().length, 1);
  });

  it("names the function and source line that issued the query", async () => {
    await loadGoals("s1");

    const [query] = counter.queries();
    assert.ok(query, "no query was recorded");
    assert.equal(query.caller.fn, "loadGoals");
    assert.equal(query.caller.file, "src/lib/query-counter.test.ts");
    const sourceLine = readFileSync(query.caller.file, "utf8").split("\n")[query.caller.line - 1];
    assert.match(sourceLine ?? "", /db\.prisma\.goal\.findMany/);
  });

  it("counts each nested relation in select or include, and not _count", async () => {
    await db.prisma.student.findMany({
      select: {
        id: true,
        goals: { select: { id: true } },
        certifications: { select: { requirements: true } },
        _count: { select: { files: true } },
      },
    });
    await db.prisma.goal.findMany({ include: { student: true } });
    await db.prisma.goal.count();

    assert.deepEqual(counter.queries().map((q) => q.relationLoads), [3, 1, 0]);
  });

  it("shows an observer each query's Prisma model, arguments and result, as a client extension sees them", async () => {
    counter.useFixtures({ "goal.update": { id: "g1", studentId: "s1" } });
    const seen: unknown[] = [];
    counter.observe((event) => {
      seen.push([event.query.client, event.prismaModel, event.query.operation, event.args, event.result]);
    });

    await db.prisma.goal.update({ where: { id: "g1" }, data: { status: "completed" } });
    await db.prismaAdmin.$queryRaw`SELECT 1`;
    counter.observe(null);
    await db.prisma.goal.count();

    assert.deepEqual(seen, [
      ["app", "Goal", "update", { where: { id: "g1" }, data: { status: "completed" } }, { id: "g1", studentId: "s1" }],
      ["admin", undefined, "$queryRaw", { sql: "SELECT 1", values: [] }, []],
    ]);
  });

  it("section returns only the queries issued while it ran", async () => {
    await db.prisma.goal.count();
    const section = await counter.section(() => loadGoals("s1"));

    assert.deepEqual(section.value, []);
    assert.deepEqual(section.queries.map((q) => q.operation), ["findMany"]);
    assert.equal(counter.queries().length, 2);
  });
});

describe("query counter: results", () => {
  it("answers with the empty result for the operation when no fixture is set", async () => {
    assert.equal(await db.prisma.goal.count(), 0);
    assert.deepEqual(await db.prisma.goal.findMany(), []);
    assert.equal(await db.prisma.goal.findFirst(), null);
    assert.equal(await db.prisma.student.findUnique({ where: { id: "s1" } }), null);
    assert.deepEqual(await db.prisma.goal.updateMany({ data: { status: "active" } }), { count: 0 });
    assert.deepEqual(counter.queries().map((q) => q.answeredBy), [
      "default", "default", "default", "default", "default",
    ]);
  });

  it("answers with the fixture, and hands a function fixture the call's arguments", async () => {
    counter.useFixtures({
      "goal.count": 4,
      "student.findUnique": (args: unknown) => ({ echoed: args }),
    });

    assert.equal(await db.prisma.goal.count(), 4);
    assert.deepEqual(await db.prisma.student.findUnique({ where: { id: "s1" } }), {
      echoed: { where: { id: "s1" } },
    });
    assert.deepEqual(counter.queries().map((q) => q.answeredBy), ["fixture", "fixture"]);
  });

  it("lets an admin-only fixture differ from the app client's", async () => {
    counter.useFixtures({ "goal.count": 1, "admin:goal.count": 9 });

    assert.equal(await db.prisma.goal.count(), 1);
    assert.equal(await db.prismaAdmin.goal.count(), 9);
  });

  it("refuses a fixture for a model or operation that does not exist", () => {
    assert.throws(() => counter.useFixtures({ "gaol.count": 1 }), /gaol\.count/);
    assert.throws(() => counter.useFixtures({ "goal.cuont": 1 }), /goal\.cuont/);
  });

  it("rejects findUniqueOrThrow with no fixture instead of inventing a row", async () => {
    await assert.rejects(
      () => db.prisma.student.findUniqueOrThrow({ where: { id: "s1" } }),
      /student\.findUniqueOrThrow/,
    );
  });
});

describe("query counter: transactions and raw queries", () => {
  it("runs a batch transaction's queries once each, in order", async () => {
    counter.useFixtures({ "goal.count": 2 });

    const results = await db.prisma.$transaction([
      db.prisma.goal.count(),
      db.prisma.orientationItem.findMany(),
    ]);

    assert.deepEqual(results, [2, []]);
    assert.deepEqual(counter.queries().map((q) => `${q.model}.${q.operation}`), [
      "goal.count",
      "orientationItem.findMany",
    ]);
    assert.deepEqual(counter.transactions().map((t) => [t.client, t.kind]), [["app", "batch"]]);
  });

  it("records queries inside an interactive transaction against that client", async () => {
    const total = await db.prismaAdmin.$transaction(async (tx) => {
      await tx.studentTask.findMany();
      return tx.studentTask.count();
    });

    assert.equal(total, 0);
    assert.deepEqual(
      counter.queries().map((q) => [q.client, q.operation, q.inInteractiveTransaction]),
      [
        ["admin", "findMany", true],
        ["admin", "count", true],
      ],
    );
    assert.deepEqual(counter.transactions().map((t) => [t.client, t.kind]), [["admin", "interactive"]]);
  });

  it("records withAppTransaction's queries on the app client", async () => {
    const total = await db.withAppTransaction((tx) => tx.studentTask.count());

    assert.equal(total, 0);
    assert.deepEqual(
      counter.queries().map((q) => [q.client, q.model, q.operation, q.inInteractiveTransaction]),
      [["app", "studentTask", "count", true]],
    );
    assert.deepEqual(counter.transactions().map((t) => [t.client, t.kind]), [["app", "interactive"]]);
  });

  it("records a tagged $queryRaw and hands the fixture its SQL and values", async () => {
    counter.useFixtures({
      $queryRaw: (args: unknown) => [{ seen: args }],
    });

    const rows = await db.prisma.$queryRaw`SELECT id FROM "Goal" WHERE "studentId" = ${"s1"}`;

    assert.deepEqual(rows, [
      { seen: { sql: 'SELECT id FROM "Goal" WHERE "studentId" = ?', values: ["s1"] } },
    ]);
    assert.deepEqual(counter.queries().map((q) => [q.model, q.operation]), [["(raw)", "$queryRaw"]]);
  });

  it("records $queryRaw given a Prisma.sql object, and $executeRaw", async () => {
    await db.prisma.$queryRaw(Prisma.sql`SELECT 1 WHERE ${1} = ${1}`);
    const changed = await db.prismaAdmin.$executeRaw`UPDATE "Goal" SET "status" = ${"done"}`;

    assert.equal(changed, 0);
    assert.deepEqual(counter.queries().map((q) => [q.client, q.operation]), [
      ["app", "$queryRaw"],
      ["admin", "$executeRaw"],
    ]);
  });
});

describe("query counter: summary", () => {
  it("totals queries by client and groups them by the function that issued them", async () => {
    await loadGoals("s1");
    await loadGoals("s2");
    await db.prismaAdmin.student.findUnique({ where: { id: "s1" } });

    const summary = summarizeQueries(counter.queries());

    assert.equal(summary.app, 2);
    assert.equal(summary.admin, 1);
    assert.equal(summary.total, 3);
    assert.deepEqual(
      summary.byCaller.map((row) => [row.file, row.fn, row.app, row.admin]),
      [
        ["src/lib/query-counter.test.ts", "loadGoals", 2, 0],
        ["src/lib/query-counter.test.ts", "(anonymous)", 0, 1],
      ],
    );
  });

  it("prints one line per issuing function with each query and its line number", async () => {
    await loadGoals("s1");

    const text = formatQueryBreakdown("example", counter.queries());

    assert.match(text, /^example: app 1, admin 0/);
    assert.match(text, /loadGoals\s+src\/lib\/query-counter\.test\.ts\s+app 1\s+goal\.findMany:\d+/);
  });

  it("names the queries that had no fixture, so a reader knows which reads came back empty", async () => {
    counter.useFixtures({ "goal.count": 2 });
    await db.prisma.goal.count();
    await loadGoals("s1");
    await loadGoals("s2");

    const lines = formatQueryBreakdown("example", counter.queries()).split("\n");

    assert.equal(lines.at(-1), "  answered by default (2 of 3): goal.findMany");
  });

  it("reduces queries to app and admin counts per issuing function", async () => {
    await loadGoals("s1");
    await loadGoals("s2");
    await db.prismaAdmin.student.findUnique({ where: { id: "s1" } });

    assert.deepEqual(countsByFunction(counter.queries()), {
      "src/lib/query-counter.test.ts › loadGoals": [2, 0],
      "src/lib/query-counter.test.ts › (anonymous)": [0, 1],
    });
  });

  it("writes the one line the readiness script reads", async () => {
    await loadGoals("s1");
    await db.prismaAdmin.student.findMany({ select: { goals: true } });

    assert.equal(
      queryCountLine({ path: "dashboard", cache: "cold", queries: counter.queries(), readNotExecuted: 0 }),
      "QUERY_COUNT path=dashboard cache=cold app=1 admin=1 relationLoads=1 read=0",
    );
  });
});
