import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";
import {
  signToken,
  verifyToken,
  signMfaSessionToken,
  verifyMfaSessionToken,
} from "./session-token";

// ---------------------------------------------------------------------------
// Session tokens and MFA-challenge tokens are deliberately NOT interchangeable.
//
// Both are HS256 over the same JWT_SECRET and carry the same sub/role/sv
// claims, so the only thing separating them is the `purpose` claim. Before
// this suite existed, `verifyToken` ignored `purpose` entirely, which meant a
// caller who obtained the short-lived MFA challenge cookie (handed out by
// /api/auth/login the moment a password verifies, before any TOTP is
// presented) could replay it as `vq-session` and hold a full staff session
// having never completed the second factor.
// ---------------------------------------------------------------------------

const TEST_JWT_SECRET = "0123456789abcdef0123456789abcdef";

function withSecret<T>(fn: () => T): T {
  const original = process.env.JWT_SECRET;
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  try {
    return fn();
  } finally {
    if (original === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = original;
  }
}

test("verifyToken rejects an MFA challenge token (second-factor bypass)", () => {
  withSecret(() => {
    const mfaToken = signMfaSessionToken("s1", "admin", 1);
    assert.equal(
      verifyToken(mfaToken),
      null,
      "an MFA challenge token must never verify as a session token",
    );
  });
});

test("verifyToken still accepts a plain session token", () => {
  withSecret(() => {
    const claims = verifyToken(signToken("s1", "admin", 1));
    assert.ok(claims, "a session token must still verify");
    assert.equal(claims.sub, "s1");
    assert.equal(claims.role, "admin");
    assert.equal(claims.sv, 1);
  });
});

test("verifyMfaSessionToken rejects a plain session token", () => {
  withSecret(() => {
    assert.equal(
      verifyMfaSessionToken(signToken("s1", "admin", 1)),
      null,
      "a session token must never satisfy the MFA challenge verifier",
    );
  });
});

test("verifyToken rejects any token carrying a purpose claim, not just mfa_challenge", () => {
  withSecret(() => {
    const forged = jwt.sign(
      { sub: "s1", role: "admin", sv: 1, purpose: "anything" },
      TEST_JWT_SECRET,
      { expiresIn: "5m", algorithm: "HS256" },
    );
    assert.equal(
      verifyToken(forged),
      null,
      "a purpose-scoped token of any kind must not verify as a session token",
    );
  });
});
