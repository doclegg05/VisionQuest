/* eslint-disable @typescript-eslint/no-explicit-any -- route mocks intentionally cover inferred Better Auth and cookie store shapes. */
import assert from "node:assert/strict";
import { before, beforeEach, test, mock } from "node:test";
import { mockRequest } from "@/lib/test-helpers";

const getBetterSession = mock.fn() as any;
const deleteAuthSession = mock.fn() as any;
const clearSession = mock.fn() as any;
const deleteCookie = mock.fn() as any;

mock.module("@/lib/better-auth", {
  namedExports: {
    auth: { api: { getSession: getBetterSession } },
  },
});

mock.module("@/lib/db", {
  namedExports: {
    prismaAdmin: {
      authSession: { deleteMany: deleteAuthSession },
    },
  },
});

mock.module("@/lib/auth", {
  namedExports: {
    getSession: async () => null,
    clearSession,
  },
});

mock.module("next/headers", {
  namedExports: {
    cookies: async () => ({
      getAll: () => [
        { name: "better-auth.session_token" },
        { name: "__Secure-better-auth.session_token" },
        { name: "unrelated-cookie" },
      ],
      delete: deleteCookie,
    }),
  },
});

let route: Awaited<typeof import("./route")>;

before(async () => {
  route = await import("./route");
});

beforeEach(() => {
  for (const fn of [
    getBetterSession,
    deleteAuthSession,
    clearSession,
    deleteCookie,
  ]) {
    fn.mock.resetCalls();
  }
  getBetterSession.mock.mockImplementation(async () => ({
    user: { id: "teacher-1" },
    session: { token: "better-session-1" },
  }));
  deleteAuthSession.mock.mockImplementation(async () => ({ count: 1 }));
  clearSession.mock.mockImplementation(async () => undefined);
  deleteCookie.mock.mockImplementation(() => undefined);
});

test("logout revokes the current Better Auth session and clears both auth cookies", async () => {
  const response = await route.DELETE(
    mockRequest("/api/auth/session", { method: "DELETE" }) as never,
  );

  assert.equal(response.status, 200);
  assert.deepEqual(deleteAuthSession.mock.calls[0].arguments[0], {
    where: {
      token: "better-session-1",
      userId: "teacher-1",
    },
  });
  assert.equal(clearSession.mock.callCount(), 1);
  assert.deepEqual(
    deleteCookie.mock.calls.map((call: any) => call.arguments[0]),
    [
      "better-auth.session_token",
      "__Secure-better-auth.session_token",
    ],
  );
});

