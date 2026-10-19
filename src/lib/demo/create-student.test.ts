import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { DEMO_LIMIT_DAILY, DEMO_LIMIT_HOURLY, DEMO_LIMIT_NETWORK } from "./copy";

// createDemoStudent talks to Postgres only through `prismaAdmin`, so this file
// swaps it for an in-memory store. The store evaluates the `where` of every
// count the way Postgres would, so the limit tests seed rows with real
// `createdAt` times instead of hard-coding what a count returns. Its
// `$transaction` snapshots the tables and restores them when the callback
// throws, which is what lets a test see that a failed enrollment leaves no
// student behind.

type Row = Record<string, unknown>;

interface CountWhere {
  demoAccount?: string;
  createdAt?: { gte: Date };
}

const NOW = new Date("2026-10-19T15:30:00.000Z");
const CLASS_ID = "class-demo-1";

function createFakeDb() {
  let nextId = 1;
  let txDepth = 0;
  const state = {
    students: [] as Row[],
    enrollments: [] as Row[],
  };
  const countWheres: CountWhere[] = [];
  const writes: Array<{ table: string; inTx: boolean }> = [];
  let failEnrollment: Error | null = null;

  const db = {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const snapshot = {
        students: [...state.students],
        enrollments: [...state.enrollments],
      };
      txDepth += 1;
      try {
        return await fn(db);
      } catch (error) {
        state.students = snapshot.students;
        state.enrollments = snapshot.enrollments;
        throw error;
      } finally {
        txDepth -= 1;
      }
    },
    student: {
      count: async (args: { where: CountWhere }) => {
        countWheres.push(args.where);
        return state.students.filter((row) => {
          if (args.where.demoAccount !== undefined && row.demoAccount !== args.where.demoAccount) return false;
          if (args.where.createdAt && (row.createdAt as Date) < args.where.createdAt.gte) return false;
          return true;
        }).length;
      },
      create: async (args: { data: Row; select?: Record<string, boolean> }) => {
        // Stamped with the test clock, so a student made during a test counts in the
        // same windows the test reads with.
        const row = { id: `stu-${nextId++}`, sessionVersion: 0, createdAt: NOW, ...args.data };
        state.students.push(row);
        writes.push({ table: "student", inTx: txDepth > 0 });
        // Like Prisma, answer with only the selected columns when asked to.
        if (!args.select) return row;
        return Object.fromEntries(Object.keys(args.select).map((column) => [column, row[column as keyof typeof row]]));
      },
    },
    studentClassEnrollment: {
      create: async (args: { data: Row }) => {
        if (failEnrollment) throw failEnrollment;
        state.enrollments.push({ ...args.data });
        writes.push({ table: "studentClassEnrollment", inTx: txDepth > 0 });
        return args.data;
      },
    },
  };

  return {
    db,
    state,
    countWheres,
    writes,
    failEnrollmentWith(error: Error) {
      failEnrollment = error;
    },
    /** Adds `count` demo-student rows created at `createdAt`. */
    seedStudents(count: number, createdAt: Date, demoAccount: string | null = "student") {
      for (let i = 0; i < count; i += 1) {
        state.students.push({ id: `seed-${nextId++}`, demoAccount, createdAt });
      }
    },
  };
}

let current = createFakeDb();

const rateLimitCalls: Array<[string, number, number]> = [];
let rateLimitResult: { success: boolean; remaining: number; resetTime: number; degraded: boolean };

const bootstrapCalls: number[] = [];
let bootstrapResult: () => Promise<unknown>;

const auditCalls: Array<Record<string, unknown>> = [];
const invalidated: string[] = [];

mock.module("@/lib/db", {
  exports: {
    // A proxy, so each test can install a fresh store without re-importing.
    prismaAdmin: new Proxy({}, { get: (_target, property) => Reflect.get(current.db, property) }),
  },
});

mock.module("@/lib/rate-limit", {
  exports: {
    rateLimit: async (key: string, limit: number, windowMs: number) => {
      rateLimitCalls.push([key, limit, windowMs]);
      return rateLimitResult;
    },
  },
});

mock.module("@/lib/audit", {
  exports: {
    logAuditEvent: async (input: Record<string, unknown>) => {
      auditCalls.push(input);
    },
  },
});

mock.module("@/lib/cache", {
  exports: {
    invalidateChatContext: (studentId: string) => {
      invalidated.push(studentId);
    },
  },
});

mock.module("@/lib/demo/bootstrap", {
  exports: {
    ensureDemoClassroom: () => {
      bootstrapCalls.push(bootstrapCalls.length + 1);
      return bootstrapResult();
    },
  },
});

type CreateStudent = typeof import("./create-student");
let createDemoStudent: CreateStudent["createDemoStudent"];

before(async () => {
  ({ createDemoStudent } = await import("./create-student"));
});

beforeEach(() => {
  current = createFakeDb();
  rateLimitCalls.length = 0;
  rateLimitResult = { success: true, remaining: 9, resetTime: NOW.getTime() + 3_600_000, degraded: false };
  bootstrapCalls.length = 0;
  bootstrapResult = async () => ({ instructorId: "instr-1", instructorSessionVersion: 0, classId: CLASS_ID });
  auditCalls.length = 0;
  invalidated.length = 0;
});

/** The student a `created` result carries, or a failed assertion. */
function createdStudent(result: Awaited<ReturnType<CreateStudent["createDemoStudent"]>>) {
  assert.equal(result.kind, "created", `expected a created student, got ${JSON.stringify(result)}`);
  assert.ok(result.kind === "created");
  return result.student;
}

describe("createDemoStudent", () => {
  it("creates a student and enrollment in one transaction", async () => {
    const student = createdStudent(await createDemoStudent("203.0.113.9", NOW));

    assert.equal(current.state.students.length, 1);
    assert.equal(current.state.enrollments.length, 1);
    assert.deepEqual(
      current.writes,
      [
        { table: "student", inTx: true },
        { table: "studentClassEnrollment", inTx: true },
      ],
      "both rows must be written inside the transaction",
    );

    const row = current.state.students[0];
    assert.equal(row.role, "student");
    assert.equal(row.demoAccount, "student");
    assert.match(String(row.studentId), /^demo-[0-9a-f]{12}$/);
    assert.equal("passwordHash" in row, false, "a demo student has no password");
    assert.equal("email" in row, false, "a demo student has no email");

    assert.deepEqual(current.state.enrollments[0], {
      classId: CLASS_ID,
      studentId: row.id,
      status: "active",
    });

    assert.deepEqual(student, {
      id: row.id,
      studentId: row.studentId,
      displayName: row.displayName,
      sessionVersion: 0,
    });
  });

  it("makes two distinct students on two calls", async () => {
    const first = createdStudent(await createDemoStudent("203.0.113.9", NOW));
    const second = createdStudent(await createDemoStudent("203.0.113.9", NOW));

    assert.notEqual(first.id, second.id);
    assert.notEqual(first.studentId, second.studentId);
    assert.equal(current.state.students.length, 2);
    assert.equal(current.state.enrollments.length, 2);
  });

  it("numbers the student after every demo student, starters included", async () => {
    // Four starters, plus a demo instructor and a real student that must not count.
    current.seedStudents(4, new Date("2026-10-01T00:00:00.000Z"));
    current.seedStudents(1, new Date("2026-10-01T00:00:00.000Z"), "instructor");
    current.seedStudents(3, new Date("2026-10-01T00:00:00.000Z"), null);

    const student = createdStudent(await createDemoStudent("203.0.113.9", NOW));

    assert.match(student.displayName, / 5$/);
  });

  it("rate-limits by network, ten an hour, under the demo-student key", async () => {
    await createDemoStudent("203.0.113.9", NOW);

    assert.deepEqual(rateLimitCalls, [["demo-student:203.0.113.9", 10, 3_600_000]]);
  });

  it("refuses the 11th from one network in an hour", async () => {
    rateLimitResult = { success: false, remaining: 0, resetTime: NOW.getTime() + 60_000, degraded: false };

    const result = await createDemoStudent("203.0.113.9", NOW);

    assert.deepEqual(result, { kind: "limited", message: DEMO_LIMIT_NETWORK });
    assert.equal(current.countWheres.length, 0, "the site counts are not read once the network is refused");
    assert.equal(bootstrapCalls.length, 0);
    assert.equal(current.state.students.length, 0);
    assert.equal(auditCalls.length, 0);
  });

  it("admits the 40th in an hour and refuses at 40 created in the last hour", async () => {
    current.seedStudents(39, new Date("2026-10-19T15:00:00.000Z"));
    createdStudent(await createDemoStudent("203.0.113.9", NOW));

    // 40 are now in the hour, so the next one is the 41st.
    const result = await createDemoStudent("203.0.113.10", NOW);

    assert.deepEqual(result, { kind: "limited", message: DEMO_LIMIT_HOURLY });
    assert.equal(current.state.students.length, 40, "a refused visitor creates nothing");
    assert.equal(current.state.enrollments.length, 1);
  });

  it("does not count a student created more than an hour ago toward the hourly limit", async () => {
    // 40 made earlier today, but none inside the last hour.
    current.seedStudents(40, new Date("2026-10-19T14:29:59.000Z"));

    createdStudent(await createDemoStudent("203.0.113.9", NOW));
  });

  it("refuses at 200 created today even when rateLimit is degraded", async () => {
    rateLimitResult = { success: true, remaining: 0, resetTime: NOW.getTime() + 3_600_000, degraded: true };
    current.seedStudents(200, new Date("2026-10-19T02:00:00.000Z"));

    const result = await createDemoStudent("203.0.113.9", NOW);

    assert.deepEqual(result, { kind: "limited", message: DEMO_LIMIT_DAILY });
    assert.equal(bootstrapCalls.length, 0);
    assert.equal(current.state.students.length, 200);
    assert.equal(auditCalls.length, 0);
  });

  it("admits the 200th of the day, then refuses the 201st", async () => {
    current.seedStudents(199, new Date("2026-10-19T02:00:00.000Z"));

    createdStudent(await createDemoStudent("203.0.113.9", NOW));
    const result = await createDemoStudent("203.0.113.9", NOW);

    assert.deepEqual(result, { kind: "limited", message: DEMO_LIMIT_DAILY });
  });

  it("starts the daily count at UTC midnight, not 24 hours back", async () => {
    // 200 made yesterday evening, before the UTC day began.
    current.seedStudents(200, new Date("2026-10-18T23:59:59.000Z"));

    createdStudent(await createDemoStudent("203.0.113.9", NOW));
  });

  it("reads the hourly window and the UTC-day window as two separate counts", async () => {
    // Half past midnight UTC: an hour back reaches into yesterday, the day does not.
    const justAfterMidnight = new Date("2026-10-19T00:30:00.000Z");

    await createDemoStudent("203.0.113.9", justAfterMidnight);

    const windows = current.countWheres
      .filter((where) => where.createdAt)
      .map((where) => (where.createdAt as { gte: Date }).gte.toISOString());
    assert.deepEqual(windows, ["2026-10-18T23:30:00.000Z", "2026-10-19T00:00:00.000Z"]);
    for (const where of current.countWheres) assert.equal(where.demoAccount, "student");
  });

  it("audits the creation and drops the new student's cached chat context", async () => {
    const student = createdStudent(await createDemoStudent("203.0.113.9", NOW));

    assert.equal(auditCalls.length, 1);
    assert.equal(auditCalls[0].action, "demo.student.create");
    assert.equal(auditCalls[0].targetType, "student");
    assert.equal(auditCalls[0].targetId, student.id);
    assert.deepEqual(invalidated, [student.id]);
  });

  it("leaves no student behind when the enrollment fails", async () => {
    current.failEnrollmentWith(new Error("enrollment write failed"));

    await assert.rejects(createDemoStudent("203.0.113.9", NOW), /enrollment write failed/);

    assert.equal(current.state.students.length, 0, "the student row rolls back with the enrollment");
    assert.equal(auditCalls.length, 0);
    assert.deepEqual(invalidated, []);
  });

  it("lets a bootstrap failure through without retrying or creating anything", async () => {
    const failure = new Error("A class holds the demo class code but is not the demo class");
    bootstrapResult = async () => {
      throw failure;
    };

    await assert.rejects(createDemoStudent("203.0.113.9", NOW), (error) => error === failure);

    assert.equal(bootstrapCalls.length, 1, "no retry");
    assert.equal(current.state.students.length, 0);
    assert.equal(auditCalls.length, 0);
  });
});
