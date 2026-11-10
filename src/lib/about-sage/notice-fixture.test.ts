import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SAGE_NOTICE_VERSION, sageNoticeScope } from "./notice";
import { acknowledgeSageNoticeForFixture, type ConsentRecordWriter } from "./notice-fixture";

interface StoredRow {
  studentId: string;
  scope: string;
  recordedBy: string;
  revokedAt: Date | null;
}

/** A consent table that answers the two calls the helper makes. */
function consentTable(rows: StoredRow[] = []): { client: ConsentRecordWriter; rows: StoredRow[] } {
  const client: ConsentRecordWriter = {
    consentRecord: {
      findFirst: async ({ where }) => {
        const found = rows.find(
          (row) => row.studentId === where.studentId && row.scope === where.scope && row.revokedAt === where.revokedAt,
        );
        return found ? { id: "found" } : null;
      },
      create: async ({ data }) => {
        rows.push({ ...data, revokedAt: null });
        return { id: "created" };
      },
    },
  };
  return { client, rows };
}

const CURRENT_SCOPE = sageNoticeScope(SAGE_NOTICE_VERSION);

describe("acknowledgeSageNoticeForFixture", () => {
  it("writes one row for the current notice version, recorded by the student", async () => {
    const { client, rows } = consentTable();
    await acknowledgeSageNoticeForFixture(client, "student-1");
    assert.deepEqual(rows, [
      { studentId: "student-1", scope: CURRENT_SCOPE, recordedBy: "student-1", revokedAt: null },
    ]);
  });

  it("adds nothing when the seed runs again", async () => {
    const { client, rows } = consentTable();
    await acknowledgeSageNoticeForFixture(client, "student-1");
    await acknowledgeSageNoticeForFixture(client, "student-1");
    assert.equal(rows.length, 1);
  });

  it("writes the current version when only an older one is on file", async () => {
    const older = { studentId: "student-1", scope: sageNoticeScope("2020-01-01"), recordedBy: "student-1", revokedAt: null };
    const { client, rows } = consentTable([older]);
    await acknowledgeSageNoticeForFixture(client, "student-1");
    assert.deepEqual(rows.map((row) => row.scope), [older.scope, CURRENT_SCOPE]);
  });

  it("writes a new row when the one on file was revoked", async () => {
    const revoked = { studentId: "student-1", scope: CURRENT_SCOPE, recordedBy: "student-1", revokedAt: new Date(0) };
    const { client, rows } = consentTable([revoked]);
    await acknowledgeSageNoticeForFixture(client, "student-1");
    assert.equal(rows.length, 2);
    assert.equal(rows[1]?.revokedAt, null);
  });

  it("keeps each student's row apart", async () => {
    const { client, rows } = consentTable();
    await acknowledgeSageNoticeForFixture(client, "student-1");
    await acknowledgeSageNoticeForFixture(client, "student-2");
    assert.deepEqual(rows.map((row) => row.studentId), ["student-1", "student-2"]);
  });
});
