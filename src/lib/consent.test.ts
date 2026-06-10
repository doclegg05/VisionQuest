/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding must accept many signatures */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

const mockFindFirst = mock.fn() as any;
const mockCreate = mock.fn(async () => ({ id: "consent-1" })) as any;
const mockUpdateMany = mock.fn() as any;
const mockAudit = mock.fn(async () => undefined) as any;

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      consentRecord: {
        get findFirst() {
          return mockFindFirst;
        },
        get create() {
          return mockCreate;
        },
        get updateMany() {
          return mockUpdateMany;
        },
      },
    },
  },
});

mock.module("@/lib/audit", {
  namedExports: { logAuditEvent: mockAudit },
});

let consent: typeof import("./consent");

before(async () => {
  consent = await import("./consent");
});

describe("consent", () => {
  beforeEach(() => {
    mockFindFirst.mock.resetCalls();
    mockCreate.mock.resetCalls();
    mockUpdateMany.mock.resetCalls();
    mockAudit.mock.resetCalls();
    mockFindFirst.mock.mockImplementation(async () => null);
    mockUpdateMany.mock.mockImplementation(async () => ({ count: 1 }));
  });

  it("hasActiveConsent is true only when an unrevoked row exists", async () => {
    assert.equal(await consent.hasActiveConsent("stu-1", "cloud_file_processing"), false);
    mockFindFirst.mock.mockImplementation(async () => ({ id: "consent-1" }));
    assert.equal(await consent.hasActiveConsent("stu-1", "cloud_file_processing"), true);
    const where = mockFindFirst.mock.calls[0].arguments[0].where;
    assert.equal(where.revokedAt, null);
  });

  it("grantConsent creates a row and audits", async () => {
    const result = await consent.grantConsent("stu-1", "cloud_file_processing", "stu-1");
    assert.deepEqual(result, { granted: true });
    assert.equal(mockCreate.mock.callCount(), 1);
    assert.equal(mockAudit.mock.calls[0].arguments[0].action, "consent.granted");
  });

  it("grantConsent is idempotent when consent is already active", async () => {
    mockFindFirst.mock.mockImplementation(async () => ({ id: "consent-1" }));
    const result = await consent.grantConsent("stu-1", "cloud_file_processing", "stu-1");
    assert.deepEqual(result, { granted: false });
    assert.equal(mockCreate.mock.callCount(), 0);
    assert.equal(mockAudit.mock.callCount(), 0);
  });

  it("revokeConsent closes active rows and audits", async () => {
    const result = await consent.revokeConsent("stu-1", "cloud_file_processing", "stu-1");
    assert.deepEqual(result, { revoked: true });
    assert.equal(mockAudit.mock.calls[0].arguments[0].action, "consent.revoked");
  });

  it("revokeConsent is a no-op without active consent", async () => {
    mockUpdateMany.mock.mockImplementation(async () => ({ count: 0 }));
    const result = await consent.revokeConsent("stu-1", "cloud_file_processing", "stu-1");
    assert.deepEqual(result, { revoked: false });
    assert.equal(mockAudit.mock.callCount(), 0);
  });
});
