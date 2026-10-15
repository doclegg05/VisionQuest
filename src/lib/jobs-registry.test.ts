import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { getRlsContext, type RlsContext } from "@/lib/rls-context";

// Job handlers run from the processor with no session. A handler that
// replays a student's work through app-client modules must impersonate that
// student, or under vq_app every read is empty and every write is rejected
// (review F62, 2026-09-01). The registry is captured through a mocked
// registerJobHandler so each handler can be invoked directly.
const handlers = new Map<string, (payload: Record<string, unknown>) => Promise<void>>();
mock.module("@/lib/jobs", {
  namedExports: {
    enqueueJob: async () => "queued-job",
    registerJobHandler: (type: string, handler: (payload: Record<string, unknown>) => Promise<void>) => {
      handlers.set(type, handler);
    },
  },
});

const postResponseCalls: { ctx: RlsContext | undefined; params: unknown }[] = [];
mock.module("@/lib/chat/post-response", {
  namedExports: {
    handlePostResponse: async (params: unknown) => {
      postResponseCalls.push({ ctx: getRlsContext(), params });
    },
  },
});

const syncCalls: { ctx: RlsContext | undefined; studentId: string }[] = [];
mock.module("@/lib/advising", {
  namedExports: {
    syncStudentAlerts: async (studentId: string) => {
      syncCalls.push({ ctx: getRlsContext(), studentId });
    },
  },
});

let emailConfigured = false;
const sendEmailMock = mock.fn(async () => undefined);
const sendSmsMock = mock.fn(async () => true);
mock.module("@/lib/email", {
  namedExports: { isEmailDeliveryConfigured: () => emailConfigured, sendEmail: sendEmailMock },
});
mock.module("@/lib/db", { namedExports: { prismaAdmin: {
  student: { findUnique: async () => ({ isActive: true, email: "user@example.test" }) },
  notificationPreference: { findFirst: async () => ({ enabled: true, destination: "private.recipient@example.test" }) },
} } });
mock.module("@/lib/nudges/sms-policy", { namedExports: {
  sendPolicySms: async () => ({ status: await sendSmsMock() ? "sent" : "failed" }),
} });
const logMocks = { debug: mock.fn(), info: mock.fn(), warn: mock.fn(), error: mock.fn() };
mock.module("@/lib/logger", {
  namedExports: { logger: logMocks },
});

before(async () => {
  await import("./jobs-registry");
});

function handler(type: string) {
  const fn = handlers.get(type);
  assert.ok(fn, `no handler registered for ${type}`);
  return fn;
}

function studentContext(studentId: string): RlsContext {
  return { userId: studentId, role: "student", studentId };
}

describe("jobs-registry", () => {
  beforeEach(() => {
    postResponseCalls.length = 0;
    syncCalls.length = 0;
    emailConfigured = false;
    sendEmailMock.mock.resetCalls();
    sendEmailMock.mock.mockImplementation(async () => undefined);
    sendSmsMock.mock.resetCalls();
    sendSmsMock.mock.mockImplementation(async () => true);
    for (const log of Object.values(logMocks)) log.mock.resetCalls();
  });

  it("missing SMTP fails retryably without logging recipient or free-text content", async () => {
    const payload = {
      to: "private.recipient@example.test",
      subject: "Private wellbeing subject",
      text: "Private notification body",
      html: "<p>Private HTML content</p>",
    };
    await assert.rejects(handler("send_email")(payload), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "Email delivery is not configured (SMTP_* env vars missing).");
      return true;
    });
    assert.equal(sendEmailMock.mock.callCount(), 0);
    assert.equal(logMocks.error.mock.callCount(), 1);
    assert.deepEqual(logMocks.error.mock.calls[0].arguments, [
      "Email job failed: SMTP is not configured",
      { alert: "email_delivery_unconfigured" },
    ]);
    const logs = JSON.stringify(Object.values(logMocks).flatMap((log) => log.mock.calls.map((call) => call.arguments)));
    for (const value of Object.values(payload)) assert.ok(!logs.includes(value));
  });

  it("channel jobs reject provider failures generically so the processor can retry", async () => {
    emailConfigured = true;
    const privateError = "private.recipient@example.test private message content";
    sendEmailMock.mock.mockImplementation(async () => { throw new Error(privateError); });
    const email = { to: "private.recipient@example.test", subject: "Private subject", text: "Private body" };
    for (const run of [
      () => handler("notification_channel_delivery")({ channel: "email", studentId: "student-a", ...email }),
      () => handler("send_email")(email),
    ]) await assert.rejects(run(), /^Error: Notification channel delivery failed\.$/);

    const sms = { channel: "sms", studentId: "student-a", templateKey: "notification:test", body: "Private SMS" };
    sendSmsMock.mock.mockImplementation(async () => false);
    await assert.rejects(handler("notification_channel_delivery")(sms), /^Error: Notification channel delivery failed\.$/);
    sendSmsMock.mock.mockImplementation(async () => { throw new Error(privateError); });
    await assert.rejects(handler("notification_channel_delivery")(sms), /^Error: Notification channel delivery failed\.$/);
    assert.ok(Object.values(logMocks).every((log) => log.mock.callCount() === 0));
  });

  it("channel jobs deliver both channels on retry success", async () => {
    emailConfigured = true;
    await handler("notification_channel_delivery")({ channel: "email", studentId: "student-a", to: "private.recipient@example.test", subject: "Subject", text: "Body" });
    await handler("notification_channel_delivery")({ channel: "sms", studentId: "student-a", templateKey: "notification:test", body: "Body" });
    assert.equal(sendEmailMock.mock.callCount(), 1);
    assert.equal(sendSmsMock.mock.callCount(), 1);
  });

  it("channel jobs refuse invalid payloads without leaking their contents", async () => {
    await assert.rejects(handler("notification_channel_delivery")({ channel: "private content", to: "user@example.test" }), /Notification channel delivery failed/);
    await assert.rejects(handler("notification_channel_delivery")({ channel: "sms" }), /Notification channel delivery failed/);
    assert.equal(sendEmailMock.mock.callCount(), 0);
    assert.equal(sendSmsMock.mock.callCount(), 0);
  });

  it("chat_post_response replays as the student named in the payload", async () => {
    const payload = { studentId: "student-a", conversationId: "conv-1", fullResponse: "hi" };
    await handler("chat_post_response")(payload);

    assert.equal(postResponseCalls.length, 1);
    assert.deepEqual(postResponseCalls[0].ctx, studentContext("student-a"));
    assert.deepEqual(postResponseCalls[0].params, payload);
    assert.equal(getRlsContext(), undefined, "no context leaks out of the handler");
  });

  it("chat_post_response refuses a payload with no studentId instead of running blind", async () => {
    await assert.rejects(
      handler("chat_post_response")({ conversationId: "conv-1" }),
      /studentId/,
    );
    assert.equal(postResponseCalls.length, 0);
  });

  it("sync_student_alerts runs as the student named in the payload", async () => {
    await handler("sync_student_alerts")({ studentId: "student-b" });

    assert.equal(syncCalls.length, 1);
    assert.equal(syncCalls[0].studentId, "student-b");
    assert.deepEqual(syncCalls[0].ctx, studentContext("student-b"));
  });

  it("sync_student_alerts refuses a payload with no studentId", async () => {
    await assert.rejects(handler("sync_student_alerts")({}), /studentId/);
    assert.equal(syncCalls.length, 0);
  });
});
