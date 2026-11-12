import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockRequest, mockStudentSession } from "@/lib/test-helpers";

const student = mockStudentSession();
const ITEM_ID = "cm00000000000000000000001";
const item = { id: ITEM_ID, studentId: student.id, title: "Project", type: "project" };
const mockSyncStudentAlerts = mock.fn<(studentId: string) => Promise<void>>();

mock.module("@/lib/auth", { namedExports: { getSession: async () => student } });
mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      fileUpload: { findFirst: async () => null },
      certRequirement: { findFirst: async () => null },
      portfolioItem: {
        aggregate: async () => ({ _max: { sortOrder: 0 } }),
        findFirst: async () => item,
        update: async () => item,
        delete: async () => item,
      },
      $transaction: async (work: (tx: unknown) => Promise<unknown>) =>
        work({ portfolioItem: { create: async () => item } }),
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

const CASES = [
  ["POST", () => route.POST(mockRequest("/api/portfolio", { method: "POST", body: { title: "Project" } }) as never)],
  ["PUT", () => route.PUT(mockRequest("/api/portfolio", { method: "PUT", body: { id: ITEM_ID, title: "Renamed" } }) as never)],
  ["DELETE", () => route.DELETE(mockRequest("/api/portfolio", { method: "DELETE", body: { id: ITEM_ID } }) as never)],
] as const;

describe("/api/portfolio writes", () => {
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
