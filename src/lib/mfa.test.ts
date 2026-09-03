import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  claimBackupCode,
  claimTotpCounter,
  consumeBackupCode,
  hashBackupCodes,
  type BackupCodeClaimClient,
  type TotpCounterClaimClient,
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

// ---------------------------------------------------------------------------
// claimTotpCounter — the same conditional-write shape for the replay counter.
// Two requests carrying the same 6-digit code both pass verifyTotp when they
// read `mfaLastUsedCounter` before either writes; only the write that still
// sees the value it read may advance the counter and issue a session.
// ---------------------------------------------------------------------------

interface FakeCounterRow {
  mfaLastUsedCounter: number | null;
  mfaVerifiedAt: Date | null;
}

function fakeCounterStore(initial: number | null) {
  let row: FakeCounterRow = { mfaLastUsedCounter: initial, mfaVerifiedAt: null };
  const writes: number[] = [];

  const client: TotpCounterClaimClient = {
    student: {
      async updateMany(args) {
        const matches =
          args.where.id === STUDENT_ID && args.where.mfaLastUsedCounter === row.mfaLastUsedCounter;
        if (!matches) {
          writes.push(0);
          return { count: 0 };
        }
        row = {
          mfaLastUsedCounter: args.data.mfaLastUsedCounter,
          mfaVerifiedAt: args.data.mfaVerifiedAt,
        };
        writes.push(1);
        return { count: 1 };
      },
    },
  };

  return { client, current: () => row, writes };
}

describe("claimTotpCounter", () => {
  it("advances a never-used counter with a conditional write", async () => {
    const store = fakeCounterStore(null);

    const claimed = await claimTotpCounter(store.client, STUDENT_ID, null, 100);

    assert.equal(claimed, true);
    assert.equal(store.current().mfaLastUsedCounter, 100);
    assert.ok(store.current().mfaVerifiedAt instanceof Date);
  });

  it("advances the counter from the value that was read", async () => {
    const store = fakeCounterStore(99);

    const claimed = await claimTotpCounter(store.client, STUDENT_ID, 99, 100);

    assert.equal(claimed, true);
    assert.equal(store.current().mfaLastUsedCounter, 100);
  });

  it("refuses when the counter moved since the read", async () => {
    const store = fakeCounterStore(100);

    const claimed = await claimTotpCounter(store.client, STUDENT_ID, 99, 100);

    assert.equal(claimed, false);
    assert.deepEqual(store.writes, [0]);
    assert.equal(store.current().mfaLastUsedCounter, 100);
  });

  it("accepts exactly one of two interleaved claims of the same code", async () => {
    const store = fakeCounterStore(null);

    const results = await Promise.all([
      claimTotpCounter(store.client, STUDENT_ID, null, 100),
      claimTotpCounter(store.client, STUDENT_ID, null, 100),
    ]);

    assert.equal(results.filter(Boolean).length, 1);
    assert.equal(store.current().mfaLastUsedCounter, 100);
    assert.deepEqual(store.writes, [1, 0]);
  });
});
