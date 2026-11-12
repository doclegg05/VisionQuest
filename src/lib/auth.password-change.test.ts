import assert from "node:assert/strict";
import { afterEach, before, beforeEach, describe, it, mock } from "node:test";
import jwt from "jsonwebtoken";

// The forced password change, on the session side.
//
// setSessionCookie() must be told whether the session is held to the change
// screen, so the compiler finds every place that signs someone in. And
// getSession() ends any session whose token and account row disagree about
// it. src/proxy.ts enforces the token's claim with no database, so the two
// must agree in both directions:
//   - a token signed before the claim existed, for an account that must
//     change its password, is no session;
//   - a token that still says "must change" after the account no longer does
//     is no session either.

const TEST_JWT_SECRET = "test-secret-for-auth-password-change-suite";
const PASSWORD_HASH = "scrypt$test-salt$test-hash";

interface StudentRow {
  id: string;
  studentId: string;
  displayName: string;
  role: string;
  sessionVersion: number;
  isActive: boolean;
  demoAccount: "student" | "instructor" | null;
  mustChangePassword: boolean;
  passwordHash: string | null;
}

interface CookieOptions {
  httpOnly?: boolean;
  sameSite?: string;
  path?: string;
}

const mockFindUnique = mock.fn<(args: { select: Record<string, boolean> }) => Promise<StudentRow | null>>(async () => null);
const cookieSets: { name: string; value: string; options: CookieOptions }[] = [];
/** Every value getSession() hands the session cache. */
const cachedValues: unknown[] = [];

let sessionCookieValue: string | undefined;

mock.module("next/headers", {
  exports: {
    cookies: async () => ({
      get: (name: string) =>
        name === "vq-session" && sessionCookieValue !== undefined ? { name, value: sessionCookieValue } : undefined,
      set: (name: string, value: string, options: CookieOptions) => {
        cookieSets.push({ name, value, options });
      },
    }),
  },
});

mock.module("./db", {
  exports: {
    prisma: {},
    prismaAdmin: { student: { findUnique: mockFindUnique }, sageConfirmationUse: { findUnique: async () => null } },
  },
});

// A pass-through cache that keeps what it was given, so a test can read what
// would have been stored. Nothing is reused between calls.
mock.module("./cache", {
  exports: {
    cached: async (_key: string, _ttl: number, load: () => Promise<unknown>) => {
      const value = await load();
      cachedValues.push(value);
      return value;
    },
    invalidatePrefix: () => undefined,
  },
});

let getSession: typeof import("./auth").getSession;
let setSessionCookie: typeof import("./auth").setSessionCookie;
let signToken: typeof import("./auth").signToken;
let verifyToken: typeof import("./auth").verifyToken;

let originalSecret: string | undefined;

function row(overrides: Partial<StudentRow> = {}): StudentRow {
  return {
    id: "stu-1",
    studentId: "learner",
    displayName: "Some Person",
    role: "student",
    sessionVersion: 2,
    isActive: true,
    demoAccount: null,
    mustChangePassword: false,
    passwordHash: PASSWORD_HASH,
    ...overrides,
  };
}

/** A token as this code signed it before the claim existed: no key at all. */
function tokenFromBeforeTheClaim(): string {
  return jwt.sign({ sub: "stu-1", role: "student", sv: 2 }, TEST_JWT_SECRET, { expiresIn: "7d", algorithm: "HS256" });
}

before(async () => {
  originalSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  ({ getSession, setSessionCookie, signToken, verifyToken } = await import("./auth"));
});

beforeEach(() => {
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  delete process.env.COHORT_DEMO_MODE;
  mockFindUnique.mock.resetCalls();
  cookieSets.length = 0;
  cachedValues.length = 0;
  sessionCookieValue = undefined;
});

afterEach(() => {
  if (originalSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalSecret;
  delete process.env.COHORT_DEMO_MODE;
});

describe("setSessionCookie and the password-change claim", () => {
  it("signs the claim into the cookie when the session must change its password", async () => {
    await setSessionCookie("stu-1", "student", 2, { mustChangePassword: true });

    assert.equal(cookieSets.length, 1);
    assert.equal(cookieSets[0]?.name, "vq-session");
    assert.equal(verifyToken(cookieSets[0]?.value ?? "")?.mustChangePassword, true);
  });

  it("signs no claim when there is nothing to change", async () => {
    await setSessionCookie("stu-1", "student", 2, { mustChangePassword: false });

    const claims = verifyToken(cookieSets[0]?.value ?? "");
    assert.ok(claims);
    assert.equal("mustChangePassword" in claims, false);
  });

  it("keeps the cookie's flags and the demo claim", async () => {
    await setSessionCookie("demo-1", "student", 0, { mustChangePassword: false, demo: "student" });

    assert.equal(cookieSets[0]?.options.httpOnly, true);
    assert.equal(cookieSets[0]?.options.sameSite, "strict");
    assert.equal(cookieSets[0]?.options.path, "/");
    assert.equal(verifyToken(cookieSets[0]?.value ?? "")?.demo, "student");
  });

  it("will not compile without the answer", () => {
    // Never run. The compiler checks each line: a call that leaves the
    // answer out must be an error, or a new sign-in path could forget it.
    const neverRun = async () => {
      // @ts-expect-error the options argument is required
      await setSessionCookie("stu-1", "student", 2);
      // @ts-expect-error mustChangePassword is required inside it
      await setSessionCookie("stu-1", "student", 2, {});
      // @ts-expect-error mustChangePassword is required beside demo
      await setSessionCookie("stu-1", "student", 2, { demo: "student" });
    };
    assert.equal(typeof neverRun, "function");
  });
});

describe("getSession and the password-change claim", () => {
  it("returns a held session, marked, when the token and the row agree", async () => {
    mockFindUnique.mock.mockImplementation(async () => row({ mustChangePassword: true }));
    sessionCookieValue = signToken("stu-1", "student", 2, { mustChangePassword: true });

    const session = await getSession();

    assert.deepEqual(session, {
      id: "stu-1",
      studentId: "learner",
      displayName: "Some Person",
      role: "student",
      mustChangePassword: true,
    });
  });

  it("returns an ordinary session with no such key when neither says so", async () => {
    mockFindUnique.mock.mockImplementation(async () => row());
    sessionCookieValue = signToken("stu-1", "student", 2, { mustChangePassword: false });

    const session = await getSession();

    assert.deepEqual(session, { id: "stu-1", studentId: "learner", displayName: "Some Person", role: "student" });
  });

  it("ends a session signed before the claim existed, for an account that must change its password", async () => {
    mockFindUnique.mock.mockImplementation(async () => row({ mustChangePassword: true }));
    sessionCookieValue = tokenFromBeforeTheClaim();

    assert.equal(await getSession(), null);
  });

  it("keeps a session signed before the claim existed, for an account with nothing to change", async () => {
    mockFindUnique.mock.mockImplementation(async () => row());
    sessionCookieValue = tokenFromBeforeTheClaim();

    assert.equal((await getSession())?.id, "stu-1");
  });

  it("ends a session whose token has no claim once the row says the password must change", async () => {
    mockFindUnique.mock.mockImplementation(async () => row({ mustChangePassword: true }));
    sessionCookieValue = signToken("stu-1", "student", 2, { mustChangePassword: false });

    assert.equal(await getSession(), null);
  });

  it("ends a session whose token still says must change after the row no longer does", async () => {
    mockFindUnique.mock.mockImplementation(async () => row({ mustChangePassword: false }));
    sessionCookieValue = signToken("stu-1", "student", 2, { mustChangePassword: true });

    assert.equal(await getSession(), null);
  });

  it("does not hold an account that has no password, whatever the flag says", async () => {
    mockFindUnique.mock.mockImplementation(async () => row({ mustChangePassword: true, passwordHash: null }));
    sessionCookieValue = signToken("stu-1", "student", 2, { mustChangePassword: false });

    const session = await getSession();

    assert.ok(session);
    assert.equal("mustChangePassword" in session, false);
  });

  it("does not hold staff or demo accounts, whatever the flag says", async () => {
    mockFindUnique.mock.mockImplementation(async () => row({ mustChangePassword: true, role: "teacher" }));
    sessionCookieValue = signToken("stu-1", "teacher", 2, { mustChangePassword: false });
    assert.equal((await getSession())?.role, "teacher");

    process.env.COHORT_DEMO_MODE = "true";
    mockFindUnique.mock.mockImplementation(async () => row({ mustChangePassword: true, demoAccount: "student" }));
    sessionCookieValue = signToken("stu-1", "student", 2, { mustChangePassword: false, demo: "student" });
    assert.equal((await getSession())?.demoAccount, "student");
  });

  it("reads the password hash to decide, and keeps it out of the session and the cache", async () => {
    mockFindUnique.mock.mockImplementation(async () => row({ mustChangePassword: true }));
    sessionCookieValue = signToken("stu-1", "student", 2, { mustChangePassword: true });

    const session = await getSession();

    assert.equal(mockFindUnique.mock.calls[0]?.arguments[0].select.passwordHash, true);
    // The revocation check caches its own answer too, so look for the account by shape.
    const cachedAccount = cachedValues.find(
      (value) => typeof value === "object" && value !== null && "studentId" in value,
    );
    assert.deepEqual(cachedAccount, {
      id: "stu-1",
      studentId: "learner",
      displayName: "Some Person",
      role: "student",
      sessionVersion: 2,
      isActive: true,
      demoAccount: null,
      mustChangePassword: true,
    });
    assert.equal(JSON.stringify(cachedValues).includes(PASSWORD_HASH), false, "the hash must not enter the cache");
    assert.equal(JSON.stringify(session).includes(PASSWORD_HASH), false, "the hash must not enter the session");
  });
});
