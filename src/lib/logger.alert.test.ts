import assert from "node:assert/strict";
import { afterEach, before, beforeEach, describe, it, mock } from "node:test";
import { type Outbox, PLANTED, plantedIn, realSdkExports, settleSdk, startServerSdk, TEST_DSN } from "./sentry.test-support";

// H1 (2026-11-10): an alarm line (`alert: "<name>"` in the context, or a
// boot_probe_* message) was only printed to the host's log stream. A crisis
// alert that reached no instructor (`wellbeing_no_recipients`) told nobody.
// The logger now also sends each alarm as a Sentry message, in one place.
//
// These run the real SDK with the app's server options and assert on what it
// handed to its transport. The logger loads the SDK with `import()`, so the
// SDK's own exports are registered for that specifier (see `realSdkExports`).

mock.module("@sentry/nextjs", { namedExports: realSdkExports });

let logger: typeof import("./logger")["logger"];
let outbox: Outbox;
const consoleError = mock.method(console, "error", () => {});
const consoleLog = mock.method(console, "log", () => {});

/** A studentLogKey, as call sites log one. It is a string, so it must not travel. */
const STUDENT_KEY = "stu_a1b2c3d4e5f6";
const MINUTE_MS = 60_000;
let now = Date.UTC(2026, 10, 10);

before(async () => {
  outbox = startServerSdk();
  ({ logger } = await import("./logger"));
});

/** The report is asynchronous (the SDK loads lazily); wait for it to land. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));
  await settleSdk();
}

describe("alarm log lines become Sentry messages", () => {
  beforeEach(() => {
    // Each test starts more than a minute after the last, so one test's
    // alarm never holds back the next one's.
    now += 5 * MINUTE_MS;
    mock.timers.enable({ apis: ["Date"], now });
    outbox.clear();
    consoleError.mock.resetCalls();
    process.env.SENTRY_DSN = TEST_DSN;
  });
  afterEach(() => {
    mock.timers.reset();
    delete process.env.SENTRY_DSN;
  });

  it("sends one error-level message for an error alarm", async () => {
    logger.error("Wellbeing alert reached no instructor", {
      alert: "wellbeing_no_recipients",
      student: STUDENT_KEY,
      recipientCount: 0,
    });
    await settle();
    assert.deepEqual(outbox.itemTypes(), ["event"]);
    assert.equal(outbox.events()[0]?.message, "wellbeing_no_recipients");
    assert.equal(outbox.events()[0]?.level, "error");
  });

  it("carries the alarm name and its numbers and flags, and no string from the log line", async () => {
    logger.error(`Notify failed for ${PLANTED.email}`, {
      alert: "wellbeing_notify_failed",
      student: STUDENT_KEY,
      target: PLANTED.recordId,
      note: PLANTED.chat,
      error: { name: "PrismaClientKnownRequestError", code: "P2002" },
      attemptedCount: 3,
      degraded: true,
    });
    await settle();
    assert.deepEqual(plantedIn(outbox.envelopes), []);
    assert.ok(!JSON.stringify(outbox.envelopes).includes(STUDENT_KEY));
    const [event] = outbox.events();
    assert.deepEqual(event?.extra, { attemptedCount: 3, degraded: true, heldBack: 0 });
    assert.deepEqual(event?.tags, { alert: "wellbeing_notify_failed" });
  });

  it("sends a warning-level message for a warn alarm", async () => {
    logger.warn("Nudge delivered program-wide", { alert: "intervention_nudge_fallback_program_wide" });
    await settle();
    assert.equal(outbox.events()[0]?.level, "warning");
  });

  it("treats a boot_probe_* message as an alarm", async () => {
    logger.error("boot_probe_failed", { probe: "rls_context_injection", detail: "off" });
    await settle();
    assert.equal(outbox.events().length, 1);
    assert.equal(outbox.events()[0]?.message, "boot_probe_failed");
  });

  it("does not send a plain error line, or an alert field on a debug or info line", async () => {
    logger.error("Unhandled API error", { error: { name: "TypeError" } });
    logger.debug("Nudge delivered", { alert: "intervention_nudge_assigned_instructors" });
    logger.info("Nudge delivered", { alert: "intervention_nudge_assigned_instructors" });
    await settle();
    assert.deepEqual(outbox.itemTypes(), []);
  });

  it("does not send an alarm name that is not an identifier", async () => {
    logger.error("odd", { alert: `failed for ${PLANTED.email}` });
    await settle();
    assert.equal(outbox.events()[0]?.message, "unnamed_alert");
  });
});

// Item 9: an alarm can fire on a hot path. `audit_write_failed` fires on
// every audited read while the audit table is unreachable.
describe("an alarm that fires in a flood", () => {
  beforeEach(() => {
    now += 5 * MINUTE_MS;
    mock.timers.enable({ apis: ["Date"], now });
    outbox.clear();
    consoleError.mock.resetCalls();
    process.env.SENTRY_DSN = TEST_DSN;
  });
  afterEach(() => {
    mock.timers.reset();
    delete process.env.SENTRY_DSN;
  });

  it("sends one event per alarm name per minute, and still logs every line", async () => {
    for (let i = 0; i < 50; i += 1) logger.error("Audit write failed", { alert: "audit_write_failed" });
    await settle();
    assert.equal(outbox.events().length, 1);
    assert.equal(consoleError.mock.callCount(), 50);
  });

  it("the next event after the minute carries the count held back, as a number", async () => {
    for (let i = 0; i < 50; i += 1) logger.error("Reaper failed", { alert: "background_job_reaper_failed" });
    mock.timers.setTime(now + MINUTE_MS - 1);
    logger.error("Reaper failed", { alert: "background_job_reaper_failed" });
    mock.timers.setTime(now + MINUTE_MS);
    logger.error("Reaper failed", { alert: "background_job_reaper_failed" });
    await settle();
    assert.deepEqual(
      outbox.events().map((event) => event.extra),
      [{ heldBack: 0 }, { heldBack: 50 }],
    );
  });

  it("holds each alarm name back separately", async () => {
    logger.error("Audit write failed", { alert: "audit_write_failed" });
    logger.error("Audit write failed", { alert: "audit_write_failed" });
    logger.error("Email is not set up", { alert: "email_delivery_unconfigured" });
    await settle();
    assert.deepEqual(outbox.events().map((event) => event.message).sort(), ["audit_write_failed", "email_delivery_unconfigured"]);
  });
});

// Third pass, item 4 (2026-11-10). The limit above held back a second
// `wellbeing_no_recipients` in the same minute, and the count of what was
// held back travels only on the NEXT report of that name. If no third one
// came, the second student's crisis alert reached nobody and Sentry never
// heard of it. An alarm on the crisis path is reported every time.
describe("a crisis-path alarm is never held back", () => {
  /** Every `wellbeing_` alarm the app raises (src/lib/sage/crisis-detection.ts, src/lib/chat/crisis-scan.ts). */
  const CRISIS_ALARMS = [
    "wellbeing_no_recipients",
    "wellbeing_notify_failed",
    "wellbeing_alert_failed",
    "wellbeing_detection_failed",
    "wellbeing_instructor_resolution_failed",
    "wellbeing_demo_check_failed",
    "wellbeing_mood_lookup_failed",
  ];

  beforeEach(() => {
    now += 5 * MINUTE_MS;
    mock.timers.enable({ apis: ["Date"], now });
    outbox.clear();
    consoleError.mock.resetCalls();
    process.env.SENTRY_DSN = TEST_DSN;
  });
  afterEach(() => {
    mock.timers.reset();
    delete process.env.SENTRY_DSN;
  });

  it("two wellbeing_no_recipients in one minute give two reports", async () => {
    logger.error("Wellbeing alert reached no instructor", { alert: "wellbeing_no_recipients", recipientCount: 0 });
    mock.timers.setTime(now + 1_000);
    logger.error("Wellbeing alert reached no instructor", { alert: "wellbeing_no_recipients", recipientCount: 0 });
    await settle();
    assert.deepEqual(
      outbox.events().map((event) => [event.message, event.extra]),
      [
        ["wellbeing_no_recipients", { recipientCount: 0, heldBack: 0 }],
        ["wellbeing_no_recipients", { recipientCount: 0, heldBack: 0 }],
      ],
    );
  });

  it("two of another alarm name in one minute give one report", async () => {
    logger.error("Packet missing", { alert: "packet_missing_from_storage" });
    mock.timers.setTime(now + 1_000);
    logger.error("Packet missing", { alert: "packet_missing_from_storage" });
    await settle();
    assert.deepEqual(outbox.events().map((event) => event.message), ["packet_missing_from_storage"]);
    assert.equal(consoleError.mock.callCount(), 2, "both lines are still logged");
  });

  it("every wellbeing_ alarm is reported each time it fires", async () => {
    for (const alert of CRISIS_ALARMS) {
      logger.error("crisis path", { alert });
      logger.error("crisis path", { alert });
      logger.warn("crisis path", { alert });
    }
    await settle();
    const counts = new Map<string, number>();
    for (const event of outbox.events()) counts.set(event.message ?? "", (counts.get(event.message ?? "") ?? 0) + 1);
    assert.deepEqual([...counts.entries()].sort(), CRISIS_ALARMS.map((alert): [string, number] => [alert, 3]).sort());
  });

  it("a name that only contains the word is still limited", async () => {
    logger.error("odd", { alert: "not_wellbeing_related" });
    logger.error("odd", { alert: "not_wellbeing_related" });
    await settle();
    assert.equal(outbox.events().length, 1);
  });
});

describe("alarm lines with no DSN", () => {
  it("send nothing and print nothing beyond the log line itself", async () => {
    outbox.clear();
    delete process.env.SENTRY_DSN;
    consoleError.mock.resetCalls();
    consoleLog.mock.resetCalls();
    logger.error("Wellbeing alert reached no instructor", { alert: "wellbeing_no_recipients" });
    await settle();
    assert.deepEqual(outbox.itemTypes(), []);
    assert.equal(consoleError.mock.callCount(), 1);
    assert.equal(consoleLog.mock.callCount(), 0);
  });
});
