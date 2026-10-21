import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import jwt from "jsonwebtoken";
import { signToken, verifyToken } from "./session-token";

// The demo marker rides in the session token as an optional `demo` claim so
// that src/proxy.ts can read it without a database lookup. Real accounts must
// keep carrying exactly the claims they carried before: no `demo` key at all.

const TEST_JWT_SECRET = "demo-claim-test-secret-at-least-32-chars-long";

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

describe("demo claim on session tokens", () => {
  it("round-trips the demo claim", () => {
    const claims = verifyToken(signToken("s1", "teacher", 0, { demo: "instructor" }));
    assert.equal(claims?.demo, "instructor");
    assert.equal(claims?.sub, "s1");
    assert.equal(claims?.role, "teacher");
    assert.equal(claims?.sv, 0);
  });

  it("round-trips the student kind", () => {
    assert.equal(verifyToken(signToken("s2", "student", 3, { demo: "student" }))?.demo, "student");
  });

  it("omits the claim for real accounts", () => {
    const claims = verifyToken(signToken("s1", "student", 0));
    assert.ok(claims, "a plain token must still verify");
    assert.equal("demo" in claims, false);
  });

  it("omits the claim when options carry no demo kind", () => {
    const claims = verifyToken(signToken("s1", "student", 0, {}));
    assert.ok(claims, "a token signed with empty options must still verify");
    assert.equal("demo" in claims, false);
  });

  it("still verifies an older token that was signed with no demo claim at all", () => {
    const claims = verifyToken(signRaw({ sub: "s1", role: "student", sv: 5 }));
    assert.deepEqual(
      { sub: claims?.sub, role: claims?.role, sv: claims?.sv },
      { sub: "s1", role: "student", sv: 5 },
    );
    assert.equal(claims !== null && "demo" in claims, false);
  });

  it("rejects an unknown demo value", () => {
    const token = signRaw({ sub: "s1", role: "teacher", sv: 0, demo: "admin" });
    assert.equal(verifyToken(token), null);
  });

  it("rejects a demo value that is not a string", () => {
    for (const bad of [1, true, null, ["instructor"], { kind: "instructor" }]) {
      const token = signRaw({ sub: "s1", role: "teacher", sv: 0, demo: bad });
      assert.equal(verifyToken(token), null, `demo: ${JSON.stringify(bad)} must be rejected`);
    }
  });

  it("rejects an empty demo string", () => {
    assert.equal(verifyToken(signRaw({ sub: "s1", role: "teacher", sv: 0, demo: "" })), null);
  });
});
