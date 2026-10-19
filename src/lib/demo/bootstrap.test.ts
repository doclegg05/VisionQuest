import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { buildBookableAdvisorSlots } from "../advising-scheduling";
import { WELCOME_COMPLETE_EVENT } from "../progression/welcome-routing";
import {
  DEMO_CLASS_CODE,
  DEMO_CLASS_NAME,
  DEMO_INSTRUCTOR_LOGIN,
  DEMO_INSTRUCTOR_NAME,
} from "./config";

// The bootstrap talks to Postgres only through `prismaAdmin`, so this file
// swaps it for an in-memory store that behaves like the tables it touches:
// unique keys raise Prisma's P2002, `skipDuplicates` skips, and every real
// insert is logged with whether it happened inside a `$transaction`. That is
// enough to see what a first run writes, what a second run leaves alone, and
// how two first runs at once settle.

type Row = Record<string, unknown>;

function uniqueViolation(): Error {
  return Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
}

interface FakeOptions {
  orientationItems?: Array<{ id: string; sortOrder: number }>;
  /** Thrown, one per call, by the instructor upsert before it does anything. */
  instructorUpsertErrors?: Error[];
  students?: Row[];
  /** Classes that exist before the run starts. */
  classes?: Row[];
  availability?: Row[];
  /** Logins the starter pre-read cannot see, as if another request made them a moment later. */
  hiddenFromFindMany?: string[];
  /** The slot count reads zero even when slots exist, as if another request added them a moment later. */
  availabilityCountReadsZero?: boolean;
}

function createFakeDb(options: FakeOptions = {}) {
  let nextId = 1;
  const newId = (prefix: string) => `${prefix}-${nextId++}`;
  let txDepth = 0;

  const state = {
    students: [...(options.students ?? [])] as Row[],
    classes: [...(options.classes ?? [])] as Row[],
    links: [] as Row[],
    enrollments: [] as Row[],
    progress: [] as Row[],
    goals: [] as Row[],
    events: [] as Row[],
    availability: [...(options.availability ?? [])] as Row[],
  };
  const instructorErrors = [...(options.instructorUpsertErrors ?? [])];
  const calls: string[] = [];
  const writes: Array<{ table: string; inTx: boolean }> = [];
  const instructorUpsertData: Row[] = [];
  // What each upsert was asked to do to a row that already exists. The demo
  // rows must come back untouched, so these are expected to stay empty.
  const upsertUpdates = {
    student: [] as unknown[],
    spokesClass: [] as unknown[],
    spokesClassInstructor: [] as unknown[],
  };

  const record = (name: string) => calls.push(name);
  const wrote = (table: string) => writes.push({ table, inTx: txDepth > 0 });

  const db = {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      record("$transaction");
      txDepth += 1;
      try {
        return await fn(db);
      } finally {
        txDepth -= 1;
      }
    },
    student: {
      upsert: async (args: { where: Row; create: Row; update: Row }) => {
        record("student.upsert");
        upsertUpdates.student.push(args.update);
        if (args.where.studentId === DEMO_INSTRUCTOR_LOGIN) {
          instructorUpsertData.push(args.create);
          const error = instructorErrors.shift();
          if (error) throw error;
        }
        let row = state.students.find((s) => s.studentId === args.where.studentId);
        if (!row) {
          row = { id: newId("stu"), sessionVersion: 0, ...args.create };
          state.students.push(row);
          wrote("student");
        }
        return row;
      },
      findMany: async (args: { where: { studentId: { in: string[] } } }) => {
        record("student.findMany");
        const hidden = options.hiddenFromFindMany ?? [];
        return state.students.filter(
          (s) =>
            args.where.studentId.in.includes(String(s.studentId)) &&
            !hidden.includes(String(s.studentId)),
        );
      },
      create: async (args: { data: Row }) => {
        record("student.create");
        if (state.students.some((s) => s.studentId === args.data.studentId)) {
          throw uniqueViolation();
        }
        const row = { id: newId("stu"), sessionVersion: 0, ...args.data };
        state.students.push(row);
        wrote("student.create");
        return row;
      },
    },
    spokesClass: {
      upsert: async (args: { where: { code: string }; create: Row; update: Row }) => {
        record("spokesClass.upsert");
        upsertUpdates.spokesClass.push(args.update);
        let row = state.classes.find((c) => c.code === args.where.code);
        if (!row) {
          row = { id: newId("cls"), ...args.create };
          state.classes.push(row);
          wrote("spokesClass");
        }
        return row;
      },
    },
    spokesClassInstructor: {
      upsert: async (args: {
        where: { classId_instructorId: { classId: string; instructorId: string } };
        create: Row;
        update: Row;
      }) => {
        record("spokesClassInstructor.upsert");
        upsertUpdates.spokesClassInstructor.push(args.update);
        const key = args.where.classId_instructorId;
        let row = state.links.find(
          (l) => l.classId === key.classId && l.instructorId === key.instructorId,
        );
        if (!row) {
          row = { ...args.create };
          state.links.push(row);
          wrote("spokesClassInstructor");
        }
        return row;
      },
    },
    studentClassEnrollment: {
      create: async (args: { data: Row }) => {
        record("studentClassEnrollment.create");
        state.enrollments.push({ ...args.data });
        wrote("studentClassEnrollment");
        return args.data;
      },
    },
    orientationItem: {
      findMany: async () => {
        record("orientationItem.findMany");
        return [...(options.orientationItems ?? [])];
      },
    },
    orientationProgress: {
      createMany: async (args: { data: Row[] }) => {
        record("orientationProgress.createMany");
        state.progress.push(...args.data.map((d) => ({ ...d })));
        wrote("orientationProgress");
        return { count: args.data.length };
      },
    },
    goal: {
      create: async (args: { data: Row }) => {
        record("goal.create");
        const row = { id: newId("goal"), ...args.data };
        state.goals.push(row);
        wrote("goal");
        return row;
      },
    },
    progressionEvent: {
      create: async (args: { data: Row }) => {
        record("progressionEvent.create");
        state.events.push({ ...args.data });
        wrote("progressionEvent");
        return args.data;
      },
    },
    advisorAvailability: {
      count: async (args: { where: { advisorId: string } }) => {
        record("advisorAvailability.count");
        if (options.availabilityCountReadsZero) return 0;
        return state.availability.filter((a) => a.advisorId === args.where.advisorId).length;
      },
      createMany: async (args: { data: Row[]; skipDuplicates?: boolean }) => {
        record("advisorAvailability.createMany");
        let count = 0;
        for (const row of args.data) {
          if (state.availability.some((a) => a.id === row.id)) {
            if (!args.skipDuplicates) throw uniqueViolation();
            continue;
          }
          state.availability.push({ ...row });
          wrote("advisorAvailability");
          count += 1;
        }
        return { count };
      },
    },
  };

  return { db, state, calls, writes, instructorUpsertData, upsertUpdates };
}

let current = createFakeDb();
const invalidatedChatContexts: string[] = [];

mock.module("@/lib/cache", {
  exports: {
    invalidateChatContext: (studentId: string) => {
      invalidatedChatContexts.push(studentId);
    },
  },
});

mock.module("@/lib/db", {
  exports: {
    // A proxy, so each test can install a fresh store without re-importing.
    prismaAdmin: new Proxy({}, { get: (_target, property) => Reflect.get(current.db, property) }),
  },
});

type Bootstrap = typeof import("./bootstrap");
let ensureDemoClassroom: Bootstrap["ensureDemoClassroom"];
let resetDemoClassroomCacheForTests: Bootstrap["resetDemoClassroomCacheForTests"];

before(async () => {
  ({ ensureDemoClassroom, resetDemoClassroomCacheForTests } = await import("./bootstrap"));
});

beforeEach(() => {
  resetDemoClassroomCacheForTests();
  current = createFakeDb();
  invalidatedChatContexts.length = 0;
});

const FIVE_ITEMS = [
  { id: "item-c", sortOrder: 3 },
  { id: "item-a", sortOrder: 1 },
  { id: "item-e", sortOrder: 5 },
  { id: "item-b", sortOrder: 2 },
  { id: "item-d", sortOrder: 4 },
];

function studentByLogin(login: string): Row {
  const row = current.state.students.find((s) => s.studentId === login);
  assert.ok(row, `no student row for ${login}`);
  return row;
}

function progressItemIds(login: string): string[] {
  const id = studentByLogin(login).id;
  return current.state.progress
    .filter((p) => p.studentId === id)
    .map((p) => String(p.itemId))
    .sort();
}

function goalsFor(login: string): Row[] {
  const id = studentByLogin(login).id;
  return current.state.goals.filter((g) => g.studentId === id);
}

describe("ensureDemoClassroom", () => {
  it("creates the instructor, class, link, availability and 4 starters on first run", async () => {
    current = createFakeDb({ orientationItems: FIVE_ITEMS });

    const classroom = await ensureDemoClassroom();
    const { state } = current;

    // The instructor: a teacher with the demo marker and no way to sign in by password.
    const instructor = studentByLogin(DEMO_INSTRUCTOR_LOGIN);
    assert.equal(instructor.displayName, DEMO_INSTRUCTOR_NAME);
    assert.equal(instructor.role, "teacher");
    assert.equal(instructor.demoAccount, "instructor");
    assert.equal("passwordHash" in instructor, false);
    assert.equal("email" in instructor, false);

    // The class, and the link that lets the demo instructor see it.
    assert.equal(state.classes.length, 1);
    assert.equal(state.classes[0].code, DEMO_CLASS_CODE);
    assert.equal(state.classes[0].name, DEMO_CLASS_NAME);
    assert.equal(state.links.length, 1);
    assert.equal(state.links[0].classId, state.classes[0].id);
    assert.equal(state.links[0].instructorId, instructor.id);

    assert.deepEqual(classroom, {
      instructorId: instructor.id,
      instructorSessionVersion: 0,
      classId: state.classes[0].id,
    });

    // Four starters, none of them able to sign in with a password.
    const starters = state.students.filter((s) => String(s.studentId).startsWith("demo-starter-"));
    assert.deepEqual(
      starters.map((s) => [s.studentId, s.displayName]),
      [
        ["demo-starter-1", "Maya Torres"],
        ["demo-starter-2", "Devon Price"],
        ["demo-starter-3", "Keisha Grant"],
        ["demo-starter-4", "Luis Ortega"],
      ],
    );
    for (const starter of starters) {
      assert.equal(starter.role, "student");
      assert.equal(starter.demoAccount, "student");
      assert.equal("passwordHash" in starter, false);
      assert.equal("email" in starter, false);
    }

    // Every starter is enrolled and active in the demo class.
    assert.equal(state.enrollments.length, 4);
    for (const starter of starters) {
      const enrollment = state.enrollments.find((e) => e.studentId === starter.id);
      assert.ok(enrollment, `no enrollment for ${String(starter.studentId)}`);
      assert.equal(enrollment.classId, state.classes[0].id);
      assert.equal(enrollment.status, "active");
    }

    assert.equal(state.availability.length, 5);
  });

  it("reuses rows and creates nothing on the second run", async () => {
    current = createFakeDb({ orientationItems: FIVE_ITEMS });
    const first = await ensureDemoClassroom();
    const counts = Object.fromEntries(
      Object.entries(current.state).map(([table, rows]) => [table, rows.length]),
    );
    current.writes.length = 0;

    resetDemoClassroomCacheForTests();
    const second = await ensureDemoClassroom();

    assert.deepEqual(second, first);
    assert.deepEqual(current.writes, []);
    assert.deepEqual(
      Object.fromEntries(Object.entries(current.state).map(([table, rows]) => [table, rows.length])),
      counts,
    );
  });

  it("answers a repeat call from memory without touching the database", async () => {
    const first = await ensureDemoClassroom();
    current.calls.length = 0;

    const second = await ensureDemoClassroom();

    assert.deepEqual(second, first);
    assert.deepEqual(current.calls, []);
  });

  it("survives two concurrent first runs", async () => {
    current = createFakeDb({
      orientationItems: FIVE_ITEMS,
      instructorUpsertErrors: [uniqueViolation()],
    });

    // Two separate "processes": the cache is cleared between the calls so both
    // run the whole bootstrap against the same tables at the same time.
    const firstCall = ensureDemoClassroom();
    resetDemoClassroomCacheForTests();
    const secondCall = ensureDemoClassroom();
    const [first, second] = await Promise.all([firstCall, secondCall]);

    assert.deepEqual(second, first);
    const { state } = current;
    assert.equal(state.students.filter((s) => s.studentId === DEMO_INSTRUCTOR_LOGIN).length, 1);
    assert.equal(state.classes.length, 1);
    assert.equal(state.links.length, 1);
    assert.equal(state.availability.length, 5);
    assert.equal(state.students.filter((s) => String(s.studentId).startsWith("demo-starter-")).length, 4);
    assert.equal(state.enrollments.length, 4);
    // Each starter's progress was written once, not once per process.
    assert.equal(state.events.length, 3);
    assert.equal(state.goals.length, 5);
  });

  it("retries the whole bootstrap once when the first attempt hits P2002", async () => {
    current = createFakeDb({ instructorUpsertErrors: [uniqueViolation()] });

    const classroom = await ensureDemoClassroom();

    assert.equal(current.instructorUpsertData.length, 2);
    assert.equal(classroom.instructorId, studentByLogin(DEMO_INSTRUCTOR_LOGIN).id);
  });

  it("gives up after one retry and does not keep the failed attempt", async () => {
    current = createFakeDb({
      instructorUpsertErrors: [uniqueViolation(), uniqueViolation()],
    });

    await assert.rejects(ensureDemoClassroom(), (error: unknown) => (error as Row).code === "P2002");
    assert.equal(current.instructorUpsertData.length, 2);

    // Both queued errors are spent, so a later call starts over and succeeds.
    const classroom = await ensureDemoClassroom();
    assert.equal(classroom.instructorId, studentByLogin(DEMO_INSTRUCTOR_LOGIN).id);
  });

  it("clears the memo when the bootstrap fails, so a later call retries", async () => {
    current = createFakeDb({ instructorUpsertErrors: [new Error("database is down")] });

    await assert.rejects(ensureDemoClassroom(), /database is down/);
    const classroom = await ensureDemoClassroom();

    assert.equal(classroom.instructorId, studentByLogin(DEMO_INSTRUCTOR_LOGIN).id);
  });

  it("reports the instructor's current session version", async () => {
    current = createFakeDb({
      students: [
        {
          id: "inst-1",
          studentId: DEMO_INSTRUCTOR_LOGIN,
          role: "teacher",
          demoAccount: "instructor",
          sessionVersion: 4,
        },
      ],
    });

    const classroom = await ensureDemoClassroom();

    assert.equal(classroom.instructorId, "inst-1");
    assert.equal(classroom.instructorSessionVersion, 4);
  });

  it("refuses to adopt a real account that holds the demo instructor's login", async () => {
    current = createFakeDb({
      students: [
        { id: "real-1", studentId: DEMO_INSTRUCTOR_LOGIN, role: "teacher", demoAccount: null, sessionVersion: 0 },
      ],
    });

    await assert.rejects(ensureDemoClassroom(), /not a demo instructor/);
    assert.equal(current.state.classes.length, 0);
  });

  it("refuses to adopt a class that holds the demo class code but was not made by the demo instructor", async () => {
    // A real teacher who names a class "Cohort Demo" gets exactly this code.
    current = createFakeDb({
      classes: [
        { id: "cls-real", code: DEMO_CLASS_CODE, name: "Cohort Demo", createdById: "teacher-real" },
      ],
    });

    await assert.rejects(ensureDemoClassroom(), /not the demo class/);

    const { state } = current;
    assert.equal(state.links.length, 0);
    assert.equal(state.enrollments.length, 0);
    assert.equal(state.availability.length, 0);
    assert.equal(state.students.filter((s) => String(s.studentId).startsWith("demo-starter-")).length, 0);
    assert.deepEqual(state.classes, [
      { id: "cls-real", code: DEMO_CLASS_CODE, name: "Cohort Demo", createdById: "teacher-real" },
    ]);
  });

  it("fails closed when the class has no creator, as after the demo instructor was deleted", async () => {
    current = createFakeDb({
      classes: [{ id: "cls-orphan", code: DEMO_CLASS_CODE, name: DEMO_CLASS_NAME, createdById: null }],
    });

    await assert.rejects(ensureDemoClassroom(), /not the demo class/);

    assert.equal(current.state.links.length, 0);
    assert.equal(current.state.enrollments.length, 0);
  });

  it("asks every upsert to change nothing on a row that already exists", async () => {
    await ensureDemoClassroom();

    // Exactly one call per table, each with an empty update. A non-empty update
    // would let the bootstrap rewrite a real account or class that holds a demo key.
    assert.deepEqual(current.upsertUpdates.student, [{}]);
    assert.deepEqual(current.upsertUpdates.spokesClass, [{}]);
    assert.deepEqual(current.upsertUpdates.spokesClassInstructor, [{}]);

    // And a new instructor is created with no way to sign in by password.
    assert.equal(current.instructorUpsertData.length, 1);
    const create = current.instructorUpsertData[0];
    assert.equal("passwordHash" in create, false);
    assert.equal("email" in create, false);
  });
});

describe("starter students", () => {
  it("gives starter 4 a completed monthly goal and the welcome event", async () => {
    await ensureDemoClassroom();

    const goals = goalsFor("demo-starter-4");
    assert.deepEqual(
      goals.map((g) => [g.level, g.content, g.status]),
      [
        ["bhag", "Get a full-time job in warehouse logistics", "active"],
        ["monthly", "Earn my forklift certification", "completed"],
        ["weekly", "Apply to three warehouse jobs", "active"],
      ],
    );

    const starterId = studentByLogin("demo-starter-4").id;
    const event = current.state.events.find((e) => e.studentId === starterId);
    assert.ok(event, "starter 4 has no welcome event");
    assert.equal(event.eventType, WELCOME_COMPLETE_EVENT.eventType);
    assert.equal(event.sourceType, WELCOME_COMPLETE_EVENT.sourceType);
    assert.equal(event.sourceId, WELCOME_COMPLETE_EVENT.sourceId);
    assert.equal(event.xp, 0);
  });

  it("hangs each goal under the one before it, so the teacher's goal tree nests", async () => {
    await ensureDemoClassroom();

    const goals = goalsFor("demo-starter-4");
    assert.equal(goals[0].parentId, null);
    assert.equal(goals[1].parentId, goals[0].id);
    assert.equal(goals[2].parentId, goals[1].id);
  });

  it("sets starter 3 up with an active big vision and an active monthly goal", async () => {
    await ensureDemoClassroom();

    assert.deepEqual(
      goalsFor("demo-starter-3").map((g) => [g.level, g.content, g.status]),
      [
        ["bhag", "Work as a medical assistant at a clinic near home", "active"],
        ["monthly", "Finish the IC3 Digital Literacy course", "active"],
      ],
    );
    assert.deepEqual(goalsFor("demo-starter-1"), []);
    assert.deepEqual(goalsFor("demo-starter-2"), []);
  });

  it("records the welcome event for starters 2, 3 and 4 only", async () => {
    await ensureDemoClassroom();

    const withEvent = current.state.events.map((e) => e.studentId).sort();
    const expected = ["demo-starter-2", "demo-starter-3", "demo-starter-4"]
      .map((login) => studentByLogin(login).id)
      .sort();
    assert.deepEqual(withEvent, expected);
  });

  it("completes the first ceil(share x n) orientation items by sortOrder", async () => {
    current = createFakeDb({ orientationItems: FIVE_ITEMS });

    await ensureDemoClassroom();

    assert.deepEqual(progressItemIds("demo-starter-1"), []);
    // Half of five rounds up to three: the items with sortOrder 1, 2 and 3.
    assert.deepEqual(progressItemIds("demo-starter-2"), ["item-a", "item-b", "item-c"]);
    assert.deepEqual(progressItemIds("demo-starter-3"), ["item-a", "item-b", "item-c", "item-d", "item-e"]);
    assert.deepEqual(progressItemIds("demo-starter-4"), ["item-a", "item-b", "item-c", "item-d", "item-e"]);

    for (const row of current.state.progress) {
      assert.equal(row.completed, true);
      assert.ok(row.completedAt instanceof Date);
    }
  });

  it("writes no orientation progress when there are no orientation items", async () => {
    current = createFakeDb({ orientationItems: [] });

    await ensureDemoClassroom();

    assert.deepEqual(current.state.progress, []);
    assert.equal(current.calls.includes("orientationProgress.createMany"), false);
  });

  it("writes each new starter's rows inside one transaction", async () => {
    current = createFakeDb({ orientationItems: FIVE_ITEMS });

    await ensureDemoClassroom();

    const perStarterTables = [
      "student.create",
      "studentClassEnrollment",
      "orientationProgress",
      "goal",
      "progressionEvent",
    ];
    const starterWrites = current.writes.filter((w) => perStarterTables.includes(w.table));
    assert.ok(starterWrites.length > 0);
    assert.ok(starterWrites.every((w) => w.inTx), "a starter row was written outside the transaction");
    assert.equal(current.calls.filter((c) => c === "student.create").length, 4);
  });

  it("drops each new starter's cached chat context, which prismaAdmin writes do not do", async () => {
    await ensureDemoClassroom();

    const starterIds = current.state.students
      .filter((s) => String(s.studentId).startsWith("demo-starter-"))
      .map((s) => s.id)
      .sort();
    assert.equal(starterIds.length, 4);
    assert.deepEqual([...invalidatedChatContexts].sort(), starterIds);
  });

  it("drops no cached context on a second run, when nothing was written", async () => {
    await ensureDemoClassroom();
    invalidatedChatContexts.length = 0;

    resetDemoClassroomCacheForTests();
    await ensureDemoClassroom();

    assert.deepEqual(invalidatedChatContexts, []);
  });

  it("treats a starter another request created first as already there", async () => {
    current = createFakeDb({
      orientationItems: FIVE_ITEMS,
      hiddenFromFindMany: ["demo-starter-2"],
      students: [
        {
          id: "stu-raced",
          studentId: "demo-starter-2",
          displayName: "Devon Price",
          role: "student",
          demoAccount: "student",
          sessionVersion: 0,
        },
      ],
    });

    await ensureDemoClassroom();

    const state = current.state;
    assert.equal(state.students.filter((s) => s.studentId === "demo-starter-2").length, 1);
    assert.equal(state.enrollments.some((e) => e.studentId === "stu-raced"), false);
    assert.equal(state.enrollments.length, 3);
    assert.equal(state.events.some((e) => e.studentId === "stu-raced"), false);
  });

  it("leaves an existing starter's progress alone and only fills in the missing ones", async () => {
    current = createFakeDb({
      orientationItems: FIVE_ITEMS,
      students: [
        {
          id: "stu-existing",
          studentId: "demo-starter-1",
          displayName: "Maya Torres",
          role: "student",
          demoAccount: "student",
          sessionVersion: 0,
        },
      ],
    });

    await ensureDemoClassroom();

    const state = current.state;
    assert.equal(state.students.filter((s) => s.studentId === "demo-starter-1").length, 1);
    assert.equal(state.enrollments.some((e) => e.studentId === "stu-existing"), false);
    assert.equal(state.enrollments.length, 3);
    assert.equal(state.students.filter((s) => String(s.studentId).startsWith("demo-starter-")).length, 4);
  });
});

describe("instructor availability", () => {
  it("opens Monday to Friday, 9:00 to 12:00, in 30-minute virtual slots", async () => {
    await ensureDemoClassroom();

    const instructorId = studentByLogin(DEMO_INSTRUCTOR_LOGIN).id;
    const rows = current.state.availability;
    assert.equal(rows.length, 5);
    // 0 is Sunday in this app (see buildBookableAdvisorSlots), so Monday to Friday is 1 to 5.
    assert.deepEqual(rows.map((r) => r.weekday).sort(), [1, 2, 3, 4, 5]);
    for (const row of rows) {
      assert.equal(row.advisorId, instructorId);
      assert.equal(row.startMinutes, 540);
      assert.equal(row.endMinutes, 720);
      assert.equal(row.slotMinutes, 30);
      assert.equal(row.locationType, "virtual");
      assert.equal(row.locationLabel, "Demo meeting");
      assert.equal("meetingUrl" in row, false);
    }
  });

  it("produces bookable slots on weekdays only, through the real slot builder", async () => {
    await ensureDemoClassroom();
    const instructorId = String(studentByLogin(DEMO_INSTRUCTOR_LOGIN).id);

    const advisors = buildBookableAdvisorSlots({
      advisors: current.state.availability.map((row) => ({
        id: String(row.id),
        advisorId: instructorId,
        advisorName: DEMO_INSTRUCTOR_NAME,
        advisorEmail: null,
        weekday: Number(row.weekday),
        startMinutes: Number(row.startMinutes),
        endMinutes: Number(row.endMinutes),
        slotMinutes: Number(row.slotMinutes),
        locationType: "virtual",
        locationLabel: String(row.locationLabel),
        meetingUrl: null,
        active: true,
      })),
      appointments: [],
      // A Sunday morning, so the first bookable day is the Monday after it.
      now: new Date("2026-10-18T06:00:00.000Z"),
      days: 14,
      maxSlotsPerAdvisor: 500,
    });

    assert.equal(advisors.length, 1);
    const days = new Set(advisors[0].slots.map((slot) => new Date(slot.startsAt).getUTCDay()));
    assert.deepEqual([...days].sort(), [1, 2, 3, 4, 5]);
    // Six 30-minute slots a day on ten weekdays in two weeks.
    assert.equal(advisors[0].slots.length, 60);
  });

  it("ends with five slots when another request adds them after the count", async () => {
    await ensureDemoClassroom();
    const instructor = studentByLogin(DEMO_INSTRUCTOR_LOGIN);
    const slots = current.state.availability.map((row) => ({ ...row }));

    // The same tables again, but this run's count misses the slots that are already there.
    resetDemoClassroomCacheForTests();
    current = createFakeDb({
      students: [{ ...instructor }],
      availability: slots,
      availabilityCountReadsZero: true,
    });
    await ensureDemoClassroom();

    assert.equal(current.state.availability.length, 5);
  });

  it("does not add slots when the instructor already has some", async () => {
    current = createFakeDb({
      students: [
        {
          id: "inst-1",
          studentId: DEMO_INSTRUCTOR_LOGIN,
          role: "teacher",
          demoAccount: "instructor",
          sessionVersion: 0,
        },
      ],
      availability: [{ id: "mine", advisorId: "inst-1", weekday: 3, startMinutes: 600, endMinutes: 660 }],
    });

    await ensureDemoClassroom();

    assert.equal(current.state.availability.length, 1);
    assert.equal(current.calls.includes("advisorAvailability.createMany"), false);
  });
});
