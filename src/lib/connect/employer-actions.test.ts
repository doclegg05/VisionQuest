/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding covers Prisma methods with different signatures. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

/**
 * The hire path is where Match & Connect meets the program's existing
 * placement reporting, so the property that matters is idempotency: a retried
 * hire must produce exactly ONE Application and exactly ONE
 * `placement_outcome_pending` alert, however many times an employer taps the
 * button or a proxy replays the POST.
 *
 * The alert half of that comes from `syncStudentAlerts`, which upserts by
 * `alertKey` — so what is pinned here is that it is CALLED, in the student's
 * own RLS context, and that the Application side never creates a second row.
 */

const state = {
  connection: null as any,
  existingOpportunity: null as any,
};

const created = {
  opportunities: [] as any[],
  applications: [] as any[],
  appointments: [] as any[],
};

const transitions: any[] = [];
const alertSyncCalls: string[] = [];
const rlsContexts: string[] = [];

const mockApplicationUpsert = mock.fn(async (args: any) => {
  const existing = created.applications.find(
    (row) =>
      row.studentId === args.where.studentId_opportunityId.studentId &&
      row.opportunityId === args.where.studentId_opportunityId.opportunityId,
  );
  if (existing) {
    Object.assign(existing, args.update);
    return { id: existing.id };
  }
  const row = { id: `app-${created.applications.length + 1}`, ...args.create };
  created.applications.push(row);
  return { id: row.id };
}) as any;

mock.module("@/lib/db", {
  namedExports: {
    prismaAdmin: {
      connection: { findUnique: async () => state.connection },
      opportunity: {
        findFirst: async () => state.existingOpportunity,
        create: async (args: any) => {
          const row = { id: `opp-${created.opportunities.length + 1}`, ...args.data };
          created.opportunities.push(row);
          state.existingOpportunity = row;
          return { id: row.id };
        },
      },
      get application() {
        return { upsert: mockApplicationUpsert };
      },
      appointment: {
        create: async (args: any) => {
          const row = { id: `appt-${created.appointments.length + 1}`, ...args.data };
          created.appointments.push(row);
          return { id: row.id };
        },
        findMany: async () => [],
      },
      advisorAvailability: { findMany: async () => [] },
    },
    prisma: {},
  },
});

mock.module("./pipeline", {
  namedExports: {
    transitionConnection: async (input: any) => {
      transitions.push(input);
      return { from: input.expectedFrom, to: input.to, studentId: "student-1" };
    },
  },
});

mock.module("@/lib/advising", {
  namedExports: {
    syncStudentAlerts: async (studentId: string) => {
      alertSyncCalls.push(studentId);
    },
  },
});

mock.module("@/lib/rls-context", {
  namedExports: {
    withStudentRlsContext: async (studentId: string, fn: () => unknown) => {
      rlsContexts.push(studentId);
      return fn();
    },
  },
});

mock.module("@/lib/audit", { namedExports: { logAuditEvent: async () => undefined } });
mock.module("@/lib/notifications", { namedExports: { sendNotification: async () => undefined } });
mock.module("@/lib/logger", {
  namedExports: { logger: { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} } },
});

let recordHired: typeof import("./employer-actions").recordHired;
let OPPORTUNITY_MIRROR_MARKER: typeof import("./employer-actions").OPPORTUNITY_MIRROR_MARKER;

before(async () => {
  const mod = await import("./employer-actions");
  recordHired = mod.recordHired;
  OPPORTUNITY_MIRROR_MARKER = mod.OPPORTUNITY_MIRROR_MARKER;
});

function connection(overrides: Record<string, unknown> = {}) {
  return {
    id: "conn-1",
    studentId: "student-1",
    sentById: "teacher-1",
    applicationId: null,
    jobLead: {
      id: "lead-1",
      title: "Production Associate",
      location: "Beckley, WV",
      employer: { name: "Mountain Metal" },
    },
    employer: { name: "Mountain Metal" },
    ...overrides,
  };
}

beforeEach(() => {
  state.connection = connection();
  state.existingOpportunity = null;
  created.opportunities.length = 0;
  created.applications.length = 0;
  created.appointments.length = 0;
  transitions.length = 0;
  alertSyncCalls.length = 0;
  rlsContexts.length = 0;
});

describe("recordHired — the outcome capture", () => {
  it("creates exactly one verified Application and one Opportunity mirror", async () => {
    await recordHired({
      connectionId: "conn-1",
      currentStatus: "interview_scheduled",
      startDate: "2026-09-15",
      hourlyWage: 16.5,
    });

    assert.equal(created.applications.length, 1);
    assert.equal(created.opportunities.length, 1);
    assert.equal(created.applications[0].status, "accepted");
    assert.equal(created.applications[0].verificationStatus, "verified");
    assert.equal(
      created.applications[0].verifiedBy,
      "teacher-1",
      "the instructor who sent the packet is the verifier",
    );
    assert.ok(
      created.opportunities[0].description.includes(`${OPPORTUNITY_MIRROR_MARKER}lead-1`),
      "the mirror must be findable when D5 retires Opportunity",
    );
  });

  it("is IDEMPOTENT: a retry creates no second Application and no second Opportunity", async () => {
    const input = {
      connectionId: "conn-1",
      currentStatus: "interview_scheduled" as const,
      startDate: "2026-09-15",
      hourlyWage: 16.5,
    };
    const first = await recordHired(input);

    // Second call: the connection now carries the applicationId the first one
    // set, which is what a real retry would see.
    state.connection = connection({ applicationId: first.applicationId });
    const second = await recordHired(input);

    assert.equal(second.applicationId, first.applicationId);
    assert.equal(created.applications.length, 1, "a retry created a second Application");
    assert.equal(created.opportunities.length, 1, "a retry created a second Opportunity");
  });

  it("reuses the Opportunity mirror when a different student is hired from the same lead", async () => {
    await recordHired({
      connectionId: "conn-1",
      currentStatus: "interested",
      startDate: "2026-09-15",
      hourlyWage: 16.5,
    });
    state.connection = connection({ id: "conn-2", studentId: "student-2" });
    await recordHired({
      connectionId: "conn-2",
      currentStatus: "interested",
      startDate: "2026-09-20",
      hourlyWage: 17,
    });

    assert.equal(created.opportunities.length, 1, "one lead, one mirrored Opportunity");
    assert.equal(created.applications.length, 2, "two students, two applications");
  });

  it("fires the placement bridge sync IN THE STUDENT'S OWN RLS CONTEXT", async () => {
    await recordHired({
      connectionId: "conn-1",
      currentStatus: "interested",
      startDate: "2026-09-15",
      hourlyWage: 16.5,
    });
    // Without the context wrapper every query inside the sync fails closed and
    // the queue item is silently never raised — the F62 class of bug.
    assert.deepEqual(alertSyncCalls, ["student-1"]);
    // Two entries, both this student: the alert sync and the student's own
    // in-app notification, which needs the same context for the same reason.
    // The assertion is that EVERY context opened here is this student's — a
    // sessionless path must never impersonate anybody else.
    assert.ok(rlsContexts.length >= 1, "the sync ran with no RLS context at all");
    assert.deepEqual([...new Set(rlsContexts)], ["student-1"]);
  });

  it("records the wage and start date on the connection, and links the application", async () => {
    await recordHired({
      connectionId: "conn-1",
      currentStatus: "offered",
      startDate: "2026-09-15",
      hourlyWage: 16.5,
    });
    const [transition] = transitions;
    assert.equal(transition.to, "hired");
    assert.equal(transition.expectedFrom, "offered");
    assert.equal(transition.actorType, "employer");
    assert.equal(transition.data.hourlyWage, 16.5);
    assert.equal(transition.data.startDate.toISOString().slice(0, 10), "2026-09-15");
    assert.ok(transition.data.application.connect.id);
    // The token is cleared, which is what makes a replay after a hire resolve
    // to the neutral page rather than the packet.
    assert.equal(transition.data.employerTokenHash, null);
    assert.equal(transition.data.tokenExpiresAt, null);
  });

  it("refuses a start date that is not a real date, before writing anything", async () => {
    await assert.rejects(
      () =>
        recordHired({
          connectionId: "conn-1",
          currentStatus: "interested",
          startDate: "not-a-date",
          hourlyWage: 16.5,
        }),
      /real date/i,
    );
    assert.equal(created.applications.length, 0);
    assert.equal(transitions.length, 0);
  });
});
