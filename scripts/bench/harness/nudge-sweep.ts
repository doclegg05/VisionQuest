/**
 * nudge-sweep harness — the real hourly sweep, against a real database.
 *
 * Runs `runNudges` (src/lib/nudges/schedule.ts) over the seeded synthetic
 * cohort with a FAKE Twilio, and reports timings and read-back counts. The
 * scorer decides what is acceptable; this file only produces the numbers.
 *
 * Twilio is stubbed by replacing `globalThis.fetch` for requests to
 * api.twilio.com and setting placeholder `TWILIO_*` credentials — the same
 * shape src/lib/sms.test.ts uses. Nothing reaches the network: a request to
 * any other host THROWS rather than being passed through, so a future code
 * path that starts calling out is a loud failure here instead of a benchmark
 * that quietly posts somewhere.
 *
 * SAFETY. It writes and deletes rows, so it refuses any database that is not
 * local- or CI-scoped through the same guard the cohort seed uses, plus a
 * production-shape refusal with no override. Everything it creates is removed
 * again in a finally block: its NotificationPreference rows, every
 * OutboundMessage addressed to a `cbench` student, every `connect_` StudentAlert
 * belonging to one, and the two pilot flags restored to whatever they were.
 *
 * Run as a child process by scripts/bench/suites/nudge-sweep.mjs. One JSON
 * object on stdout, nothing else.
 */
import { loadEnvConfig } from "@next/env";

import { assertSafeE2eSeedTarget } from "../../../src/lib/e2e-seed-guard";
import { loadCohort } from "../lib/cohort.mjs";

loadEnvConfig(process.cwd(), true);

/** Hosts and database names refused outright — no flag lifts this. */
const PRODUCTION_SHAPED = [/supabase\./iu, /\.render\.com$/iu, /neon\.tech$/iu, /prod/iu];

const CONNECT_FLAG = "connect_enabled_classes";
const SMS_FLAG = "sms_nudges_enabled_classes";
const ID_PREFIX = "cbench";

/** Monday 10:00 America/New_York — the weekly slot, the heaviest hour there is. */
const SWEEP_NOW = new Date("2026-10-12T14:00:00.000Z");

interface Report {
  ran: boolean;
  reason?: string;
  sweepDurationMs?: number;
  sendsPerRun?: number;
  firstRun?: unknown;
  concurrent?: { skipped: Array<string | null>; ran: number };
  /** Every sweep's `skipped` value, in order, so the scorer can spot a blocked run. */
  allSkipped?: Array<string | null>;
  /** Sends the policy refused with `send_error` — the shape a broken lock takes. */
  sendErrors?: number;
  capStress?: { attempts: number; accepted: number; capConsumingRows: number; dailyCap: number };
  perStudentDailyMax?: number;
  duplicateOpenQuestions?: number;
  studentsWithSends?: number;
  twilioCalls?: number;
}

function assertSafeTarget(databaseUrl: string): void {
  let host = "";
  let database = "";
  try {
    const url = new URL(databaseUrl);
    host = url.hostname;
    database = url.pathname.replace(/^\//u, "");
  } catch {
    throw new Error("DATABASE_URL is not a parseable connection string.");
  }
  for (const pattern of PRODUCTION_SHAPED) {
    if (pattern.test(host) || pattern.test(database)) {
      throw new Error(
        `Refusing to run the nudge-sweep benchmark against host "${host}" (database ` +
          `"${database}"): it matches ${pattern}, which this harness treats as production. ` +
          "This benchmark sends texts through a stub and deletes rows; there is no override.",
      );
    }
  }
  assertSafeE2eSeedTarget(databaseUrl, { allowRemote: false, warn: () => {} });
}

/**
 * Stand in for Twilio. Answers only api.twilio.com and throws for anything
 * else, so an unexpected outbound call is a failure rather than a real request.
 */
function installFakeTwilio(): { count: () => number } {
  let calls = 0;
  process.env.TWILIO_ACCOUNT_SID = "AC_bench_sid";
  process.env.TWILIO_AUTH_TOKEN = "bench_token";
  process.env.TWILIO_FROM_NUMBER = "+13045550199";
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith("https://api.twilio.com/")) {
      throw new Error(`nudge-sweep: unexpected outbound request to ${url}`);
    }
    calls += 1;
    return new Response(JSON.stringify({ sid: `SM${calls}`, status: "queued" }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { count: () => calls };
}

async function main(): Promise<void> {
  const databaseUrl = process.env.ADMIN_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
  const report: Report = { ran: false };
  if (!databaseUrl) {
    report.reason = "no DATABASE_URL";
    process.stdout.write(`${JSON.stringify(report)}\n`);
    return;
  }
  assertSafeTarget(databaseUrl);

  const twilio = installFakeTwilio();
  const { prismaAdmin } = await import("../../../src/lib/db");
  const cohort = loadCohort();
  const studentIds: string[] = cohort.students.map((student: { id: string }) => student.id);
  const classIds: string[] = cohort.classes.map((entry: { id: string }) => entry.id);

  const seeded = await prismaAdmin.student.count({ where: { id: { in: studentIds } } });
  if (seeded < studentIds.length) {
    report.reason = `the synthetic cohort is not seeded (${seeded}/${studentIds.length} students)`;
    await prismaAdmin.$disconnect();
    process.stdout.write(`${JSON.stringify(report)}\n`);
    return;
  }

  const previousFlags = await prismaAdmin.systemConfig.findMany({
    where: { key: { in: [CONNECT_FLAG, SMS_FLAG] } },
    select: { key: true, value: true },
  });

  try {
    for (const key of [CONNECT_FLAG, SMS_FLAG]) {
      await prismaAdmin.systemConfig.upsert({
        where: { key },
        update: { value: classIds.join(","), updatedBy: "bench" },
        create: { key, value: classIds.join(","), updatedBy: "bench" },
      });
    }

    // Consent for every cohort student, with a fiction-range number each.
    for (const [index, id] of studentIds.entries()) {
      const destination = `+1304555${String(100 + index).padStart(4, "0")}`;
      await prismaAdmin.notificationPreference.upsert({
        where: { studentId_channel: { studentId: id, channel: "sms" } },
        update: {
          destination,
          enabled: true,
          smsConsentAt: new Date("2026-09-01T12:00:00.000Z"),
          smsRevokedAt: null,
        },
        create: {
          studentId: id,
          channel: "sms",
          destination,
          enabled: true,
          smsConsentAt: new Date("2026-09-01T12:00:00.000Z"),
          smsRevokedAt: null,
        },
      });
    }

    const { runNudges } = await import("../../../src/lib/nudges/schedule");

    // 1. One cold sweep, timed. This is the number the design's "sweep
    //    duration" benchmark asks for, taken at the heaviest hour there is —
    //    the Monday weekly slot, which ranks every student's leads.
    const startedAt = Date.now();
    const first = await runNudges({ now: SWEEP_NOW });
    report.sweepDurationMs = Date.now() - startedAt;
    report.firstRun = {
      skipped: first.skipped,
      weeklySlot: first.weeklySlot,
      alertsWritten: first.alertsWritten,
      textsPlanned: first.textsPlanned,
      textsSent: first.textsSent,
      textOutcomes: first.textOutcomes,
    };
    report.sendsPerRun = first.textsSent;

    // 2. Two sweeps at once. The run lock is transaction-scoped, so exactly one
    //    may do work and the other must report "already running".
    const pair = await Promise.all([
      runNudges({ now: SWEEP_NOW }),
      runNudges({ now: SWEEP_NOW }),
    ]);
    report.concurrent = {
      skipped: pair.map((result) => result.skipped),
      ran: pair.filter((result) => result.skipped === null).length,
    };
    report.allSkipped = [first.skipped, ...pair.map((result) => result.skipped)];
    report.sendErrors = [first, ...pair].reduce(
      (total, result) =>
        total +
        Object.entries(result.textOutcomes)
          .filter(([key]) => key.startsWith("refused:send_error"))
          .reduce((sum, [, count]) => sum + count, 0),
      0,
    );

    // 3. The per-recipient daily cap, under a real race. One student's rows are
    //    cleared first so the stress starts from zero regardless of what the
    //    sweeps sent them, then ten sends are attempted at once: the advisory
    //    lock plus the queued reservation must hold them to SMS_DAILY_CAP.
    const capStudent = studentIds[0];
    await prismaAdmin.outboundMessage.deleteMany({
      where: { toKind: "student", toId: capStudent },
    });
    const { sendPolicySms, SMS_DAILY_CAP, composeSmsBody } = await import(
      "../../../src/lib/nudges/sms-policy"
    );
    const attempts = 10;
    const outcomes = await Promise.all(
      Array.from({ length: attempts }, (_unused, slot) =>
        sendPolicySms({
          studentId: capStudent,
          templateKey: `bench_cap_${slot}`,
          body: composeSmsBody("Cap stress, from the benchmark suite."),
          now: SWEEP_NOW,
        }),
      ),
    );
    const capRows = await prismaAdmin.outboundMessage.count({
      where: {
        channel: "sms",
        toKind: "student",
        toId: capStudent,
        status: { in: ["sent", "queued", "failed"] },
      },
    });
    report.capStress = {
      attempts,
      accepted: outcomes.filter((outcome) => outcome.status === "sent").length,
      capConsumingRows: capRows,
      dailyCap: SMS_DAILY_CAP,
    };

    // 4. Read back what the database now holds for the whole cohort.
    const rows = await prismaAdmin.outboundMessage.findMany({
      where: {
        channel: "sms",
        toKind: "student",
        toId: { in: studentIds },
        status: { in: ["sent", "queued", "failed"] },
      },
      select: { toId: true, expectsReply: true, repliedAt: true, sentAt: true, status: true },
    });
    const perStudent = new Map<string, number>();
    const openQuestions = new Map<string, number>();
    const windowStart = SWEEP_NOW.getTime() - 72 * 60 * 60 * 1000;
    for (const row of rows) {
      perStudent.set(row.toId, (perStudent.get(row.toId) ?? 0) + 1);
      if (
        row.status === "sent" &&
        row.expectsReply !== null &&
        row.repliedAt === null &&
        row.sentAt.getTime() >= windowStart
      ) {
        openQuestions.set(row.toId, (openQuestions.get(row.toId) ?? 0) + 1);
      }
    }
    report.perStudentDailyMax = perStudent.size === 0 ? 0 : Math.max(...perStudent.values());
    report.duplicateOpenQuestions = [...openQuestions.values()].filter((count) => count > 1).length;
    report.studentsWithSends = perStudent.size;
    report.twilioCalls = twilio.count();
    report.ran = true;
  } finally {
    // Everything this harness created, removed — so a local re-run measures the
    // same thing twice and no suite that follows it in the same CI job sees
    // rows it did not expect.
    await prismaAdmin.outboundMessage.deleteMany({
      where: { toKind: "student", toId: { startsWith: ID_PREFIX } },
    });
    await prismaAdmin.studentAlert.deleteMany({
      where: { studentId: { startsWith: ID_PREFIX }, type: { startsWith: "connect_" } },
    });
    await prismaAdmin.notificationPreference.deleteMany({
      where: { studentId: { startsWith: ID_PREFIX }, channel: "sms" },
    });
    const previous = new Map(previousFlags.map((row) => [row.key, row.value]));
    for (const key of [CONNECT_FLAG, SMS_FLAG]) {
      const value = previous.get(key);
      if (value === undefined) {
        await prismaAdmin.systemConfig.deleteMany({ where: { key } });
      } else {
        await prismaAdmin.systemConfig.update({ where: { key }, data: { value } });
      }
    }
    await prismaAdmin.$disconnect();
  }

  process.stdout.write(`${JSON.stringify(report)}\n`);
}

void main().catch((error) => {
  process.stderr.write(`${String(error instanceof Error ? error.stack : error)}\n`);
  process.exitCode = 1;
});
