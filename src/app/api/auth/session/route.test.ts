import assert from "node:assert/strict";
import { before, describe, it, mock } from "node:test";
import type { Session } from "@/lib/api-error";
import { mockStudentSession } from "@/lib/test-helpers";

// GET /api/auth/session answers with the signed-in account's id, login name,
// display name and role. No cache between the browser and the server may keep
// that answer and hand it to the next person on a shared computer.

let session: Session | null = mockStudentSession();

mock.module("@/lib/auth", {
  exports: { getSession: async () => session, clearSession: async () => undefined },
});

let route: Awaited<typeof import("./route")>;

before(async () => {
  route = await import("./route");
});

describe("GET /api/auth/session", () => {
  it("is never stored by a shared cache or kept by the browser", async () => {
    session = mockStudentSession();
    const res = await route.GET();

    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Cache-Control"), "private, no-store");
  });

  it("still answers with the session", async () => {
    session = mockStudentSession();
    const body: unknown = await (await route.GET()).json();
    assert.deepEqual(body, { student: JSON.parse(JSON.stringify(session)) });
  });
});
