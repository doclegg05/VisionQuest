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

mock.module("@/lib/email", {
  namedExports: { isEmailDeliveryConfigured: () => false, sendEmail: async () => undefined },
});
mock.module("@/lib/logger", {
  namedExports: {
    logger: { debug: mock.fn(), info: mock.fn(), warn: mock.fn(), error: mock.fn() },
  },
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
