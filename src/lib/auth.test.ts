import assert from "node:assert/strict";
import test from "node:test";
import { signToken, verifyToken } from "./auth";

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
