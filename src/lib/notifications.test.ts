/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding must accept many signatures */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

const STUDENT_ID = "clstudent0000abcdefghijkl";
const STUDENT_EMAIL = "jane.doe@example.com";
const STUDENT_PHONE = "+15551234567";

const mockNotificationCreate = mock.fn() as any;
const mockNotificationFindFirst = mock.fn() as any;
const mockStudentFindUnique = mock.fn() as any;
const mockPreferenceFindMany = mock.fn() as any;
const mockSendEmail = mock.fn() as any;
const mockSendSms = mock.fn() as any;

const mockDebug = mock.fn() as any;
const mockInfo = mock.fn() as any;
const mockWarn = mock.fn() as any;
const mockError = mock.fn() as any;

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      notification: {
        get create() {
          return mockNotificationCreate;
        },
        get findFirst() {
          return mockNotificationFindFirst;
        },
      },
      student: {
        get findUnique() {
          return mockStudentFindUnique;
        },
      },
      notificationPreference: {
        get findMany() {
          return mockPreferenceFindMany;
        },
      },
    },
  },
});

mock.module("@/lib/logger", {
  namedExports: {
    logger: {
      get debug() {
        return mockDebug;
      },
      get info() {
        return mockInfo;
      },
      get warn() {
        return mockWarn;
      },
      get error() {
        return mockError;
      },
    },
  },
});

mock.module("@/lib/email", {
  namedExports: {
    get sendEmail() {
      return mockSendEmail;
    },
    isEmailDeliveryConfigured: () => true,
  },
});

mock.module("@/lib/sms", {
  namedExports: {
    get sendSms() {
      return mockSendSms;
    },
  },
});

mock.module("@/lib/email-templates", {
  namedExports: {
    buildNotificationEmail: () => "<p>notification</p>",
  },
});

let notifications: typeof import("./notifications");

before(async () => {
  notifications = await import("./notifications");
});

/** Every argument passed to any logger level this test run, serialized. */
function loggedText(): string {
  const calls = [
    ...mockDebug.mock.calls,
    ...mockInfo.mock.calls,
    ...mockWarn.mock.calls,
    ...mockError.mock.calls,
  ];
  return JSON.stringify(calls.map((c: any) => c.arguments));
}

/** Let the fire-and-forget email/SMS IIFEs settle before asserting. */
async function flushDelivery(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

const payload = { type: "goal_due", title: "Goal due soon", body: "Check your plan." };

describe("sendMultiChannelNotification logging", () => {
  beforeEach(() => {
    for (const m of [
      mockNotificationCreate,
      mockNotificationFindFirst,
      mockStudentFindUnique,
      mockPreferenceFindMany,
      mockSendEmail,
      mockSendSms,
      mockDebug,
      mockInfo,
      mockWarn,
      mockError,
    ]) {
      m.mock.resetCalls();
    }

    mockNotificationFindFirst.mock.mockImplementation(async () => null);
    mockNotificationCreate.mock.mockImplementation(async () => ({
      id: "notif-1",
      type: payload.type,
      title: payload.title,
      body: payload.body,
      createdAt: new Date("2026-08-20T12:00:00.000Z"),
    }));
    mockStudentFindUnique.mock.mockImplementation(async () => ({ email: STUDENT_EMAIL }));
    mockPreferenceFindMany.mock.mockImplementation(async () => [
      { channel: "email", destination: STUDENT_EMAIL, enabled: true },
      { channel: "sms", destination: STUDENT_PHONE, enabled: true },
    ]);
    mockSendEmail.mock.mockImplementation(async () => undefined);
    mockSendSms.mock.mockImplementation(async () => true);
  });

  it("logs no student id, email address, or phone number on the success path", async () => {
    const result = await notifications.sendMultiChannelNotification(STUDENT_ID, payload, 24);
    await flushDelivery();

    assert.equal(result.email, true);
    assert.equal(result.sms, true);

    const logged = loggedText();
    assert.ok(!logged.includes(STUDENT_ID), `log leaked the student id: ${logged}`);
    assert.ok(!logged.includes(STUDENT_EMAIL), `log leaked the email address: ${logged}`);
    assert.ok(!logged.includes(STUDENT_PHONE), `log leaked the phone number: ${logged}`);
  });

  it("keeps channel and notification type so delivery stays debuggable", async () => {
    await notifications.sendMultiChannelNotification(STUDENT_ID, payload, 24);
    await flushDelivery();

    const logged = loggedText();
    assert.ok(logged.includes("email"), "dropped the channel");
    assert.ok(logged.includes(payload.type), "dropped the notification type");
  });

  it("redacts the recipient address out of a bounced-email error", async () => {
    mockSendEmail.mock.mockImplementation(async () => {
      throw new Error(`550 5.1.1 <${STUDENT_EMAIL}>: recipient address rejected`);
    });

    await notifications.sendMultiChannelNotification(STUDENT_ID, payload, 24);
    await flushDelivery();

    assert.equal(mockError.mock.callCount(), 1);
    const logged = loggedText();
    assert.ok(!logged.includes(STUDENT_EMAIL), `error log leaked the address: ${logged}`);
    assert.ok(logged.includes("550 5.1.1"), "dropped the SMTP status needed to debug the bounce");
  });

  it("logs no student id when evicting a dead SSE connection", async () => {
    const failingWriter = {
      write: async () => {
        throw new Error("stream closed");
      },
      close: async () => undefined,
    } as unknown as WritableStreamDefaultWriter<Uint8Array>;

    notifications.addConnection(STUDENT_ID, failingWriter);
    await notifications.sendNotification(STUDENT_ID, payload);

    const logged = loggedText();
    assert.ok(!logged.includes(STUDENT_ID), `SSE eviction log leaked the student id: ${logged}`);
  });
});
