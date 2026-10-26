import assert from "node:assert/strict";
import { before, mock, test } from "node:test";
import { NextRequest } from "next/server";

// No keys, cookies, DB connections, or real authentication needed for CSRF tests.
mock.module("@/lib/session-token", { namedExports: { verifyToken: () => null } });
let proxy: typeof import("./proxy").proxy;
before(async () => { ({ proxy } = await import("./proxy")); });
const mutations = [
  ["POST", "/api/tasks"],
  ["PATCH", "/api/tasks/cm00000000000000000000001"],
  ["DELETE", "/api/tasks/cm00000000000000000000001"],
  ["PATCH", "/api/tasks/bulk-status"],
  ["POST", "/api/teacher/students/student-a/tasks"],
] as const;
function request(method: string, path: string, headers: Record<string, string>) {
  return new NextRequest(`http://localhost${path}`, { method, headers: { host: "localhost", ...headers } });
}

test("task writes reject missing, malformed, and foreign CSRF sources", () => {
  for (const [method, path] of mutations) {
    for (const headers of [
      {},
      { origin: "https://attacker.invalid" },
      { origin: "null" },
      { origin: "invalid" },
      { referer: "https://attacker.invalid/task" },
      { origin: "https://attacker.invalid", referer: "http://localhost/dashboard" },
      { origin: "null", referer: "http://localhost/dashboard" },
      { origin: "", referer: "http://localhost/dashboard" },
      { authorization: "Bearer synthetic-not-a-bypass" },
    ] as Record<string, string>[]) {
      assert.equal(proxy(request(method, path, headers)).status, 403, `${method} ${path}`);
    }
  }
});

test("task writes accept matching Origin or Referer only when Origin is absent", () => {
  for (const [method, path] of mutations) {
    for (const headers of [{ origin: "http://localhost" }, { referer: "http://localhost/dashboard" }] as Record<string, string>[]) {
      assert.equal(proxy(request(method, path, headers)).headers.get("x-middleware-next"), "1");
    }
  }
});

test("dashboard reads continue to route auth and client RLS headers are stripped", () => {
  for (const path of ["/api/dashboard/overview", "/api/dashboard/activity", "/api/dashboard/support", "/api/tasks"]) {
    const response = proxy(request("GET", path, { "x-vq-role": "admin", "x-vq-user-id": "other", "x-vq-student-id": "other" }));
    assert.equal(response.headers.get("x-middleware-next"), "1");
    for (const name of ["role", "user-id", "student-id"]) {
      assert.equal(response.headers.get(`x-middleware-request-x-vq-${name}`), null);
    }
  }
});
