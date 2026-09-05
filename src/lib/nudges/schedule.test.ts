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
  outboundMessage: { findMany: mock.fn(async () => state.outbound) },
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
  studentClassEnrollment: { findMany: mock.fn(async () => state.enrollments) },
  jobLead: { findMany: mock.fn(async () => state.leads) },
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
    state.outbound = [{ toId: STUDENT, templateKey: "weekly_jobs", connectionId: null }];
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

describe('"did you hear back?"', () => {
  it("asks once per saved job and never after the first ask", async () => {
    state.savedJobs = [
      {
        id: "sj_1",
        studentId: STUDENT,
        status: "applied",
        appliedAt: daysBefore(8),
        jobListing: { title: "Production Associate" },
      },
    ];
    const first = await runNudges({ now: NOW });
    assert.equal(first.textsPlanned, 1);
    assert.equal(state.sent[0].templateKey, "heard_back");

    // The second run sees the outbound row from the first.
    state.sent = [];
    state.outbound = [{ connectionId: null, templateKey: "heard_back", expectsReply: "heard_back:sj_1" }];
    const second = await runNudges({ now: NOW });
    assert.equal(second.textsPlanned, 0);
  });
});
