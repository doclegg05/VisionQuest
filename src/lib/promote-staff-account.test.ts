/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding is assigned to several real function signatures; test setup only. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { studentLogKey } from "@/lib/log-keys";

// promoteTeacherToAdmin owns the ADMIN_KEY promotion write (review F11 /
// SEC-05): role and sessionVersion only, cache invalidation after the row
// changes, and a best-effort audit row attributed to the key holder.

const callOrder: string[] = [];
const mockUpdate = mock.fn() as any;
const mockInvalidateSessionCache = mock.fn() as any;
const mockLogAuditEvent = mock.fn() as any;
const mockLoggerError = mock.fn() as any;

mock.module("@/lib/db", {
  namedExports: {
    prismaAdmin: { student: { update: mockUpdate } },
    prisma: { student: { update: mockUpdate } },
  },
});
mock.module("@/lib/auth", {
  namedExports: { invalidateSessionCache: mockInvalidateSessionCache },
});
mock.module("@/lib/audit", {
  namedExports: { logAuditEvent: mockLogAuditEvent },
});
mock.module("@/lib/logger", {
  namedExports: { logger: { error: mockLoggerError, warn: mock.fn(), info: mock.fn(), debug: mock.fn() } },
});

let helper: Awaited<typeof import("./promote-staff-account")>;

before(async () => {
  helper = await import("./promote-staff-account");
});

const ACCOUNT_ID = "tch-1";
const IP = "203.0.113.9";

describe("promoteTeacherToAdmin", () => {
  beforeEach(() => {
    callOrder.length = 0;
    mockUpdate.mock.resetCalls();
    mockInvalidateSessionCache.mock.resetCalls();
    mockLogAuditEvent.mock.resetCalls();
    mockLoggerError.mock.resetCalls();

    mockUpdate.mock.mockImplementation(async () => {
      callOrder.push("update");
      return { id: ACCOUNT_ID, role: "admin" };
    });
    mockInvalidateSessionCache.mock.mockImplementation(() => {
      callOrder.push("invalidate");
    });
    mockLogAuditEvent.mock.mockImplementation(async () => undefined);
  });

  it("writes role and sessionVersion only, invalidates the cache after the row changes, and returns id + role", async () => {
    const result = await helper.promoteTeacherToAdmin({ accountId: ACCOUNT_ID, ip: IP });

    assert.deepEqual(result, { id: ACCOUNT_ID, role: "admin" });
    assert.equal(mockUpdate.mock.callCount(), 1);
    const { where, data, select } = mockUpdate.mock.calls[0].arguments[0];
    assert.deepEqual(where, { id: ACCOUNT_ID });
    assert.deepEqual(Object.keys(data).sort(), ["role", "sessionVersion"]);
    assert.equal(data.role, "admin");
    assert.deepEqual(data.sessionVersion, { increment: 1 });
    assert.deepEqual(select, { id: true, role: true }, "return only what the response needs");

    assert.equal(mockInvalidateSessionCache.mock.calls[0].arguments[0], ACCOUNT_ID);
    assert.deepEqual(callOrder, ["update", "invalidate"]);
  });

  it("audits as the admin key with the account id only in targetId", async () => {
    await helper.promoteTeacherToAdmin({ accountId: ACCOUNT_ID, ip: IP });

    assert.equal(mockLogAuditEvent.mock.callCount(), 1);
    const event = mockLogAuditEvent.mock.calls[0].arguments[0];
    assert.equal(event.action, "auth.promote_to_admin");
    assert.equal(event.actorId, helper.ADMIN_KEY_ACTOR);
    assert.equal(event.actorRole, helper.ADMIN_KEY_ACTOR);
    assert.equal(event.targetType, "student");
    assert.equal(event.targetId, ACCOUNT_ID);
    assert.equal(event.metadata.ip, IP);
    assert.equal(event.metadata.previousRole, "teacher");
    assert.equal(event.metadata.newRole, "admin");
    assert.equal("targetLogKey" in event.metadata, false);
  });

  it("swallows an audit failure: resolves, logs an alert keyed by studentLogKey, never the raw id", async () => {
    mockLogAuditEvent.mock.mockImplementation(async () => {
      throw new Error("audit table unavailable");
    });

    const result = await helper.promoteTeacherToAdmin({ accountId: ACCOUNT_ID, ip: IP });

    assert.deepEqual(result, { id: ACCOUNT_ID, role: "admin" });
    assert.equal(mockLoggerError.mock.callCount(), 1);
    const [message, meta] = mockLoggerError.mock.calls[0].arguments;
    assert.match(String(message), /audit/i);
    assert.equal(typeof meta.alert, "string");
    assert.equal(meta.target, studentLogKey(ACCOUNT_ID));
    assert.equal(meta.error, "audit table unavailable");
    assert.doesNotMatch(JSON.stringify([message, meta]), /tch-1/, "raw account id must not reach server logs");
  });

  it("rethrows when the update itself fails and audits nothing", async () => {
    mockUpdate.mock.mockImplementation(async () => {
      throw new Error("connection reset");
    });

    await assert.rejects(helper.promoteTeacherToAdmin({ accountId: ACCOUNT_ID, ip: IP }), /connection reset/);
    assert.equal(mockInvalidateSessionCache.mock.callCount(), 0);
    assert.equal(mockLogAuditEvent.mock.callCount(), 0);
    assert.equal(mockLoggerError.mock.callCount(), 0);
  });
});
