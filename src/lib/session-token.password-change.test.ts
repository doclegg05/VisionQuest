import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import jwt from "jsonwebtoken";
import { signToken, verifyToken } from "./session-token";

// A session whose holder must choose a new password says so in its token, as
// `mustChangePassword: true`, so src/proxy.ts can hold it to the change screen
// without a database lookup. Every other token carries no such key: a token
// signed before the claim existed and a token for an account with nothing to
// change look the same, and getSession() settles any disagreement with the
// account row (src/lib/auth.password-change.test.ts).

const TEST_JWT_SECRET = "test-secret-for-session-token-password-change";

let originalSecret: string | undefined;

beforeEach(() => {
  originalSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = TEST_JWT_SECRET;
});

afterEach(() => {
  if (originalSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalSecret;
});

/** Signs a payload the way session-token.ts does: same secret, HS256. */
function signRaw(payload: Record<string, unknown>): string {
  return jwt.sign(payload, TEST_JWT_SECRET, { expiresIn: "7d", algorithm: "HS256" });
}

describe("the password-change claim on session tokens", () => {
  it("round-trips the claim for a session that must change its password", () => {
    const claims = verifyToken(signToken("s1", "student", 4, { mustChangePassword: true }));

    assert.equal(claims?.mustChangePassword, true);
    assert.deepEqual({ sub: claims?.sub, role: claims?.role, sv: claims?.sv }, { sub: "s1", role: "student", sv: 4 });
  });

  it("writes no key at all when there is nothing to change", () => {
    const claims = verifyToken(signToken("s1", "student", 4, { mustChangePassword: false }));

    assert.ok(claims, "the token must still verify");
    assert.equal("mustChangePassword" in claims, false);
  });

  it("writes no key when the option is left out", () => {
    const claims = verifyToken(signToken("s1", "student", 4));

    assert.ok(claims, "the token must still verify");
    assert.equal("mustChangePassword" in claims, false);
  });

  it("keeps the demo claim beside it", () => {
    const claims = verifyToken(signToken("s1", "student", 0, { demo: "student", mustChangePassword: false }));

    assert.equal(claims?.demo, "student");
    assert.equal(claims !== null && "mustChangePassword" in claims, false);
  });

  it("still verifies a token signed before the claim existed", () => {
    const claims = verifyToken(signRaw({ sub: "s1", role: "student", sv: 5 }));

    assert.deepEqual({ sub: claims?.sub, role: claims?.role, sv: claims?.sv }, { sub: "s1", role: "student", sv: 5 });
    assert.equal(claims !== null && "mustChangePassword" in claims, false);
  });

  it("rejects the whole token when the claim holds anything but true", () => {
    for (const bad of [false, "true", 1, 0, null, "", ["true"], { value: true }]) {
      const token = signRaw({ sub: "s1", role: "student", sv: 0, mustChangePassword: bad });
      assert.equal(verifyToken(token), null, `mustChangePassword: ${JSON.stringify(bad)} must be rejected`);
    }
  });
});
