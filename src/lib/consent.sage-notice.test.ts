import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

// The Sage notice acknowledgement is a ConsentRecord row (no schema change).
// Who: studentId and recordedBy. Which version: the scope, which carries it.
// When: grantedAt, the column's default. Nothing else is written: no notice
// text, no IP, no device.

interface Row {
  studentId: string;
  scope: string;
  recordedBy: string;
  revokedAt: Date | null;
}

const rows: Row[] = [];
const created: unknown[] = [];
const audits: Array<Record<string, unknown>> = [];

function matches(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => row[key as keyof Row] === value);
}

mock.module("@/lib/db", {
  exports: {
    prisma: {
      consentRecord: {
        findFirst: async ({ where }: { where: Record<string, unknown> }) =>
          rows.find((row) => matches(row, where)) ? { id: "c1" } : null,
        create: async ({ data }: { data: Omit<Row, "revokedAt"> }) => {
          created.push(data);
          rows.push({ ...data, revokedAt: null });
          return { id: "c1" };
        },
      },
    },
  },
});

mock.module("@/lib/audit", {
  exports: {
    logAuditEvent: async (event: Record<string, unknown>) => {
      audits.push(event);
    },
  },
});

let consent: typeof import("./consent");

before(async () => {
  consent = await import("./consent");
});

describe("Sage notice acknowledgement record", () => {
  beforeEach(() => {
    rows.length = 0;
    created.length = 0;
    audits.length = 0;
  });

  it("stores who and which version, and nothing else", async () => {
    const result = await consent.recordSageNoticeAcknowledgement("stu-1", "2026-11-10");

    assert.deepEqual(result, { recorded: true });
    assert.deepEqual(created, [
      { studentId: "stu-1", scope: "sage_notice:2026-11-10", recordedBy: "stu-1" },
    ]);
  });

  it("is not written twice for the same version", async () => {
    await consent.recordSageNoticeAcknowledgement("stu-1", "2026-11-10");
    const second = await consent.recordSageNoticeAcknowledgement("stu-1", "2026-11-10");

    assert.deepEqual(second, { recorded: false });
    assert.equal(created.length, 1);
  });

  it("counts only an acknowledgement of the version asked about", async () => {
    await consent.recordSageNoticeAcknowledgement("stu-1", "2026-01-01");

    assert.equal(await consent.hasAcknowledgedSageNotice("stu-1", "2026-01-01"), true);
    assert.equal(await consent.hasAcknowledgedSageNotice("stu-1", "2026-11-10"), false);
  });

  it("does not count another student's acknowledgement", async () => {
    await consent.recordSageNoticeAcknowledgement("stu-2", "2026-11-10");

    assert.equal(await consent.hasAcknowledgedSageNotice("stu-1", "2026-11-10"), false);
  });

  it("counts a revoked row as not acknowledged", async () => {
    rows.push({ studentId: "stu-1", scope: "sage_notice:2026-11-10", recordedBy: "stu-1", revokedAt: new Date() });

    assert.equal(await consent.hasAcknowledgedSageNotice("stu-1", "2026-11-10"), false);
  });

  it("audits the acknowledgement as the student, with the version and no notice text", async () => {
    await consent.recordSageNoticeAcknowledgement("stu-1", "2026-11-10");

    assert.equal(audits.length, 1);
    assert.equal(audits[0].actorId, "stu-1");
    assert.equal(audits[0].actorRole, "student");
    assert.equal(audits[0].action, "consent.granted");
    assert.equal(audits[0].summary, "Sage notice acknowledged, version 2026-11-10");
  });

  it("keeps the notice out of the self-service consent scopes", () => {
    assert.equal(consent.consentScopeSchema.safeParse("sage_notice:2026-11-10").success, false);
  });
});
