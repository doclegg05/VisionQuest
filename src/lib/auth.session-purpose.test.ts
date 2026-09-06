/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding for the prismaAdmin twin. */
import assert from "node:assert/strict";
import { before, beforeEach, mock, test } from "node:test";

// ---------------------------------------------------------------------------
// getSession() must not accept an MFA challenge token.
//
// /api/auth/login hands out `vq-mfa-challenge` as soon as the PASSWORD
// verifies — before any TOTP code is presented. That cookie is httpOnly and
// path-scoped to /api/auth/mfa in a browser, but a non-browser client sees it
// in the raw Set-Cookie header and can send it back as `vq-session`. This
// suite pins the outcome at the session layer rather than only at the token
// verifier, because getSession() is what every authenticated route trusts.
// ---------------------------------------------------------------------------

const TEST_JWT_SECRET = "0123456789abcdef0123456789abcdef";

const mockStudentFindUnique = mock.fn() as any;

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
let signMfaSessionToken: typeof import("./session-token").signMfaSessionToken;

before(async () => {
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  ({ getSession, signToken } = await import("./auth"));
  ({ signMfaSessionToken } = await import("./session-token"));
});

beforeEach(() => {
  mockStudentFindUnique.mock.resetCalls();
  mockStudentFindUnique.mock.mockImplementation(async () => ({
    id: "staff-1",
    studentId: "T-0001",
    displayName: "Staff Member",
    role: "teacher",
    sessionVersion: 4,
    isActive: true,
  }));
  sessionCookieValue = undefined;
});

test("getSession returns null when vq-session holds an MFA challenge token", async () => {
  sessionCookieValue = signMfaSessionToken("staff-1", "teacher", 4);

  const session = await getSession();

  assert.equal(
    session,
    null,
    "replaying the MFA challenge cookie as vq-session must not yield a session",
  );
  assert.equal(
    mockStudentFindUnique.mock.callCount(),
    0,
    "the rejected token must never reach a database lookup",
  );
});

test("getSession still returns the session for a real session token", async () => {
  sessionCookieValue = signToken("staff-1", "teacher", 4);

  const session = await getSession();

  assert.ok(session, "a real session token must still produce a session");
  assert.equal(session.id, "staff-1");
  assert.equal(session.role, "teacher");
});
