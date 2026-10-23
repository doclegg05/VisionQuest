import assert from "node:assert/strict";
import { afterEach, before, beforeEach, describe, it, mock } from "node:test";
import jwt from "jsonwebtoken";

// getSession() must expose the demo marker from the Student row, and must
// honor the COHORT_DEMO_MODE switch on every call, even when the row came out
// of the 10 second session cache. Turning the switch off is the owner's
// emergency stop for demo mode: it cannot wait for a cache entry to expire.

const TEST_JWT_SECRET = "demo-session-test-secret-at-least-32-chars-long";
const SWITCH_VARIABLE = "COHORT_DEMO_MODE";

interface StudentRow {
  id: string;
  studentId: string;
  displayName: string;
  role: string;
  sessionVersion: number;
  isActive: boolean;
  demoAccount: "student" | "instructor" | null;
}

const mockFindUnique = mock.fn<(args: unknown) => Promise<StudentRow | null>>(async () => null);
const mockCookieSet = mock.fn<(...args: unknown[]) => void>();

let sessionCookieValue: string | undefined;

mock.module("next/headers", {
  exports: {
    cookies: async () => ({
      get: (name: string) =>
        name === "vq-session" && sessionCookieValue !== undefined
          ? { name, value: sessionCookieValue }
          : undefined,
      set: mockCookieSet,
    }),
  },
});

mock.module("./db", {
  exports: {
    prisma: {},
    prismaAdmin: { student: { findUnique: mockFindUnique }, sageConfirmationUse: { findUnique: async () => null } },
  },
});

let getSession: typeof import("./auth").getSession;
let signToken: typeof import("./auth").signToken;
let setSessionCookie: typeof import("./auth").setSessionCookie;
let verifyToken: typeof import("./auth").verifyToken;

let originalSecret: string | undefined;
let originalSwitch: string | undefined;

// Each test uses its own student id so the real 10 second session cache never
// hands one test another test's row. The cache test reuses an id on purpose.
let nextId = 0;
function freshId(): string {
  nextId += 1;
  return `demo-session-${nextId}`;
}

function rowFor(
  id: string,
  overrides: Partial<StudentRow> = {},
): StudentRow {
  return {
    id,
    studentId: `login-${id}`,
    displayName: "Some Person",
    role: "student",
    sessionVersion: 1,
    isActive: true,
    demoAccount: null,
    ...overrides,
  };
}

before(async () => {
  originalSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  ({ getSession, signToken, setSessionCookie, verifyToken } = await import("./auth"));
});

beforeEach(() => {
  originalSwitch = process.env[SWITCH_VARIABLE];
  delete process.env[SWITCH_VARIABLE];
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  mockFindUnique.mock.resetCalls();
  mockCookieSet.mock.resetCalls();
  sessionCookieValue = undefined;
});

afterEach(() => {
  if (originalSwitch === undefined) delete process.env[SWITCH_VARIABLE];
  else process.env[SWITCH_VARIABLE] = originalSwitch;
  if (originalSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalSecret;
});

describe("getSession and the demo marker", () => {
  it("returns demoAccount when the switch is on", async () => {
    process.env[SWITCH_VARIABLE] = "true";
    const id = freshId();
    mockFindUnique.mock.mockImplementation(async () =>
      rowFor(id, { demoAccount: "instructor", role: "teacher" }),
    );
    sessionCookieValue = signToken(id, "teacher", 1, { demo: "instructor" });

    const session = await getSession();

    assert.ok(session, "a demo row must produce a session while the switch is on");
    assert.equal(session.demoAccount, "instructor");
    assert.equal(session.id, id);
    assert.equal(session.role, "teacher");
  });

  it("returns null for a demo row when the switch is off", async () => {
    const id = freshId();
    mockFindUnique.mock.mockImplementation(async () => rowFor(id, { demoAccount: "student" }));
    sessionCookieValue = signToken(id, "student", 1, { demo: "student" });

    assert.equal(await getSession(), null);
  });

  it("returns null for a demo row when the switch is set to anything but true", async () => {
    process.env[SWITCH_VARIABLE] = "yes";
    const id = freshId();
    mockFindUnique.mock.mockImplementation(async () => rowFor(id, { demoAccount: "student" }));
    sessionCookieValue = signToken(id, "student", 1, { demo: "student" });

    assert.equal(await getSession(), null);
  });

  it("returns real accounts unchanged when the switch is off", async () => {
    const id = freshId();
    mockFindUnique.mock.mockImplementation(async () => rowFor(id));
    sessionCookieValue = signToken(id, "student", 1);

    const session = await getSession();

    assert.deepEqual(session, {
      id,
      studentId: `login-${id}`,
      displayName: "Some Person",
      role: "student",
    });
    assert.equal(session !== null && "demoAccount" in session, false);
  });

  it("returns real accounts unchanged when the switch is on", async () => {
    process.env[SWITCH_VARIABLE] = "true";
    const id = freshId();
    mockFindUnique.mock.mockImplementation(async () => rowFor(id, { role: "teacher" }));
    sessionCookieValue = signToken(id, "teacher", 1);

    const session = await getSession();

    assert.ok(session);
    assert.equal("demoAccount" in session, false, "a real account must carry no demoAccount key");
  });

  it("reads the switch after the cache, so turning it off bites on a cached row", async () => {
    const id = freshId();
    mockFindUnique.mock.mockImplementation(async () => rowFor(id, { demoAccount: "student" }));
    sessionCookieValue = signToken(id, "student", 1, { demo: "student" });

    process.env[SWITCH_VARIABLE] = "true";
    const first = await getSession();
    assert.equal(first?.demoAccount, "student");
    assert.equal(mockFindUnique.mock.callCount(), 1);

    delete process.env[SWITCH_VARIABLE];
    const second = await getSession();

    assert.equal(second, null, "the switch must be honored even though the row is cached");
    assert.equal(
      mockFindUnique.mock.callCount(),
      1,
      "the second call must have come from the cache, or this test proves nothing",
    );
  });

  // The proxy fences on the token's claim and handlers read the row, so a
  // session where the two disagree would be fenced by one and not the other.
  // getSession refuses it outright. The switch is on in each case, so a null
  // can only come from the cross-check and not from the switch.
  it("returns null when the row is demo but the token has no demo claim", async () => {
    process.env[SWITCH_VARIABLE] = "true";
    const id = freshId();
    mockFindUnique.mock.mockImplementation(async () => rowFor(id, { demoAccount: "student" }));
    sessionCookieValue = signToken(id, "student", 1);

    assert.equal(await getSession(), null);
  });

  it("returns null when the token claims demo but the row is not demo", async () => {
    process.env[SWITCH_VARIABLE] = "true";
    const id = freshId();
    mockFindUnique.mock.mockImplementation(async () => rowFor(id));
    sessionCookieValue = signToken(id, "student", 1, { demo: "student" });

    assert.equal(await getSession(), null);
  });

  it("returns null when the claim and the row name different demo kinds", async () => {
    process.env[SWITCH_VARIABLE] = "true";
    const id = freshId();
    mockFindUnique.mock.mockImplementation(async () =>
      rowFor(id, { demoAccount: "instructor", role: "teacher" }),
    );
    sessionCookieValue = signToken(id, "teacher", 1, { demo: "student" });

    assert.equal(await getSession(), null);
  });

  it("selects demoAccount from the database row", async () => {
    const id = freshId();
    mockFindUnique.mock.mockImplementation(async () => rowFor(id));
    sessionCookieValue = signToken(id, "student", 1);

    await getSession();

    const args = mockFindUnique.mock.calls[0]?.arguments[0] as {
      select?: Record<string, boolean>;
    };
    assert.equal(args.select?.demoAccount, true);
  });
});

describe("setSessionCookie and the demo marker", () => {
  it("signs the demo kind into the cookie it sets", async () => {
    const token = await setSessionCookie("s1", "teacher", 2, { demo: "instructor" });

    const [name, value] = mockCookieSet.mock.calls[0]?.arguments as [string, string];
    assert.equal(name, "vq-session");
    assert.equal(value, token);
    assert.equal(verifyToken(value)?.demo, "instructor");
  });

  it("signs no demo claim into the cookie of a real account", async () => {
    const token = await setSessionCookie("s1", "student", 2);

    const claims = verifyToken(token);
    assert.ok(claims);
    assert.equal("demo" in claims, false);
    // The raw payload, not just the verified shape, must carry no demo key.
    const raw = jwt.decode(token) as Record<string, unknown>;
    assert.equal("demo" in raw, false);
  });
});
