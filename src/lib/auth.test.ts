import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  signToken,
  verifyToken,
  hashPassword,
  verifyPassword,
  verifyPasswordWithStatus,
  verifyPasswordSafe,
  verifyPasswordSafeWithStatus,
} from "./auth";

test("signToken requires JWT_SECRET at call time", () => {
  const original = process.env.JWT_SECRET;
  delete process.env.JWT_SECRET;

  try {
    assert.throws(
      () => signToken("student-1", "student", 1),
      /JWT_SECRET environment variable is required/
    );
  } finally {
    if (original === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = original;
    }
  }
});

test("signToken and verifyToken round-trip claims with a configured secret", () => {
  const original = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "0123456789abcdef0123456789abcdef";

  try {
    const token = signToken("student-1", "teacher", 3);
    const claims = verifyToken(token);

    assert.ok(claims);
    assert.equal(claims.sub, "student-1");
    assert.equal(claims.role, "teacher");
    assert.equal(claims.sv, 3);
  } finally {
    if (original === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = original;
    }
  }
});

// ---------------------------------------------------------------------------
// Password hashing (scrypt current, PBKDF2 legacy)
// ---------------------------------------------------------------------------

test("hashPassword produces scrypt-prefixed hashes", () => {
  const { hash } = hashPassword("correct horse battery staple");
  assert.ok(hash.startsWith("scrypt$"));
  const parts = hash.split("$");
  assert.equal(parts.length, 3);
});

test("verifyPassword round-trips for newly created (scrypt) hashes", () => {
  const password = "super-secret-pw-xyz";
  const { hash } = hashPassword(password);
  assert.equal(verifyPassword(password, hash), true);
  assert.equal(verifyPassword("wrong", hash), false);
});

test("verifyPasswordWithStatus signals no rehash needed for scrypt hashes", () => {
  const { hash } = hashPassword("abcdefghij");
  const result = verifyPasswordWithStatus("abcdefghij", hash);
  assert.equal(result.valid, true);
  assert.equal(result.needsRehash, false);
});

test("verifyPasswordWithStatus accepts legacy PBKDF2 and signals rehash", () => {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync("legacy-secret", salt, 100000, 64, "sha512").toString("hex");
  const legacy = `${salt}:${hash}`;

  const ok = verifyPasswordWithStatus("legacy-secret", legacy);
  assert.equal(ok.valid, true);
  assert.equal(ok.needsRehash, true);

  const wrong = verifyPasswordWithStatus("bad-password", legacy);
  assert.equal(wrong.valid, false);
  assert.equal(wrong.needsRehash, false);
});

test("verifyPasswordSafe returns false for null/undefined stored hash", () => {
  assert.equal(verifyPasswordSafe("anything", null), false);
  assert.equal(verifyPasswordSafe("anything", undefined), false);
});

test("verifyPasswordSafeWithStatus never reports needsRehash for missing accounts", () => {
  const result = verifyPasswordSafeWithStatus("anything", null);
  assert.equal(result.valid, false);
  assert.equal(result.needsRehash, false);
});
