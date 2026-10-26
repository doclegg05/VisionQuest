/**
 * nudge-consent harness — the real sweep, over fuzzed consent states.
 *
 * Drives the REAL `runNudges` (src/lib/nudges/schedule.ts) and the REAL
 * `sendPolicySms` (src/lib/nudges/sms-policy.ts) against the in-memory,
 * Prisma-shaped store in ./nudge-store.ts, once per scenario, and reports what
 * actually went out. Nothing here decides whether an outcome is correct — the
 * scorer owns the oracle, so the rule being gated on is a reviewable artifact
 * rather than something buried in a mock.
 *
 * Every student is given exactly one due rule (a `started` connection past its
 * day-30 retention checkpoint), so "who was texted" is a clean 1:1 answer to
 * "who was eligible" and a miss cannot hide behind a rule that was not due.
 *
 * Needs `--experimental-test-module-mocks`, so it runs as a child process
 * spawned by scripts/bench/suites/nudge-consent.mjs. One JSON object on
 * stdout, nothing else.
 */
import { mock } from "node:test";

import { intersectScopeClassIds, isConnectEnabledForClasses, parseConnectScope } from "@/lib/connect/flags-shared";

import { createNudgeStore, type NudgeStore } from "./nudge-store";

interface SpecStudent {
  id: string;
  classId: string;
}

interface SpecPreference {
  studentId: string;
  enabled: boolean;
  destination: string | null;
  hasConsent: boolean;
  revoked: boolean;
  /** Texts already sent to this recipient in the current local day. */
  sentToday: number;
}

interface SpecScenario {
  id: string;
  connectScope: string;
  smsScope: string;
  nowIso: string;
  preferences: SpecPreference[];
}

interface Spec {
  students: SpecStudent[];
  employerName: string;
  jobTitle: string;
  /** Days before `now` the connection reached `started`. */
  startedDaysAgo: number;
  scenarios: SpecScenario[];
}

const spec: Spec = JSON.parse(process.env.BENCH_NUDGE_SPEC ?? "{}");

const DAY_MS = 24 * 60 * 60 * 1000;

let store: NudgeStore = createNudgeStore();
let scope = { connect: "all", sms: "all" };

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
    getConnectScope: async () => parseConnectScope(scope.connect),
    getSmsNudgeScope: async () => parseConnectScope(scope.sms),
    // Passed through from the real Prisma-free module rather than restated:
    // the scope arithmetic IS what this suite measures, so a hand-copied
    // stand-in could agree with the oracle while production disagreed.
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
    // The stub is the ONLY thing standing in for Twilio, and it always
    // succeeds: a delivery failure would make an ineligible recipient look
    // protected for the wrong reason.
    sendSms: async (destination: string, _body: string) => {
      store.delivered.push({ studentId: "", templateKey: "", destination });
      return true;
    },
    isSmsDeliveryConfigured: () => true,
  },
});
mock.module("@/lib/logger", {
  namedExports: {
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  },
});

function buildStore(scenario: SpecScenario): NudgeStore {
  const now = new Date(scenario.nowIso);
  const startedAt = new Date(now.getTime() - spec.startedDaysAgo * DAY_MS);

  const built = createNudgeStore({
    students: spec.students.map((student) => ({
      id: student.id,
      role: "student",
      isActive: true,
    })),
    enrollments: spec.students.map((student) => ({
      studentId: student.id,
      classId: student.classId,
      status: "active",
    })),
    preferences: scenario.preferences.map((pref, index) => ({
      id: `pref${String(index).padStart(4, "0")}`,
      studentId: pref.studentId,
      channel: "sms",
      destination: pref.destination,
      enabled: pref.enabled,
      smsConsentAt: pref.hasConsent ? new Date(now.getTime() - 30 * DAY_MS) : null,
      smsRevokedAt: pref.revoked ? new Date(now.getTime() - DAY_MS) : null,
    })),
    connections: spec.students.map((student, index) => ({
      id: `con${String(index).padStart(4, "0")}`,
      studentId: student.id,
      status: "started",
      sentAt: new Date(startedAt.getTime() - 7 * DAY_MS),
      statusChangedAt: startedAt,
      employerViewedAt: new Date(startedAt.getTime() - 6 * DAY_MS),
      interviewAppointmentId: null,
      employer: { name: spec.employerName },
      jobLead: { title: spec.jobTitle },
      interviewAppointment: null,
    })),
    connectionEvents: spec.students.map((_student, index) => ({
      connectionId: `con${String(index).padStart(4, "0")}`,
      toStatus: "started",
      note: null,
      at: startedAt,
    })),
    outbound: scenario.preferences.flatMap((pref) =>
      Array.from({ length: pref.sentToday }, (_unused, slot) => ({
        id: `pre_${pref.studentId}_${slot}`,
        channel: "sms",
        toKind: "student",
        toId: pref.studentId,
        templateKey: "prior_same_day",
        body: "SPOKES: prior message. Reply STOP to stop.",
        status: "sent",
        connectionId: null,
        // No `expectsReply`, so a prior message never trips the runner's
        // one-open-question guard and confuses a cap refusal for a dedupe.
        expectsReply: null,
        sentAt: now,
        repliedAt: null,
      })),
    ),
  });
  return built;
}

async function main(): Promise<void> {
  const { runNudges } = await import("@/lib/nudges/schedule");
  const observations = [];

  for (const scenario of spec.scenarios) {
    store = buildStore(scenario);
    scope = { connect: scenario.connectScope, sms: scenario.smsScope };

    const result = await runNudges({ now: new Date(scenario.nowIso) });

    const sent = store.data.outbound
      .filter((row) => row.status === "sent" && row.templateKey !== "prior_same_day")
      .map((row) => row.toId);
    const attempted = store.data.outbound
      .filter((row) => row.templateKey !== "prior_same_day")
      .map((row) => ({ studentId: row.toId, status: row.status }));

    observations.push({
      scenario: scenario.id,
      skipped: result.skipped,
      textsPlanned: result.textsPlanned,
      textsSent: result.textsSent,
      textOutcomes: result.textOutcomes,
      sent,
      attempted,
      rlsContexts: Array.from(new Set(store.rlsContexts)),
    });
  }

  process.stdout.write(`${JSON.stringify({ observations })}\n`);
}

void main().catch((error) => {
  process.stderr.write(`${String(error instanceof Error ? error.stack : error)}\n`);
  process.exitCode = 1;
});
