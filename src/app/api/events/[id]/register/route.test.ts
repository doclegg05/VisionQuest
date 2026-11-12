import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockRequest, mockStudentSession } from "@/lib/test-helpers";

const student = mockStudentSession();
const EVENT_ID = "cm00000000000000000000009";
const mockSyncStudentAlerts = mock.fn<(studentId: string) => Promise<void>>();
const registration = { id: "reg-1", event: { title: "Job fair" } };

mock.module("@/lib/auth", { namedExports: { getSession: async () => student } });
mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      careerEvent: {
        findUnique: async () => ({ id: EVENT_ID, title: "Job fair", capacity: null, registrationRequired: false }),
      },
      eventRegistration: { findFirst: async () => registration, delete: async () => registration },
      $transaction: async (work: (tx: unknown) => Promise<unknown>) =>
        work({ eventRegistration: { upsert: async () => registration } }),
    },
  },
});
mock.module("@/lib/audit", { namedExports: { logAuditEvent: async () => undefined } });
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

const params = { params: Promise.resolve({ id: EVENT_ID }) };
const CASES = [
  ["POST", () => route.POST(mockRequest(`/api/events/${EVENT_ID}/register`, { method: "POST" }), params)],
  ["DELETE", () => route.DELETE(mockRequest(`/api/events/${EVENT_ID}/register`, { method: "DELETE" }), params)],
] as const;

describe("/api/events/[id]/register", () => {
  beforeEach(() => mockSyncStudentAlerts.mock.resetCalls());

  for (const [method, call] of CASES) {
    it(`${method} answers without waiting for the alert sync, and still starts it`, async () => {
      const res = await respondsWithoutWaiting(mockSyncStudentAlerts, call);
      assert.equal(res.status, 200);
      assert.equal(mockSyncStudentAlerts.mock.callCount(), 1);
      assert.deepEqual(mockSyncStudentAlerts.mock.calls[0].arguments, [student.id]);
    });
  }
});
