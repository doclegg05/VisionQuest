import assert from "node:assert/strict";
import { mock, test } from "node:test";

const set = mock.fn();
mock.module("next/headers", { namedExports: { cookies: async () => ({ set }) } });
mock.module("./db", { namedExports: { prismaAdmin: {} } });

test("the timing dummy password never authenticates an unsupported stored hash", async () => {
  const { verifyPasswordSafeWithStatus } = await import("./auth");
  for (const stored of ["unsupported-hash", "", null, undefined]) {
    assert.deepEqual(verifyPasswordSafeWithStatus("dummy-password-never-matches", stored), {
      valid: false, needsRehash: false,
    });
  }
});

test("MFA challenge removal expires the same path-scoped cookie that login sets", async () => {
  const { setMfaSessionCookie, clearMfaSessionCookie } = await import("./auth");
  await setMfaSessionCookie("test-token");
  await clearMfaSessionCookie();
  const [created, cleared] = set.mock.calls.map((call) => call.arguments as unknown[]);
  assert.equal(created[0], "vq-mfa-challenge");
  assert.equal(cleared[0], created[0]);
  assert.equal(cleared[1], "");
  assert.equal((cleared[2] as { path: string }).path, "/api/auth/mfa");
  assert.deepEqual(cleared[2], { ...(created[2] as object), maxAge: 0 });
});
