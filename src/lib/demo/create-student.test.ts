import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { DEMO_LIMIT_DAILY, DEMO_LIMIT_HOURLY, DEMO_LIMIT_NETWORK } from "./copy";

// createDemoStudent talks to Postgres only through `prismaAdmin`, so this file
// swaps it for an in-memory store. The store evaluates the `where` of every
// count the way Postgres would, so the limit tests seed rows with real
// `createdAt` times instead of hard-coding what a count returns.
//
// Its `$transaction` hands the callback a separate client, so a test can tell a
// call made on the transaction from one made on the admin client. It snapshots
// the tables and restores them when the callback throws, which is what lets a
// test see that a failed enrollment leaves no student behind. And it models
// `pg_advisory_xact_lock` as a real mutex: a second transaction that asks for
// the lock waits until the first one ends, so the burst test sees the
// serialization the production lock gives.

type Row = Record<string, unknown>;

interface CountWhere {
  demoAccount?: string;
  createdAt?: { gte: Date };
}

type LogEntry =
  | { kind: "lock"; sql: string; values: unknown[]; onTx: boolean }
  | { kind: "count"; where: CountWhere; onTx: boolean }
  | { kind: "create"; table: "student" | "studentClassEnrollment"; onTx: boolean };

const NOW = new Date("2026-10-19T15:30:00.000Z");
const CLASS_ID = "class-demo-1";

function createFakeDb() {
  let nextId = 1;
  const state = {
    students: [] as Row[],
    enrollments: [] as Row[],
  };
  const log: LogEntry[] = [];
  const hooks: { onLock?: () => void } = {};
  let failEnrollment: Error | null = null;
  let lockTail: Promise<void> = Promise.resolve();

  const takeSnapshot = () => ({ students: [...state.students], enrollments: [...state.enrollments] });

  function makeClient(session: { onTx: boolean; takeLock?: () => Promise<void> }) {
    return {
      $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
        log.push({ kind: "lock", sql: strings.join("?"), values, onTx: session.onTx });
        await session.takeLock?.();
        hooks.onLock?.();
        return 0;
      },
      student: {
        count: async (args: { where: CountWhere }) => {
          log.push({ kind: "count", where: args.where, onTx: session.onTx });
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
          log.push({ kind: "create", table: "student", onTx: session.onTx });
          // Like Prisma, answer with only the selected columns when asked to.
          if (!args.select) return row;
          return Object.fromEntries(Object.keys(args.select).map((column) => [column, row[column as keyof typeof row]]));
        },
      },
      studentClassEnrollment: {
        create: async (args: { data: Row }) => {
          if (failEnrollment) throw failEnrollment;
          state.enrollments.push({ ...args.data });
          log.push({ kind: "create", table: "studentClassEnrollment", onTx: session.onTx });
          return args.data;
        },
      },
    };
  }

  const db = {
    ...makeClient({ onTx: false }),
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const held = { release: () => {} };
      let snapshot = takeSnapshot();
      const tx = makeClient({
        onTx: true,
        takeLock: async () => {
          const previous = lockTail;
          lockTail = new Promise<void>((resolve) => {
            held.release = resolve;
          });
          await previous;
          // Another transaction may have committed while this one waited.
          snapshot = takeSnapshot();
        },
      });
      try {
        return await fn(tx);
      } catch (error) {
        state.students = snapshot.students;
        state.enrollments = snapshot.enrollments;
        throw error;
      } finally {
        held.release();
      }
    },
  };

  return {
    db,
    state,
    log,
    hooks,
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

let auditResult: { audited: boolean };

mock.module("@/lib/audit", {
  exports: {
    tryLogAuditEvent: async (input: Record<string, unknown>) => {
      auditCalls.push(input);
      return auditResult;
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
let DEMO_STUDENT_CREATE_LOCK: CreateStudent["DEMO_STUDENT_CREATE_LOCK"];

before(async () => {
  ({ createDemoStudent, DEMO_STUDENT_CREATE_LOCK } = await import("./create-student"));
});

beforeEach(() => {
  current = createFakeDb();
  rateLimitCalls.length = 0;
  rateLimitResult = { success: true, remaining: 9, resetTime: NOW.getTime() + 3_600_000, degraded: false };
  bootstrapCalls.length = 0;
  bootstrapResult = async () => ({ instructorId: "instr-1", instructorSessionVersion: 0, classId: CLASS_ID });
  auditCalls.length = 0;
  auditResult = { audited: true };
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
      current.log.filter((entry) => entry.kind === "create"),
      [
        { kind: "create", table: "student", onTx: true },
        { kind: "create", table: "studentClassEnrollment", onTx: true },
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
    assert.equal(
      current.log.filter((entry) => entry.kind === "count").length,
      0,
      "the site counts are not read once the network is refused",
    );
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

  it("reads the hourly window and the UTC-day window as two separate counts, before and inside the transaction", async () => {
    // Half past midnight UTC: an hour back reaches into yesterday, the day does not.
    const justAfterMidnight = new Date("2026-10-19T00:30:00.000Z");

    await createDemoStudent("203.0.113.9", justAfterMidnight);

    const windowsOn = (onTx: boolean) =>
      current.log.flatMap((entry) =>
        entry.kind === "count" && entry.onTx === onTx && entry.where.createdAt
          ? [entry.where.createdAt.gte.toISOString()]
          : [],
      );
    const expected = ["2026-10-18T23:30:00.000Z", "2026-10-19T00:00:00.000Z"];
    assert.deepEqual(windowsOn(false), expected, "the pre-check windows");
    assert.deepEqual(windowsOn(true), expected, "the re-check windows");
    for (const entry of current.log) {
      if (entry.kind === "count") assert.equal(entry.where.demoAccount, "student");
    }
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

  it("still returns the student when the audit write fails", async () => {
    auditResult = { audited: false };

    const student = createdStudent(await createDemoStudent("203.0.113.9", NOW));

    assert.equal(auditCalls.length, 1);
    assert.deepEqual(invalidated, [student.id]);
    assert.equal(current.state.enrollments.length, 1);
  });
});

// ---------------------------------------------------------------------------
// The site caps under concurrency
//
// The pre-check reads the counts with no lock, so a burst of requests can all
// read the same count before any of them commits. The fix is a second read of
// both counts inside the transaction, after taking a transaction-scoped
// advisory lock, so only one request at a time decides whether the cap is full.
// ---------------------------------------------------------------------------

function stepName(entry: LogEntry): string {
  if (entry.kind === "lock") return "lock";
  if (entry.kind === "count") return entry.where.createdAt ? "count:window" : "count:all";
  return `create:${entry.table}`;
}

describe("createDemoStudent site caps under a lock", () => {
  it("takes the advisory lock first inside the transaction, then counts on the transaction", async () => {
    await createDemoStudent("203.0.113.9", NOW);

    assert.deepEqual(
      current.log.filter((entry) => !entry.onTx).map(stepName),
      ["count:window", "count:window"],
      "the pre-check reads the hourly and daily counts on the admin client",
    );
    assert.deepEqual(current.log.filter((entry) => entry.onTx).map(stepName), [
      "lock",
      "count:window",
      "count:window",
      "count:all",
      "create:student",
      "create:studentClassEnrollment",
    ]);
  });

  it("passes the lock key as a bound value, not as part of the SQL text", async () => {
    await createDemoStudent("203.0.113.9", NOW);

    const lock = current.log.find((entry) => entry.kind === "lock");
    assert.ok(lock && lock.kind === "lock");
    assert.match(lock.sql, /pg_advisory_xact_lock\(\?/);
    assert.equal(lock.sql.includes(String(DEMO_STUDENT_CREATE_LOCK)), false);
    assert.deepEqual(lock.values, [DEMO_STUDENT_CREATE_LOCK]);
    assert.equal(Number.isSafeInteger(DEMO_STUDENT_CREATE_LOCK), true);
  });

  it("refuses inside the transaction when a row lands between the pre-check and the transaction", async () => {
    // The pre-check saw 0. By the time the bootstrap answers, a burst has filled the hour.
    bootstrapResult = async () => {
      current.seedStudents(40, new Date("2026-10-19T15:10:00.000Z"));
      return { instructorId: "instr-1", instructorSessionVersion: 0, classId: CLASS_ID };
    };

    const result = await createDemoStudent("203.0.113.9", NOW);

    assert.deepEqual(result, { kind: "limited", message: DEMO_LIMIT_HOURLY });
    assert.equal(current.state.students.length, 40, "no student is added");
    assert.equal(current.state.enrollments.length, 0);
    assert.equal(current.log.filter((entry) => entry.kind === "create").length, 0, "nothing was written");
    assert.equal(auditCalls.length, 0);
    assert.deepEqual(invalidated, []);
  });

  it("refuses the daily cap inside the transaction too", async () => {
    bootstrapResult = async () => {
      current.seedStudents(200, new Date("2026-10-19T02:00:00.000Z"));
      return { instructorId: "instr-1", instructorSessionVersion: 0, classId: CLASS_ID };
    };

    const result = await createDemoStudent("203.0.113.9", NOW);

    assert.deepEqual(result, { kind: "limited", message: DEMO_LIMIT_DAILY });
    assert.equal(current.state.students.length, 200);
    assert.equal(current.log.filter((entry) => entry.kind === "create").length, 0);
    assert.equal(auditCalls.length, 0);
    assert.deepEqual(invalidated, []);
  });

  it("refuses when the cap fills while this request waits for the lock", async () => {
    // Whoever held the lock commits the 40th student, then this request gets it.
    current.hooks.onLock = () => current.seedStudents(40, new Date("2026-10-19T15:10:00.000Z"));

    const result = await createDemoStudent("203.0.113.9", NOW);

    assert.deepEqual(result, { kind: "limited", message: DEMO_LIMIT_HOURLY });
    assert.equal(current.state.students.length, 40);
    assert.equal(current.state.enrollments.length, 0);
  });

  it("numbers the student after the lock, so a student that landed while waiting is counted", async () => {
    current.seedStudents(3, new Date("2026-10-01T00:00:00.000Z"));
    current.hooks.onLock = () => current.seedStudents(1, new Date("2026-10-19T15:10:00.000Z"));

    const student = createdStudent(await createDemoStudent("203.0.113.9", NOW));

    assert.match(student.displayName, / 5$/);
  });

  it("holds the hourly cap against a concurrent burst, with no repeated numbers", async () => {
    const burst = 55;

    const results = await Promise.all(
      Array.from({ length: burst }, (_unused, index) => createDemoStudent(`198.51.100.${index}`, NOW)),
    );

    const created = results.filter((result) => result.kind === "created");
    const limited = results.filter((result) => result.kind === "limited");
    assert.equal(created.length, 40, "exactly the hourly cap is created");
    assert.equal(limited.length, burst - 40);
    for (const result of limited) {
      assert.ok(result.kind === "limited");
      assert.ok([DEMO_LIMIT_HOURLY, DEMO_LIMIT_DAILY].includes(result.message));
    }
    assert.equal(current.state.students.length, 40);
    assert.equal(current.state.enrollments.length, 40);

    const numbers = current.state.students
      .map((row) => Number(String(row.displayName).split(" ").at(-1)))
      .sort((a, b) => a - b);
    assert.deepEqual(
      numbers,
      Array.from({ length: 40 }, (_unused, index) => index + 1),
      "each student gets its own number",
    );
  });
});
