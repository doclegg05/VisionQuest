/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding accepts many signatures */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

/**
 * The runner, with Prisma and the SMS sender mocked. What is asserted here is
 * the wiring the pure selectors cannot see: both flags have to admit a class
 * before anyone is texted, per-student writes run inside that student's RLS
 * context, a dry run touches nothing, and no student id reaches the response.
 */

const state = {
  connectScope: "all" as string,
  smsScope: "all" as string,
  connections: [] as any[],
  events: [] as any[],
  outbound: [] as any[],
  alerts: [] as any[],
  savedJobs: [] as any[],
  enrollments: [] as any[],
  leads: [] as any[],
  rlsContexts: [] as string[],
  alertUpserts: [] as any[],
  alertResolves: [] as any[],
  sent: [] as any[],
  rankedFits: [] as any[],
  adminPrivileged: true,
  lockAvailable: true,
  /** Every SQL statement the run lock issued, in order. */
  lockSql: [] as string[],
  /** Every statement issued on the CLIENT (outside a transaction). */
  clientRawSql: [] as string[],
  /** The options each $transaction call was given. */
  txOptions: [] as Array<Record<string, unknown> | undefined>,
  /** Set while the lock transaction is open, so a second run can contend. */
  lockHeld: false,
  /** The `take` the enrollment query asked for, and the roster it was asked about. */
  enrollmentTake: undefined as number | undefined,
  weeklyDedupeIds: [] as string[],
};

const prismaAdmin = {
  connection: {
    findMany: mock.fn(async ({ where }: any) => {
      if (where.id?.in) return state.connections.filter((c) => where.id.in.includes(c.id));
      const wanted: string[] = where.status?.in ?? [];
      return state.connections.filter((c) => wanted.includes(c.status));
    }),
  },
  connectionEvent: { findMany: mock.fn(async () => state.events) },
  outboundMessage: {
    /**
     * Applies the filters the production code relies on. A mock that ignored
     * them would make every dedupe test pass by returning nothing useful — the
     * 8-days-ago and failed-send cases below exist precisely because they only
     * mean something against a where clause that is honoured.
     */
    findMany: mock.fn(async ({ where }: any) => {
      if (where.templateKey === "weekly_jobs" && where.toId?.in) {
        state.weeklyDedupeIds = where.toId.in as string[];
      }
      return state.outbound.filter((row) => {
        if (where.status && row.status !== where.status) return false;
        if (where.templateKey?.in && !where.templateKey.in.includes(row.templateKey)) return false;
        if (where.templateKey && typeof where.templateKey === "string") {
          if (row.templateKey !== where.templateKey) return false;
        }
        if (where.sentAt?.gte && row.sentAt < where.sentAt.gte) return false;
        if (where.expectsReply?.not === null && row.expectsReply == null) return false;
        if (where.repliedAt === null && row.repliedAt != null) return false;
        if (where.toId?.in && !where.toId.in.includes(row.toId)) return false;
        return true;
      });
    }),
  },
  studentAlert: {
    findMany: mock.fn(async ({ where }: any) => {
      if (where.alertKey?.in) {
        return state.alerts.filter((a) => where.alertKey.in.includes(a.alertKey));
      }
      if (where.type?.in) return state.alerts.filter((a) => where.type.in.includes(a.type));
      return state.alerts;
    }),
  },
  studentSavedJob: { findMany: mock.fn(async () => state.savedJobs) },
  studentClassEnrollment: {
    // Honours `take`, because the ceiling under test IS the take: a mock that
    // returned the whole roster regardless would make the query's bound
    // untestable and the test would pass with the bound removed.
    findMany: mock.fn(async ({ take }: { take?: number }) => {
      state.enrollmentTake = take;
      return typeof take === "number" ? state.enrollments.slice(0, take) : state.enrollments;
    }),
  },
  jobLead: { findMany: mock.fn(async () => state.leads) },
  // Nothing should reach the CLIENT-level raw query any more: the run lock is
  // transaction-scoped, so its acquire happens on `tx` and its release is the
  // COMMIT. A statement here is what a leaked session lock would look like.
  // The F63 probe is mocked at its own module below, so the two cannot be
  // confused for each other.
  $queryRaw: mock.fn(async (strings: TemplateStringsArray) => {
    state.clientRawSql.push(strings.raw.join("?"));
    return [{ locked: state.lockAvailable, released: true }];
  }),
  $transaction: mock.fn(
    async (fn: (tx: unknown) => Promise<unknown>, options?: Record<string, unknown>) => {
      state.txOptions.push(options);
      const tx = {
        $queryRaw: async (strings: TemplateStringsArray) => {
          const sql = strings.raw.join("?");
          state.lockSql.push(sql);
          // A transaction lock is held for the life of the transaction, so a
          // concurrent caller sees it as taken. `lockAvailable: false` is the
          // simulated second run.
          const locked = state.lockAvailable && !state.lockHeld;
          if (locked) state.lockHeld = true;
          return [{ locked }];
        },
      };
      try {
        return await fn(tx);
      } finally {
        // COMMIT or ROLLBACK: either way the lock is gone, with no separate
        // unlock statement to route anywhere.
        state.lockHeld = false;
      }
    },
  ),
};

mock.module("@/lib/db", { namedExports: { prismaAdmin, prisma: prismaAdmin } });
mock.module("@/lib/rls-context", {
  namedExports: {
    withStudentRlsContext: async (studentId: string, fn: () => unknown) => {
      state.rlsContexts.push(studentId);
      return fn();
    },
  },
});
mock.module("@/lib/connect/flags", {
  namedExports: {
    getConnectScope: async () => parseScope(state.connectScope),
    getSmsNudgeScope: async () => parseScope(state.smsScope),
    isConnectEnabledForClasses: (scope: any, classIds: string[]) => {
      if (scope.mode === "off") return false;
      if (scope.mode === "all") return true;
      return classIds.some((id) => scope.classIds.includes(id));
    },
  },
});
mock.module("@/lib/connect/matching", {
  namedExports: { rankLeadsForStudent: async () => state.rankedFits },
});
mock.module("./admin-guard", {
  namedExports: {
    adminClientIsPrivileged: async () => state.adminPrivileged,
    resetAdminClientProbe: () => {},
  },
});
mock.module("./alerts", {
  namedExports: {
    upsertNudgeAlert: async (plan: any) => {
      state.alertUpserts.push(plan);
    },
    resolveNudgeAlerts: async (keys: string[]) => {
      state.alertResolves.push(keys);
      return keys.length;
    },
  },
});
mock.module("./sms-policy", {
  namedExports: {
    sendPolicySms: async (input: any) => {
      state.sent.push(input);
      return { status: "sent" as const, outboundMessageId: "om_1" };
    },
  },
});
mock.module("@/lib/logger", {
  namedExports: {
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  },
});

function parseScope(raw: string) {
  if (!raw) return { mode: "off" as const };
  if (raw === "all") return { mode: "all" as const };
  return { mode: "classes" as const, classIds: raw.split(",") };
}

let runNudges: typeof import("./schedule").runNudges;

before(async () => {
  ({ runNudges } = await import("./schedule"));
});

const NOW = new Date("2026-09-08T14:00:00Z"); // Tuesday 10:00 EDT
const MONDAY = new Date("2026-09-07T14:00:00Z"); // Monday 10:00 EDT
const STUDENT = "stu_1";

function daysBefore(days: number, from: Date = NOW): Date {
  return new Date(from.getTime() - days * 24 * 60 * 60 * 1000);
}

function unviewedConnection() {
  return {
    id: "con_1",
    studentId: STUDENT,
    status: "sent",
    sentAt: daysBefore(4),
    employerViewedAt: null,
    statusChangedAt: daysBefore(4),
    interviewAppointmentId: null,
    employer: { name: "Mountain Metals" },
    jobLead: { title: "Production Associate" },
    interviewAppointment: null,
  };
}

beforeEach(() => {
  state.connectScope = "all";
  state.smsScope = "all";
  state.connections = [];
  state.events = [];
  state.outbound = [];
  state.alerts = [];
  state.savedJobs = [];
  state.enrollments = [{ studentId: STUDENT, classId: "class_1" }];
  state.leads = [];
  state.rlsContexts = [];
  state.alertUpserts = [];
  state.alertResolves = [];
  state.sent = [];
  state.rankedFits = [];
  state.adminPrivileged = true;
  state.lockAvailable = true;
  state.lockSql = [];
  state.clientRawSql = [];
  state.txOptions = [];
  state.lockHeld = false;
  state.enrollmentTake = undefined;
  state.weeklyDedupeIds = [];
});

describe("flags gate everything", () => {
  it("does nothing at all when Connect is off", async () => {
    state.connectScope = "";
    state.connections = [unviewedConnection()];
    const result = await runNudges({ now: NOW });
    assert.equal(result.connectScope, "off");
    assert.equal(result.alertsPlanned, 0);
    assert.equal(result.textsPlanned, 0);
    assert.equal(prismaAdmin.connection.findMany.mock.callCount(), 0);
  });

  it("raises employer alerts with Connect on but SMS off, and sends no text", async () => {
    state.smsScope = "";
    state.connections = [
      unviewedConnection(),
      {
        ...unviewedConnection(),
        id: "con_2",
        status: "started",
        sentAt: daysBefore(60),
      },
    ];
    state.events = [{ connectionId: "con_2", toStatus: "started", note: null, at: daysBefore(31) }];

    const result = await runNudges({ now: NOW });
    assert.equal(result.alertsWritten, 1, "the no-view alert still fires");
    assert.equal(result.textsPlanned, 0, "SMS off means no retention text");
    assert.equal(state.sent.length, 0);
  });

  it("texts only students in a class BOTH flags admit", async () => {
    state.connectScope = "class_1,class_2";
    state.smsScope = "class_2";
    state.enrollments = [
      { studentId: "stu_in", classId: "class_2" },
      { studentId: "stu_out", classId: "class_1" },
    ];
    state.connections = ["stu_in", "stu_out"].map((studentId, index) => ({
      ...unviewedConnection(),
      id: `con_${index}`,
      studentId,
      status: "started",
      sentAt: daysBefore(60),
    }));
    state.events = state.connections.map((c) => ({
      connectionId: c.id,
      toStatus: "started",
      note: null,
      at: daysBefore(31),
    }));

    await runNudges({ now: NOW });
    assert.equal(state.sent.length, 1);
    assert.equal(state.sent[0].studentId, "stu_in");
  });
});

describe("writes", () => {
  it("writes each alert inside its own student's RLS context", async () => {
    state.connections = [unviewedConnection()];
    await runNudges({ now: NOW });
    assert.equal(state.alertUpserts.length, 1);
    assert.ok(state.rlsContexts.includes(STUDENT));
  });

  it("resolves an employer alert once the employer has opened the link", async () => {
    state.alerts = [
      {
        alertKey: "connect_employer_no_view:con_1",
        type: "connect_employer_no_view",
        sourceId: "con_1",
        studentId: STUDENT,
      },
    ];
    state.connections = [
      { ...unviewedConnection(), status: "viewed", employerViewedAt: daysBefore(1) },
    ];
    const result = await runNudges({ now: NOW });
    assert.equal(result.alertsResolved, 1);
    assert.deepEqual(state.alertResolves[0], ["connect_employer_no_view:con_1"]);
  });

  it("a dry run plans without writing, sending, or resolving", async () => {
    state.connections = [unviewedConnection()];
    const result = await runNudges({ now: NOW, dryRun: true });
    assert.equal(result.alertsPlanned, 1);
    assert.equal(result.alertsWritten, 0);
    assert.equal(state.alertUpserts.length, 0);
    assert.equal(state.sent.length, 0);
    assert.equal(state.alertResolves.length, 0);
  });
});

describe("the weekly jobs nudge", () => {
  it("does not run outside the Monday 10:00 ET slot", async () => {
    state.leads = [{ id: "lead_1" }];
    state.rankedFits = [{ lead: { id: "lead_1" }, fit: { score: 80 } }];
    const result = await runNudges({ now: NOW });
    assert.equal(result.weeklySlot, false);
    assert.equal(state.sent.length, 0);
  });

  it("texts a count of NEW leads above the fit floor, and skips a student with none", async () => {
    state.leads = [{ id: "lead_new" }];
    state.enrollments = [
      { studentId: "stu_a", classId: "class_1" },
      { studentId: "stu_b", classId: "class_1" },
    ];
    state.rankedFits = [
      { lead: { id: "lead_new" }, fit: { score: 80 } },
      { lead: { id: "lead_old" }, fit: { score: 95 } }, // not in this week's set
      { lead: { id: "lead_new" }, fit: { score: 10 } }, // below the floor
    ];

    const result = await runNudges({ now: MONDAY });
    assert.equal(result.weeklySlot, true);
    assert.equal(state.sent.length, 2, "both students are in scope");
    for (const call of state.sent) {
      assert.equal(call.templateKey, "weekly_jobs");
      assert.match(call.body, /^SPOKES: 1 new jobs? near you this week\./);
      assert.equal(call.expectsReply, "weekly_jobs");
    }
  });

  it("caps a 1,000-student roster at the ceiling, in the query and in the loop", async () => {
    // Two bounds, and the in-loop one was DEAD: it read `.has(studentId)`
    // after `.set()`, so the condition was false by construction and the
    // `break` never fired. Every student on the roster was therefore ranked
    // (one `rankLeadsForStudent` each) before a `.slice()` threw the tail
    // away, and the whole roster was fetched to build it.
    state.leads = [{ id: "lead_new" }];
    state.rankedFits = [{ lead: { id: "lead_new" }, fit: { score: 80 } }];
    state.enrollments = Array.from({ length: 1000 }, (_, i) => ({
      studentId: `stu_${String(i).padStart(4, "0")}`,
      classId: "class_1",
    }));

    await runNudges({ now: MONDAY });

    assert.ok(
      (state.enrollmentTake ?? Infinity) <= 800,
      `the enrollment query must be bounded; asked for ${String(state.enrollmentTake)}`,
    );
    assert.ok(
      state.weeklyDedupeIds.length <= 200,
      `the dedupe lookup got ${state.weeklyDedupeIds.length} ids; the ceiling is 200`,
    );
    assert.ok(state.weeklyDedupeIds.length > 0, "and it is not empty — the cap must not zero it");
    assert.ok(state.sent.length <= 200, `sent ${state.sent.length} texts in one sweep`);
  });

  it("keeps every class of a student already inside the ceiling", async () => {
    // The break must bound STUDENTS, not rows: dropping a second class for a
    // student already counted would silently narrow the flag check that
    // decides whether they are in scope at all.
    state.leads = [{ id: "lead_new" }];
    state.rankedFits = [{ lead: { id: "lead_new" }, fit: { score: 80 } }];
    state.enrollments = [
      { studentId: "stu_a", classId: "class_other" },
      { studentId: "stu_a", classId: "class_1" },
    ];

    await runNudges({ now: MONDAY });
    assert.equal(state.sent.length, 1, "stu_a is in scope through their second class");
  });

  it("sends nothing when no lead was created this week", async () => {
    state.leads = [];
    const result = await runNudges({ now: MONDAY });
    assert.equal(result.weeklySlot, true);
    assert.equal(state.sent.length, 0);
  });

  it("texts a student at most once a week, even if the route is re-run by hand", async () => {
    state.leads = [{ id: "lead_new" }];
    state.rankedFits = [{ lead: { id: "lead_new" }, fit: { score: 80 } }];
    // The outbound query for the weekly dedupe returns this student's row.
    state.outbound = [
      {
        toId: STUDENT,
        templateKey: "weekly_jobs",
        connectionId: null,
        status: "sent",
        sentAt: NOW,
        expectsReply: null,
        repliedAt: NOW,
      },
    ];
    const result = await runNudges({ now: MONDAY });
    assert.equal(result.weeklySlot, true);
    assert.equal(state.sent.length, 0, "a second weekly text in the same week is the one that gets blocked");
  });
});

describe("the result is safe to log and to hand to a cron", () => {
  it("names students only by a one-way key", async () => {
    state.connections = [unviewedConnection()];
    const result = await runNudges({ now: NOW });
    const json = JSON.stringify(result);
    assert.ok(!json.includes(STUDENT), `the plan leaked a student id: ${json}`);
    assert.ok(result.plan.length > 0, "the plan is not empty");
    assert.ok(result.plan.every((row) => row.student.length > 0));
  });
});

describe('"got an interview?" after a self-directed apply', () => {
  function appliedEightDaysAgo() {
    return {
      id: "sj_1",
      studentId: STUDENT,
      status: "applied",
      appliedAt: daysBefore(8),
      jobListing: { title: "Production Associate" },
    };
  }

  it("asks once per saved job and never after a DELIVERED ask", async () => {
    state.savedJobs = [appliedEightDaysAgo()];
    const first = await runNudges({ now: NOW });
    assert.equal(first.textsPlanned, 1);
    assert.equal(state.sent[0].templateKey, "heard_back:sj_1");

    state.sent = [];
    state.outbound = [
      {
        connectionId: null,
        toId: STUDENT,
        templateKey: "heard_back:sj_1",
        expectsReply: "heard_back:sj_1",
        status: "sent",
        sentAt: daysBefore(1),
        repliedAt: NOW,
      },
    ];
    const second = await runNudges({ now: NOW });
    assert.equal(second.textsPlanned, 0);
  });

  it("a FAILED send does not suppress the ask once the backoff has passed", async () => {
    state.savedJobs = [appliedEightDaysAgo()];
    state.outbound = [
      {
        connectionId: null,
        toId: STUDENT,
        templateKey: "heard_back:sj_1",
        expectsReply: null,
        status: "failed",
        sentAt: daysBefore(2),
        repliedAt: null,
      },
    ];
    const result = await runNudges({ now: NOW });
    assert.equal(result.textsPlanned, 1, "a message that never arrived was never asked");
  });

  it("a FAILED send inside the 24h backoff DOES suppress it", async () => {
    state.savedJobs = [appliedEightDaysAgo()];
    state.outbound = [
      {
        connectionId: null,
        toId: STUDENT,
        templateKey: "heard_back:sj_1",
        expectsReply: null,
        status: "failed",
        sentAt: new Date(NOW.getTime() - 60 * 60 * 1000),
        repliedAt: null,
      },
    ];
    const result = await runNudges({ now: NOW });
    assert.equal(result.textsPlanned, 0);
  });
});

describe("the weekly dedupe window", () => {
  it("a text sent 8 days ago does NOT suppress this week's", async () => {
    state.leads = [{ id: "lead_new" }];
    state.rankedFits = [{ lead: { id: "lead_new" }, fit: { score: 80 } }];
    state.outbound = [
      {
        toId: STUDENT,
        templateKey: "weekly_jobs",
        connectionId: null,
        status: "sent",
        sentAt: daysBefore(8),
        expectsReply: null,
        repliedAt: NOW,
      },
    ];
    const result = await runNudges({ now: MONDAY });
    assert.equal(result.weeklySlot, true);
    assert.equal(state.sent.length, 1, "last week's text is not this week's");
  });

  it("a FAILED weekly text does not count as sent", async () => {
    state.leads = [{ id: "lead_new" }];
    state.rankedFits = [{ lead: { id: "lead_new" }, fit: { score: 80 } }];
    state.outbound = [
      {
        toId: STUDENT,
        templateKey: "weekly_jobs",
        connectionId: null,
        status: "failed",
        sentAt: daysBefore(1),
        expectsReply: null,
        repliedAt: null,
      },
    ];
    await runNudges({ now: MONDAY });
    assert.equal(state.sent.length, 1);
  });
});

describe("guards that stop the run entirely", () => {
  it("refuses to sweep when the admin client is not RLS-bypassing (F63)", async () => {
    state.adminPrivileged = false;
    state.connections = [unviewedConnection()];
    const result = await runNudges({ now: NOW });
    assert.equal(result.skipped, "admin client not privileged");
    assert.equal(result.alertsPlanned, 0);
    assert.equal(state.alertUpserts.length, 0);
  });

  it("skips when another sweep already holds the run lock", async () => {
    state.lockAvailable = false;
    state.connections = [unviewedConnection()];
    const result = await runNudges({ now: NOW });
    assert.equal(result.skipped, "already running");
    assert.equal(state.alertUpserts.length, 0);
  });

  it("takes the run lock inside a transaction, and never unlocks it separately", async () => {
    state.connections = [unviewedConnection()];
    await runNudges({ now: NOW });

    assert.equal(state.lockSql.length, 1, "exactly one lock statement per run");
    const sql = state.lockSql[0];
    assert.match(
      sql,
      /pg_try_advisory_xact_lock/,
      "the lock must be TRANSACTION-scoped: a session lock's release is a separate " +
        "query the pooler can route to another backend, which leaks it forever",
    );
    assert.doesNotMatch(sql, /pg_try_advisory_lock\(/, "no session-scoped acquire");
    assert.match(sql, /hashtext/);

    // The whole point: there is nothing to unlock.
    const everySql = [...state.lockSql, ...state.clientRawSql].join(" ");
    assert.doesNotMatch(everySql, /pg_advisory_unlock/, "an unlock statement is the leak");
    assert.equal(state.clientRawSql.length, 0, "the lock never runs off the transaction");

    // Bounded, so one wedged sweep cannot hold a pooled connection forever.
    const options = state.txOptions[0] as { timeout?: number; maxWait?: number };
    assert.ok((options?.timeout ?? 0) > 0, "the transaction must carry a timeout");
    assert.ok((options?.maxWait ?? 0) > 0, "and a maxWait, so it queues rather than hangs");
  });

  it("two overlapping runs: exactly one proceeds, and the next run after them is clean", async () => {
    // The regression this replaces had the opposite shape: run 1 leaked a
    // session lock, so run 1 succeeded and runs 2-10 ALL reported "already
    // running" forever. Two properties pin it. First, of two overlapping runs
    // exactly one proceeds -- asserted without pinning WHICH, because that is
    // a scheduling detail and pinning it would make the test lie about what
    // the lock guarantees. Second, a later run finds the lock free again,
    // which is what the leak broke.
    state.connections = [unviewedConnection()];

    const [a, b] = await Promise.all([runNudges({ now: NOW }), runNudges({ now: NOW })]);
    const skipped = [a, b].filter((r) => r.skipped === "already running");
    const ran = [a, b].filter((r) => r.skipped === null);
    assert.equal(skipped.length, 1, "one of the two overlapping runs must be turned away");
    assert.equal(ran.length, 1, "and exactly one must proceed");
    assert.equal(ran[0].alertsPlanned, 1, "the run that proceeded did the work");

    // The leak test: after both have finished, the lock is free.
    state.alertUpserts = [];
    const later = await runNudges({ now: NOW });
    assert.equal(later.skipped, null, "a transaction lock cannot survive its transaction");
  });

  it("a dry run needs no lock — it writes nothing anyway", async () => {
    state.lockAvailable = false;
    state.connections = [unviewedConnection()];
    const result = await runNudges({ now: NOW, dryRun: true });
    assert.equal(result.skipped, null);
    assert.equal(result.alertsPlanned, 1);
  });
});

describe("one open question at a time", () => {
  it("defers a retention text while a heard-back question is still open", async () => {
    // Both are answered with one character, and a reply resolves the most
    // recent one — two in flight means a "Y" lands on the wrong question.
    state.connections = [
      { ...unviewedConnection(), status: "started", sentAt: daysBefore(60) },
    ];
    state.events = [
      { connectionId: "con_1", toStatus: "started", note: null, at: daysBefore(31) },
    ];
    state.outbound = [
      {
        toId: STUDENT,
        templateKey: "heard_back:sj_9",
        connectionId: null,
        status: "sent",
        sentAt: new Date(NOW.getTime() - 60 * 60 * 1000),
        expectsReply: "heard_back:sj_9",
        repliedAt: null,
      },
    ];
    const result = await runNudges({ now: NOW });
    assert.equal(result.textsPlanned, 0);
    assert.equal(result.textOutcomes["skipped:question_already_open"], 1);
  });
});
