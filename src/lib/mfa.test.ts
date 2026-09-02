import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  claimBackupCode,
  consumeBackupCode,
  hashBackupCodes,
  type BackupCodeClaimClient,
} from "./mfa";

describe("consumeBackupCode", () => {
  it("removes a matching code and rejects reuse", () => {
    const originalCodes = ["deadbeef", "cafebabe"];
    const storedHashes = hashBackupCodes(originalCodes);

    const remaining = consumeBackupCode(storedHashes, "DEAD-BEEF");
    assert.deepEqual(remaining, [storedHashes[1]]);

    const reused = consumeBackupCode(remaining ?? [], "deadbeef");
    assert.equal(reused, null);
  });

  it("rejects unknown backup codes", () => {
    const storedHashes = hashBackupCodes(["deadbeef"]);
    assert.equal(consumeBackupCode(storedHashes, "feedface"), null);
  });
});

// ---------------------------------------------------------------------------
// claimBackupCode — the conditional write that keeps a backup code single-use
// when the same code arrives twice at once.
//
// The fake store models what Postgres does for
//   UPDATE "Student" SET ... WHERE id = $1 AND "mfaBackupCodes" = $2
// The row is replaced only while the stored list still equals the list the
// caller read, and the affected-row count says whether that happened. A
// read-modify-write (`findUnique` then `update`) cannot pass the interleaved
// cases below: both callers read the same list, both remove the code, both
// write, and the code is honoured twice.
// ---------------------------------------------------------------------------

const STUDENT_ID = "stu-1";

interface FakeRow {
  mfaBackupCodes: string[];
  mfaVerifiedAt: Date | null;
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function fakeBackupCodeStore(initial: string[]) {
  let row: FakeRow = { mfaBackupCodes: initial, mfaVerifiedAt: null };
  const writes: number[] = [];

  const client: BackupCodeClaimClient = {
    student: {
      async updateMany(args) {
        const matches =
          args.where.id === STUDENT_ID &&
          sameList(args.where.mfaBackupCodes.equals, row.mfaBackupCodes);
        if (!matches) {
          writes.push(0);
          return { count: 0 };
        }
        row = { mfaBackupCodes: args.data.mfaBackupCodes, mfaVerifiedAt: args.data.mfaVerifiedAt };
        writes.push(1);
        return { count: 1 };
      },
    },
  };

  return { client, current: () => row, writes };
}

describe("claimBackupCode", () => {
  it("claims a code with a conditional write and returns the remaining hashes", async () => {
    const stored = hashBackupCodes(["deadbeef", "cafebabe"]);
    const store = fakeBackupCodeStore(stored);

    const result = await claimBackupCode(store.client, STUDENT_ID, stored, "DEAD-BEEF");

    assert.ok(result.claimed);
    assert.deepEqual(result.remaining, [stored[1]]);
    assert.deepEqual(store.current().mfaBackupCodes, [stored[1]]);
    assert.ok(store.current().mfaVerifiedAt instanceof Date);
  });

  it("refuses an unknown code without writing", async () => {
    const stored = hashBackupCodes(["deadbeef"]);
    const store = fakeBackupCodeStore(stored);

    const result = await claimBackupCode(store.client, STUDENT_ID, stored, "feedface");

    assert.deepEqual(result, { claimed: false });
    assert.deepEqual(store.writes, []);
  });

  it("refuses a code once it has been spent", async () => {
    const stored = hashBackupCodes(["deadbeef", "cafebabe"]);
    const store = fakeBackupCodeStore(stored);

    const first = await claimBackupCode(store.client, STUDENT_ID, stored, "deadbeef");
    assert.ok(first.claimed);

    const second = await claimBackupCode(
      store.client,
      STUDENT_ID,
      store.current().mfaBackupCodes,
      "deadbeef",
    );
    assert.deepEqual(second, { claimed: false });
  });

  it("accepts exactly one of two interleaved claims of the same code", async () => {
    const stored = hashBackupCodes(["deadbeef", "cafebabe"]);
    const store = fakeBackupCodeStore(stored);

    // Both callers hold the same pre-write read, which is the interleaving the
    // challenge route sees when one code is posted twice at once.
    const results = await Promise.all([
      claimBackupCode(store.client, STUDENT_ID, stored, "deadbeef"),
      claimBackupCode(store.client, STUDENT_ID, stored, "deadbeef"),
    ]);

    assert.equal(results.filter((result) => result.claimed).length, 1);
    assert.deepEqual(store.current().mfaBackupCodes, [stored[1]]);
    assert.deepEqual(store.writes, [1, 0]);
  });

  it("never restores a spent code when interleaved claims use different codes", async () => {
    const stored = hashBackupCodes(["deadbeef", "cafebabe", "feedface"]);
    const store = fakeBackupCodeStore(stored);

    const results = await Promise.all([
      claimBackupCode(store.client, STUDENT_ID, stored, "deadbeef"),
      claimBackupCode(store.client, STUDENT_ID, stored, "cafebabe"),
    ]);

    // The loser is refused and must retry against a fresh read; the winner's
    // removal is never overwritten by a stale list.
    assert.equal(results.filter((result) => result.claimed).length, 1);
    assert.deepEqual(store.current().mfaBackupCodes, [stored[1], stored[2]]);
  });
});
