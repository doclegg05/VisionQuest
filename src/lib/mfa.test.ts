import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { consumeBackupCode, hashBackupCodes } from "./mfa";

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
