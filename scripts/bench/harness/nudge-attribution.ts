/**
 * nudge-attribution harness — the real inbound handler and the real sweep.
 *
 * Runs each scripted case from config/benchmarks/fixtures/nudge-attribution.json
 * against the in-memory store in ./nudge-store.ts, driving the REAL
 * `handleInboundSms` (src/lib/nudges/replies.ts), the REAL `transitionConnection`
 * (src/lib/connect/pipeline.ts) and, for the two sweep cases, the REAL
 * `runNudges`. It reports observations only; the scorer compares them against
 * each case's declared `expect`, so what counts as correct is a reviewable
 * artifact in the fixture rather than an assertion buried in a mock.
 *
 * Needs `--experimental-test-module-mocks`, so it runs as a child process
 * spawned by scripts/bench/suites/nudge-attribution.mjs. One JSON object on
 * stdout, nothing else.
 */
import { mock } from "node:test";

import { intersectScopeClassIds, isConnectEnabledForClasses, parseConnectScope } from "@/lib/connect/flags-shared";

import { createNudgeStore, type NudgeStore, type OutboundRow } from "./nudge-store";

interface CaseSpec {
  id: string;
  sweep?: boolean;
  prefs?: Array<{
    student: number;
    phone: number;
    consent?: boolean;
    enabled?: boolean;
    revoked?: boolean;
  }>;
  connections?: Array<{ id: string; student: number; status: string; startedDaysAgo?: number }>;
  savedJobs?: Array<{ id: string; student: number; status: string; appliedDaysAgo?: number }>;
  questions?: Array<{
    student: number;
    templateKey: string;
    token: string;
    sentHoursAgo: number;
    status?: string;
  }>;
  inbound?: Array<{ phone: number; body: string }>;
}

interface Fixture {
  phoneBase: string;
  nowIso: string;
  cases: CaseSpec[];
}

const fixture: Fixture = JSON.parse(process.env.BENCH_NUDGE_SPEC ?? "{}");

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

let store: NudgeStore = createNudgeStore();

mock.module("@/lib/db", {
  namedExports: {
    get prismaAdmin() {
      return store.prismaAdmin;
    },
    get prisma() {
      return store.prisma;
    },
  },
});
mock.module("@/lib/rls-context", {
  namedExports: {
    withStudentRlsContext: async (studentId: string, fn: () => unknown) => {
      store.rlsContexts.push(studentId);
      return fn();
    },
    withRlsContext: async (_ctx: unknown, fn: () => unknown) => fn(),
  },
});
mock.module("@/lib/connect/flags", {
  namedExports: {
    getConnectScope: async () => parseConnectScope("all"),
    getSmsNudgeScope: async () => parseConnectScope("all"),
    isConnectEnabledForClasses,
    intersectScopeClassIds,
  },
});
mock.module("@/lib/connect/matching", {
  namedExports: { rankLeadsForStudent: async () => [] },
});
mock.module("@/lib/nudges/admin-guard", {
  namedExports: {
    adminClientIsPrivileged: async () => true,
    resetAdminClientProbe: () => {},
  },
});
mock.module("@/lib/sms", {
  namedExports: {
    sendSms: async () => true,
    isSmsDeliveryConfigured: () => true,
  },
});
mock.module("@/lib/logger", {
  namedExports: {
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  },
});

function phoneFor(index: number): string {
  return `${fixture.phoneBase}${String(100 + index).padStart(4, "0")}`;
}

function studentId(index: number): string {
  return `cbenchstu${String(index).padStart(2, "0")}`;
}

function buildStore(spec: CaseSpec, now: Date): NudgeStore {
  const studentIndexes = new Set<number>();
  for (const pref of spec.prefs ?? []) studentIndexes.add(pref.student);
  for (const connection of spec.connections ?? []) studentIndexes.add(connection.student);
  for (const job of spec.savedJobs ?? []) studentIndexes.add(job.student);
  for (const question of spec.questions ?? []) studentIndexes.add(question.student);

  return createNudgeStore({
    students: [...studentIndexes].map((index) => ({
      id: studentId(index),
      role: "student",
      isActive: true,
    })),
    enrollments: [...studentIndexes].map((index) => ({
      studentId: studentId(index),
      classId: "cbenchclass1",
      status: "active",
    })),
    preferences: (spec.prefs ?? []).map((pref, index) => ({
      id: `pref${index}`,
      studentId: studentId(pref.student),
      channel: "sms",
      destination: phoneFor(pref.phone),
      enabled: pref.enabled ?? true,
      smsConsentAt: (pref.consent ?? true) ? new Date(now.getTime() - 30 * DAY_MS) : null,
      smsRevokedAt: pref.revoked ? new Date(now.getTime() - DAY_MS) : null,
    })),
    connections: (spec.connections ?? []).map((connection) => {
      const startedAt = new Date(now.getTime() - (connection.startedDaysAgo ?? 5) * DAY_MS);
      return {
        id: connection.id,
        studentId: studentId(connection.student),
        status: connection.status,
        sentAt: new Date(startedAt.getTime() - 7 * DAY_MS),
        statusChangedAt: startedAt,
        employerViewedAt: new Date(startedAt.getTime() - 6 * DAY_MS),
        interviewAppointmentId: null,
        employer: { name: "Ashgrove Fabrication" },
        jobLead: { title: "Warehouse Associate" },
        interviewAppointment: null,
      };
    }),
    connectionEvents: (spec.connections ?? []).map((connection) => ({
      connectionId: connection.id,
      toStatus: "started",
      note: null,
      at: new Date(now.getTime() - (connection.startedDaysAgo ?? 5) * DAY_MS),
    })),
    savedJobs: (spec.savedJobs ?? []).map((job) => ({
      id: job.id,
      studentId: studentId(job.student),
      status: job.status,
      appliedAt: new Date(now.getTime() - (job.appliedDaysAgo ?? 1) * DAY_MS),
      jobListing: { title: "Warehouse Associate" },
    })),
    outbound: (spec.questions ?? []).map((question, index) => ({
      id: `seedq${index}`,
      channel: "sms",
      toKind: "student",
      toId: studentId(question.student),
      templateKey: question.templateKey,
      body: "SPOKES: seeded question. Reply STOP to stop.",
      status: question.status ?? "sent",
      connectionId: null,
      expectsReply: question.token,
      sentAt: new Date(now.getTime() - question.sentHoursAgo * HOUR_MS),
      repliedAt: null,
    })),
  });
}

function observe(spec: CaseSpec, seededIds: Set<string>, outcomes: unknown[]) {
  const claimed = store.data.outbound
    .filter((row) => row.repliedAt !== null && seededIds.has(row.id))
    .map((row) => row.templateKey)
    .sort();

  const newQuestions = store.data.outbound.filter(
    (row: OutboundRow) => !seededIds.has(row.id) && row.expectsReply !== null && row.status === "sent",
  );
  const questionsOpenedByStudent: Record<string, number> = {};
  for (const pref of spec.prefs ?? []) {
    questionsOpenedByStudent[String(pref.student)] = newQuestions.filter(
      (row) => row.toId === studentId(pref.student),
    ).length;
  }

  const repliedNumbers = new Set((spec.inbound ?? []).map((entry) => phoneFor(entry.phone)));
  const revokedOnRepliedNumber = store.data.preferences.filter(
    (row) => row.smsRevokedAt !== null && row.destination !== null && repliedNumbers.has(row.destination),
  ).length;
  const revokedElsewhere = store.data.preferences.filter(
    (row) => row.smsRevokedAt !== null && (row.destination === null || !repliedNumbers.has(row.destination)),
  ).length;

  return {
    case: spec.id,
    outcomes,
    claimedTemplateKeys: claimed,
    alertTypes: [...new Set(store.data.alerts.map((row) => row.type))].sort(),
    connectionStatuses: Object.fromEntries(
      store.data.connections.map((row) => [row.id, row.status]),
    ),
    savedJobStatuses: Object.fromEntries(store.data.savedJobs.map((row) => [row.id, row.status])),
    prefsRevoked: store.data.preferences.filter((row) => row.smsRevokedAt !== null).length,
    prefsRevokedOnRepliedNumber: revokedOnRepliedNumber,
    prefsRevokedElsewhere: revokedElsewhere,
    prefsEnabled: store.data.preferences.filter((row) => row.enabled).length,
    followUpWrites: store.followUpWrites.length,
    questionsOpenedByStudent,
  };
}

async function main(): Promise<void> {
  const { handleInboundSms } = await import("@/lib/nudges/replies");
  const { runNudges } = await import("@/lib/nudges/schedule");
  const now = new Date(fixture.nowIso);
  const observations = [];

  for (const spec of fixture.cases) {
    store = buildStore(spec, now);
    const seededIds = new Set(store.data.outbound.map((row) => row.id));
    const outcomes: unknown[] = [];

    if (spec.sweep) {
      await runNudges({ now });
    }
    for (const message of spec.inbound ?? []) {
      outcomes.push(
        await handleInboundSms({ from: phoneFor(message.phone), body: message.body, now }),
      );
    }

    observations.push(observe(spec, seededIds, outcomes));
  }

  process.stdout.write(`${JSON.stringify({ observations })}\n`);
}

void main().catch((error) => {
  process.stderr.write(`${String(error instanceof Error ? error.stack : error)}\n`);
  process.exitCode = 1;
});
