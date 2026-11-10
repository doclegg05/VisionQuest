import assert from "node:assert/strict";
import { afterEach, before, beforeEach, describe, it, mock } from "node:test";
import { createSentryDouble, STUDENT_CUID, STUDENT_EMAIL } from "./sentry.test-support";

// H1 (2026-11-10): an alarm line (`alert: "<name>"` in the context, or a
// boot_probe_* message) was only printed to the host's log stream. A crisis
// alert that reached no instructor (`wellbeing_no_recipients`) told nobody.
// The logger now also sends each alarm as a Sentry message, in one place.

const sentry = createSentryDouble();
mock.module("@sentry/nextjs", { namedExports: sentry.exports });

let logger: typeof import("./logger")["logger"];
const consoleError = mock.method(console, "error", () => {});
const consoleLog = mock.method(console, "log", () => {});

before(async () => {
  ({ logger } = await import("./logger"));
});

const STUDENT_KEY = "stu_0123456789ab";

/** The report is asynchronous (the SDK loads lazily); wait for it to land. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

describe("alarm log lines become Sentry messages", () => {
  beforeEach(() => {
    sentry.reset();
    consoleError.mock.resetCalls();
    process.env.SENTRY_DSN = "https://public@o0.ingest.sentry.io/0";
  });
  afterEach(() => {
    delete process.env.SENTRY_DSN;
  });

  it("sends one error-level message for an error alarm", async () => {
    logger.error("Wellbeing alert reached no instructor", {
      alert: "wellbeing_no_recipients",
      student: STUDENT_KEY,
      recipientCount: 0,
    });
    await settle();
    assert.equal(sentry.sent.length, 1);
    assert.equal(sentry.sent[0]?.message, "wellbeing_no_recipients");
    assert.equal(sentry.sent[0]?.level, "error");
  });

  it("carries no student identifier, only the alarm name and numeric fields", async () => {
    logger.error(`Notify failed for ${STUDENT_EMAIL}`, {
      alert: "wellbeing_notify_failed",
      student: STUDENT_KEY,
      target: STUDENT_CUID,
      error: { name: "PrismaClientKnownRequestError", code: "P2002" },
      attemptedCount: 3,
      degraded: true,
    });
    await settle();
    const sent = JSON.stringify(sentry.sent);
    for (const identifier of [STUDENT_KEY, STUDENT_CUID, STUDENT_EMAIL, "Tanesha"]) {
      assert.ok(!sent.includes(identifier), `event leaked ${identifier}: ${sent}`);
    }
    assert.deepEqual(sentry.sent[0]?.extra, { attemptedCount: 3, degraded: true });
    assert.equal(sentry.sent[0]?.tags?.alert, "wellbeing_notify_failed");
  });

  it("sends a warning-level message for a warn alarm", async () => {
    logger.warn("Nudge delivered program-wide", { alert: "intervention_nudge_fallback_program_wide" });
    await settle();
    assert.equal(sentry.sent[0]?.level, "warning");
  });

  it("treats a boot_probe_* message as an alarm", async () => {
    logger.error("boot_probe_failed", { probe: "rls_context_injection", detail: "off" });
    await settle();
    assert.equal(sentry.sent.length, 1);
    assert.equal(sentry.sent[0]?.message, "boot_probe_failed");
  });

  it("does not send a plain error line, or an alert field on a debug or info line", async () => {
    logger.error("Unhandled API error", { error: { name: "TypeError" } });
    logger.debug("Nudge delivered", { alert: "intervention_nudge_assigned_instructors" });
    logger.info("Nudge delivered", { alert: "intervention_nudge_assigned_instructors" });
    await settle();
    assert.equal(sentry.sent.length, 0);
  });

  it("does not send an alarm name that is not an identifier", async () => {
    logger.error("odd", { alert: `failed for ${STUDENT_EMAIL}` });
    await settle();
    assert.equal(sentry.sent[0]?.message, "unnamed_alert");
  });
});

describe("alarm lines with no DSN", () => {
  it("send nothing and print nothing beyond the log line itself", async () => {
    sentry.reset();
    delete process.env.SENTRY_DSN;
    consoleError.mock.resetCalls();
    consoleLog.mock.resetCalls();
    logger.error("Wellbeing alert reached no instructor", { alert: "wellbeing_no_recipients" });
    await settle();
    assert.equal(sentry.sent.length, 0);
    assert.equal(sentry.scopes.length, 0);
    assert.equal(consoleError.mock.callCount(), 1);
    assert.equal(consoleLog.mock.callCount(), 0);
  });
});
