/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding must accept many signatures */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

const STUDENT_ID = "clstudent0000abcdefghijkl";
const STUDENT_EMAIL = "jane.doe@example.com";
const STUDENT_PHONE = "+15551234567";

const mockNotificationCreate = mock.fn() as any;
const mockNotificationFindFirst = mock.fn() as any;
// prismaAdmin twins: staff recipients (crisis alerts, teacher nudges) are
// written from a student's request context and must bypass its RLS scope.
const mockAdminNotificationCreate = mock.fn() as any;
const mockAdminNotificationFindFirst = mock.fn() as any;
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
    prismaAdmin: {
      notification: {
        get create() {
          return mockAdminNotificationCreate;
        },
        get findFirst() {
          return mockAdminNotificationFindFirst;
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

// ---------------------------------------------------------------------------
// Staff recipients (F2). A Notification for a teacher raised from a student's
// request context (crisis alert, teacher nudge) must be read and written
// through prismaAdmin: under vq_app the student's RLS context cannot see a row
// whose studentId is a teacher (so the cooldown read is blind) and
// `notification_access` WITH CHECK rejects inserting one. The SSE push is
// keyed on the recipient id and must fire exactly as before.
// ---------------------------------------------------------------------------

const TEACHER_ID = "clteacher0000abcdefghijkl";
const staffPayload = {
  type: "wellbeing.concern",
  title: "Wellbeing check-in needed",
  body: "A student may need support. Please check in with them directly.",
};

describe("sendNotificationWithCooldown for staff recipients", () => {
  beforeEach(() => {
    for (const m of [
      mockNotificationCreate,
      mockNotificationFindFirst,
      mockAdminNotificationCreate,
      mockAdminNotificationFindFirst,
      mockDebug,
      mockInfo,
      mockWarn,
      mockError,
    ]) {
      m.mock.resetCalls();
    }

    mockNotificationFindFirst.mock.mockImplementation(async () => null);
    mockNotificationCreate.mock.mockImplementation(async () => ({
      id: "app-notif-1",
      type: payload.type,
      title: payload.title,
      body: payload.body,
      createdAt: new Date("2026-09-01T12:00:00.000Z"),
    }));
    mockAdminNotificationFindFirst.mock.mockImplementation(async () => null);
    mockAdminNotificationCreate.mock.mockImplementation(async () => ({
      id: "admin-notif-1",
      type: staffPayload.type,
      title: staffPayload.title,
      body: staffPayload.body,
      createdAt: new Date("2026-09-01T12:00:00.000Z"),
    }));
  });

  it("reads the cooldown window and writes the row through prismaAdmin, not the app client", async () => {
    const sent = await notifications.sendNotificationWithCooldown(TEACHER_ID, staffPayload, 12, {
      client: "admin",
    });

    assert.equal(sent, true);
    assert.equal(mockAdminNotificationFindFirst.mock.callCount(), 1, "cooldown read on prismaAdmin");
    assert.equal(mockAdminNotificationCreate.mock.callCount(), 1, "insert on prismaAdmin");
    assert.equal(
      mockNotificationFindFirst.mock.callCount(),
      0,
      "an app-client cooldown read runs under the student's RLS context and sees nothing",
    );
    assert.equal(
      mockNotificationCreate.mock.callCount(),
      0,
      "an app-client insert is rejected by notification_access WITH CHECK",
    );
    assert.equal(mockAdminNotificationCreate.mock.calls[0].arguments[0].data.studentId, TEACHER_ID);
  });

  it("honors the cooldown through the admin client", async () => {
    mockAdminNotificationFindFirst.mock.mockImplementation(async () => ({ id: "recent" }));

    const sent = await notifications.sendNotificationWithCooldown(TEACHER_ID, staffPayload, 12, {
      client: "admin",
    });

    assert.equal(sent, false);
    assert.equal(mockAdminNotificationCreate.mock.callCount(), 0);
    assert.equal(mockNotificationCreate.mock.callCount(), 0);
  });

  it("still pushes the persisted row to the recipient's live SSE connection", async () => {
    const chunks: string[] = [];
    const writer = {
      write: async (chunk: Uint8Array) => {
        chunks.push(new TextDecoder().decode(chunk));
      },
      close: async () => undefined,
    } as unknown as WritableStreamDefaultWriter<Uint8Array>;

    const remove = notifications.addConnection(TEACHER_ID, writer);
    try {
      await notifications.sendNotificationWithCooldown(TEACHER_ID, staffPayload, 12, {
        client: "admin",
      });
    } finally {
      remove();
    }

    assert.equal(chunks.length, 1, "one SSE event for the teacher");
    const event = JSON.parse(chunks[0].replace(/^data: /, "").trim());
    assert.equal(event.id, "admin-notif-1", "the pushed row is the one prismaAdmin persisted");
    assert.equal(event.type, staffPayload.type);
  });

  it("defaults to the app client when no client option is given", async () => {
    await notifications.sendNotificationWithCooldown(STUDENT_ID, payload, 24);

    assert.equal(mockNotificationFindFirst.mock.callCount(), 1);
    assert.equal(mockNotificationCreate.mock.callCount(), 1);
    assert.equal(mockAdminNotificationFindFirst.mock.callCount(), 0);
    assert.equal(mockAdminNotificationCreate.mock.callCount(), 0);
  });
});
