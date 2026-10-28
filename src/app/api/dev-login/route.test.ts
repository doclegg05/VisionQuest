import assert from "node:assert/strict";
import { after, mock, test } from "node:test";
import { NextRequest } from "next/server";

// Tripwires: a restored bypass must fail even if it swallows dependency errors.
const lookup = mock.fn(async () => { throw new Error("Account lookup forbidden"); });
const issueSession = mock.fn(async () => { throw new Error("Session issuance forbidden"); });
mock.module("@/lib/db", { namedExports: { prismaAdmin: { student: { findUnique: lookup, findFirst: lookup } } } });
mock.module("@/lib/auth", { namedExports: { setSessionCookie: issueSession } });
const original = process.env.NODE_ENV;
after(() => {
  if (original === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
  else Object.assign(process.env, { NODE_ENV: original });
});

test("retired dev login always returns 404 without accounts, sessions, or redirects", async () => {
  const { GET } = await import("./route");
  // Pass real requests to catch any future reintroduction of query-based login.
  const handler = GET as (request: NextRequest) => Promise<Response>;
  for (const environment of ["development", "test", "production", undefined]) {
    if (environment === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
    else Object.assign(process.env, { NODE_ENV: environment });
    for (const query of ["", "?role=admin", "?role=teacher", "?role=student", "?role=unknown", "?role=admin&role=student"]) {
      const response = await handler(new NextRequest(`http://localhost/api/dev-login${query}`));
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { error: "Not found" });
      assert.equal(response.headers.get("set-cookie"), null);
      assert.equal(response.headers.get("location"), null);
    }
  }
  assert.equal(lookup.mock.callCount(), 0);
  assert.equal(issueSession.mock.callCount(), 0);
});
