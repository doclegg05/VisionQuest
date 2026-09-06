/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding for the prismaAdmin twin. */
import assert from "node:assert/strict";
import { before, mock, test } from "node:test";

// ---------------------------------------------------------------------------
// getSession() must survive a full cache.
//
// getSession() caches its `Student` lookup for 10s through `cached()`. The
// backing node-cache is capped at 10,000 keys and THROWS `ECACHEFULL` from
// set() rather than evicting, so once the cache filled, every authenticated
// request threw out of getSession() and became a 500. The cache is fillable
// from outside: `credly:<username>` takes a caller-set username with a 600s
// TTL, and the documents-list key embeds caller-supplied search text.
//
// This suite fills the REAL singleton adapter rather than stubbing set(), so
// it exercises the exact mechanism the outage would.
// ---------------------------------------------------------------------------

const TEST_JWT_SECRET = "0123456789abcdef0123456789abcdef";
const MAX_KEYS = 10_000;

const mockStudentFindUnique = mock.fn(async () => ({
  id: "student-1",
  studentId: "S-0001",
  displayName: "A Student",
  role: "student",
  sessionVersion: 2,
  isActive: true,
})) as any;

let sessionCookieValue: string | undefined;

mock.module("next/headers", {
  namedExports: {
    cookies: async () => ({
      get: (name: string) =>
        name === "vq-session" && sessionCookieValue !== undefined
          ? { name, value: sessionCookieValue }
          : undefined,
    }),
  },
});

mock.module("./db", {
  namedExports: {
    prisma: {},
    prismaAdmin: { student: { findUnique: mockStudentFindUnique } },
  },
});

let getSession: typeof import("./auth").getSession;
let signToken: typeof import("./auth").signToken;
let cached: typeof import("./cache").cached;

before(async () => {
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  ({ getSession, signToken } = await import("./auth"));
  ({ cached } = await import("./cache"));
});

test("getSession returns the session even when the session cache is full", async () => {
  // Fill the singleton adapter to its maxKeys ceiling.
  for (let i = 0; i < MAX_KEYS; i++) {
    await cached(`auth-overflow-fill:${i}`, 600, async () => i);
  }

  sessionCookieValue = signToken("student-1", "student", 2);

  const session = await getSession();

  assert.ok(session, "a full cache must not turn an authenticated request into an error");
  assert.equal(session.id, "student-1");
  assert.equal(session.role, "student");
});
