import assert from "node:assert/strict";
import { before, describe, it, mock } from "node:test";
import { mockRequest, mockStudentSession } from "@/lib/test-helpers";

const student = mockStudentSession();
const mockSyncStudentAlerts = mock.fn<(studentId: string) => Promise<void>>();

mock.module("@/lib/auth", { namedExports: { getSession: async () => student } });
mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      orientationItem: { findUnique: async () => ({ id: "welcome-video" }) },
      orientationProgress: { upsert: async () => ({}) },
    },
  },
});
mock.module("@/lib/progression/events", { namedExports: { awardEvent: async () => true } });
mock.module("@/lib/advising", { namedExports: { syncStudentAlerts: mockSyncStudentAlerts } });

let route: typeof import("./route");
before(async () => {
  route = await import("./route");
});

// Holds the mocked alert sync open, calls the handler, and fails if the
// response waited on the sync (prod, 2026-09-07: ~45 s on "Submitting...").
type SyncMock = {
  mock: { mockImplementation: (impl: (studentId: string) => Promise<void>) => void };
};

async function respondsWithoutWaiting(sync: SyncMock, call: () => Promise<Response>): Promise<Response> {
  let release: () => void = () => undefined;
  sync.mock.mockImplementation(() => new Promise<void>((resolve) => {
    release = resolve;
  }));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timed out">((resolve) => {
    timer = setTimeout(() => resolve("timed out"), 2000);
  });
  const outcome = await Promise.race([call(), timeout]);
  clearTimeout(timer);
  release();
  await new Promise((resolve) => setImmediate(resolve));
  if (outcome === "timed out") assert.fail("the response waited on the alert sync");
  return outcome;
}

describe("POST /api/orientation/welcome-video", () => {
  it("answers without waiting for the alert sync, and still starts it for the student", async () => {
    const res = await respondsWithoutWaiting(mockSyncStudentAlerts, () =>
      route.POST(mockRequest("/api/orientation/welcome-video", { method: "POST" }) as never),
    );
    assert.equal(res.status, 200);
    assert.equal(mockSyncStudentAlerts.mock.callCount(), 1);
    assert.deepEqual(mockSyncStudentAlerts.mock.calls[0].arguments, [student.id]);
  });
});
