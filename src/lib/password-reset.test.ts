import assert from "node:assert/strict";
import { before, after } from "node:test";
import test from "node:test";
import { generatePasswordResetToken, hashPasswordResetToken } from "./password-reset";

let originalKey: string | undefined;

before(() => {
  originalKey = process.env.API_KEY_ENCRYPTION_KEY;
  if (!process.env.API_KEY_ENCRYPTION_KEY) {
    process.env.API_KEY_ENCRYPTION_KEY = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";
  }
});

after(() => {
  if (originalKey === undefined) {
    delete process.env.API_KEY_ENCRYPTION_KEY;
  } else {
    process.env.API_KEY_ENCRYPTION_KEY = originalKey;
  }
});

test("password reset tokens are generated with a future expiry and stable hashes", () => {
  const beforeTs = Date.now();
  const { token, tokenHash, expiresAt } = generatePasswordResetToken();

  assert.ok(token.length > 20);
  assert.equal(tokenHash, hashPasswordResetToken(token));
  assert.ok(expiresAt.getTime() > beforeTs);
});
