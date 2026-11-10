import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import type { AlertDescriptor } from "@/lib/advising-alerts";

// "server-only" throws at import time outside a Next.js server build.
mock.module("server-only", { namedExports: {} });

interface AlertRow {
  id: string;
  studentId: string;
  alertKey: string;
  type: string;
  severity: string;
  status: string;
  title: string;
  summary: string;
  sourceType: string;
  sourceId: string;
  detectedAt: Date;
  resolvedAt: Date | null;
  snoozedUntil: Date | null;
  snoozedBy: string | null;
  dismissedAt: Date | null;
}

type AlertValue = AlertRow[keyof AlertRow];
type Condition = AlertValue | { in?: readonly string[]; not?: string };
type Where = Partial<Record<keyof AlertRow, Condition>>;
type AlertCreate = Omit<AlertRow, "id" | "resolvedAt" | "snoozedUntil" | "snoozedBy" | "dismissedAt">;

function sameValue(a: AlertValue, b: AlertValue): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return a === b;
}

function meets(value: AlertValue, condition: Condition): boolean {
  if (condition === null || typeof condition === "string" || condition instanceof Date) {
    return sameValue(value, condition);
  }
  if (condition.in && !(typeof value === "string" && condition.in.includes(value))) return false;
  return condition.not === undefined || value !== condition.not;
}

// A one-table stand-in for the database: it applies each write to stored rows
// the way Postgres would, so the tests assert on the alert an instructor would
// see, not on the shape of a Prisma call. `statements` counts round trips.
const rows = new Map<string, AlertRow>();
let statements = 0;

function matching(where: Where): AlertRow[] {
  return [...rows.values()].filter((row) =>
    Object.entries(where).every(([field, condition]) =>
      meets(row[field as keyof AlertRow], condition as Condition),
    ),
  );
}

function requireRow(alertKey: string): AlertRow {
  const row = rows.get(alertKey);
  if (!row) throw new Error("No 'StudentAlert' record was found for an update.");
  return row;
}

const studentAlert = {
  findMany: async ({ where, select }: { where: Where; select: Partial<Record<keyof AlertRow, true>> }) => {
    statements += 1;
    return matching(where).map((row) =>
      Object.fromEntries(Object.keys(select).map((field) => [field, row[field as keyof AlertRow]])),
    );
  },
  upsert: async (args: { where: { alertKey: string }; create: AlertCreate; update: Partial<AlertRow> }) => {
    statements += 1;
    const row = rows.get(args.where.alertKey);
    rows.set(
      args.where.alertKey,
      row
        ? { ...row, ...args.update }
        : {
            id: `alert-${rows.size + 1}`,
            resolvedAt: null,
            snoozedUntil: null,
            snoozedBy: null,
            dismissedAt: null,
            ...args.create,
          },
    );
  },
  update: async ({ where, data }: { where: { alertKey: string }; data: Partial<AlertRow> }) => {
    statements += 1;
    rows.set(where.alertKey, { ...requireRow(where.alertKey), ...data });
  },
  updateMany: async ({ where, data }: { where: Where; data: Partial<AlertRow> }) => {
    statements += 1;
    const hits = matching(where);
    for (const row of hits) rows.set(row.alertKey, { ...row, ...data });
    return { count: hits.length };
  },
};
const fakeTx = { studentAlert };

mock.module("@/lib/db", {
  namedExports: {
    prisma: { $transaction: async <T>(run: (tx: typeof fakeTx) => Promise<T>): Promise<T> => run(fakeTx) },
  },
});

let sync: typeof import("@/lib/advising-sync");

before(async () => {
  sync = await import("@/lib/advising-sync");
});

beforeEach(() => {
  rows.clear();
  statements = 0;
});

const STUDENT = "student-1";
const FIRST_DAY = new Date("2026-10-01T10:35:00.000Z");
const NEXT_DAY = new Date("2026-10-02T10:35:00.000Z");
const THREE_WEEKS_LATER = new Date("2026-10-22T10:35:00.000Z");

const STALLED: AlertDescriptor = {
  alertKey: `certification_stalled:${STUDENT}`,
  type: "certification_stalled",
  severity: "medium",
  title: "Certification progress stalled",
  summary: "No Ready to Work progress in 14 days.",
  sourceType: "certification",
  sourceId: STUDENT,
};

const STALLED_LONGER: AlertDescriptor = {
  ...STALLED,
  severity: "high",
  summary: "No Ready to Work progress in 35 days.",
};

function seed(alert: AlertDescriptor, state: Partial<AlertRow> = {}): void {
  rows.set(alert.alertKey, {
    id: `alert-${rows.size + 1}`,
    studentId: STUDENT,
    ...alert,
    status: "open",
    detectedAt: FIRST_DAY,
    resolvedAt: null,
    snoozedUntil: null,
    snoozedBy: null,
    dismissedAt: null,
    ...state,
  });
}

function stored(alert: AlertDescriptor): AlertRow {
  const row = rows.get(alert.alertKey);
  assert.ok(row, `no stored alert for ${alert.alertKey}`);
  return row;
}

/** What loadStudentAlertSyncContext hands the sync: open, snoozed and dismissed rows, never resolved ones. */
function readExisting() {
  return matching({ status: { in: ["open", "snoozed", "dismissed"] } }).map(
    ({ id, alertKey, status, snoozedUntil }) => ({ id, alertKey, status, snoozedUntil }),
  );
}

async function runSync(now: Date, desiredAlerts: AlertDescriptor[], existing = readExisting()): Promise<void> {
  await sync.applyStudentAlertSyncPlan({ studentId: STUDENT, now, existing, desiredAlerts });
}

// detectedAt is when the current spell of an alert began. The intervention
// queue prints it as "Open since ..." (QueueStudentRow), so the daily sweep
// must not move it: a three-week stall has to read differently from a new one.
describe("applyStudentAlertSyncPlan detectedAt", () => {
  it("stamps a new alert with the time of the sync that found it", async () => {
    await runSync(FIRST_DAY, [STALLED]);

    assert.equal(stored(STALLED).status, "open");
    assert.deepEqual(stored(STALLED).detectedAt, FIRST_DAY);
  });

  it("keeps detectedAt when a later sync finds the alert still open", async () => {
    await runSync(FIRST_DAY, [STALLED]);
    await runSync(THREE_WEEKS_LATER, [STALLED_LONGER]);

    assert.deepEqual(stored(STALLED).detectedAt, FIRST_DAY);
    assert.equal(stored(STALLED).status, "open");
    assert.equal(stored(STALLED).summary, STALLED_LONGER.summary, "the text is still refreshed");
    assert.equal(stored(STALLED).severity, "high");
  });

  it("starts a new spell when a resolved alert's condition returns", async () => {
    await runSync(FIRST_DAY, [STALLED]);
    await runSync(NEXT_DAY, []);
    assert.equal(stored(STALLED).status, "resolved");
    assert.deepEqual(stored(STALLED).resolvedAt, NEXT_DAY);

    await runSync(THREE_WEEKS_LATER, [STALLED]);

    assert.equal(stored(STALLED).status, "open");
    assert.deepEqual(stored(STALLED).detectedAt, THREE_WEEKS_LATER);
    assert.equal(stored(STALLED).resolvedAt, null);
  });

  // The context read lists alerts by type, and its list has no
  // goal_platform_stale, so the sync never hears that such an alert is open.
  it("keeps detectedAt on an open alert the context read did not list", async () => {
    const platformStale: AlertDescriptor = {
      alertKey: "goal_platform_stale:link-1",
      type: "goal_platform_stale",
      severity: "medium",
      title: "Platform visited but no follow-through",
      summary: "Learning platform was visited but no follow-through evidence has appeared.",
      sourceType: "goal_resource_link",
      sourceId: "link-1",
    };
    seed(platformStale);

    await runSync(THREE_WEEKS_LATER, [platformStale], []);

    assert.deepEqual(stored(platformStale).detectedAt, FIRST_DAY);
  });
});

// A teacher's dismiss or snooze outranks the sync: PATCH /api/teacher/alerts/:id
// promises a dismissed alert "won't reappear on resync".
describe("applyStudentAlertSyncPlan and a teacher's hold", () => {
  it("leaves a dismissed alert dismissed and refreshes only its text", async () => {
    seed(STALLED, { status: "dismissed", dismissedAt: NEXT_DAY });

    await runSync(THREE_WEEKS_LATER, [STALLED_LONGER]);

    assert.equal(stored(STALLED).status, "dismissed");
    assert.deepEqual(stored(STALLED).dismissedAt, NEXT_DAY);
    assert.deepEqual(stored(STALLED).detectedAt, FIRST_DAY);
    assert.equal(stored(STALLED).summary, STALLED_LONGER.summary);
  });

  it("does not resolve a dismissed alert whose condition has cleared", async () => {
    seed(STALLED, { status: "dismissed", dismissedAt: NEXT_DAY });

    await runSync(THREE_WEEKS_LATER, []);

    assert.equal(stored(STALLED).status, "dismissed");
    assert.equal(stored(STALLED).resolvedAt, null);
  });

  it("leaves a snoozed alert snoozed while the snooze lasts", async () => {
    const until = new Date(THREE_WEEKS_LATER.getTime() + 24 * 60 * 60 * 1000);
    seed(STALLED, { status: "snoozed", snoozedUntil: until, snoozedBy: "teacher-1" });

    await runSync(THREE_WEEKS_LATER, [STALLED_LONGER]);

    assert.equal(stored(STALLED).status, "snoozed");
    assert.deepEqual(stored(STALLED).snoozedUntil, until);
    assert.equal(stored(STALLED).snoozedBy, "teacher-1");
    assert.deepEqual(stored(STALLED).detectedAt, FIRST_DAY);
    assert.equal(stored(STALLED).summary, STALLED_LONGER.summary);
  });

  it("reopens an alert whose snooze has ended, as a new spell", async () => {
    seed(STALLED, { status: "snoozed", snoozedUntil: NEXT_DAY, snoozedBy: "teacher-1" });

    await runSync(THREE_WEEKS_LATER, [STALLED]);

    assert.equal(stored(STALLED).status, "open");
    assert.equal(stored(STALLED).snoozedUntil, null);
    assert.equal(stored(STALLED).snoozedBy, null);
    assert.deepEqual(stored(STALLED).detectedAt, THREE_WEEKS_LATER);
  });
});

// The sync runs for every active student each morning and after student
// activity, inside one interactive transaction: its cost is round trips.
describe("applyStudentAlertSyncPlan round trips", () => {
  it("adds at most one statement per sync, however many alerts are open", async () => {
    const alerts = ["a", "b", "c"].map((suffix) => ({ ...STALLED, alertKey: `overdue_task:${suffix}` }));
    for (const alert of alerts) seed(alert);

    await runSync(THREE_WEEKS_LATER, alerts);

    assert.ok(statements <= alerts.length + 1, `expected at most ${alerts.length + 1} statements, saw ${statements}`);
  });

  it("issues no statement for a student with no alerts", async () => {
    await runSync(THREE_WEEKS_LATER, []);

    assert.equal(statements, 0);
  });
});
