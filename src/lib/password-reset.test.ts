import assert from "node:assert/strict";
import test from "node:test";
import { generatePasswordResetToken, hashPasswordResetToken } from "./password-reset";

test("password reset tokens are generated with a future expiry and stable hashes", () => {
  const before = Date.now();
  const { token, tokenHash, expiresAt } = generatePasswordResetToken();

  assert.ok(token.length > 20);
  assert.equal(tokenHash, hashPasswordResetToken(token));
  assert.ok(expiresAt.getTime() > before);
});
