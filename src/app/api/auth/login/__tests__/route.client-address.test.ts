import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockRequest } from "@/lib/test-helpers";

// ---------------------------------------------------------------------------
// Sign-in: the address the network limit counts, and what a failed sign-in
// keeps (readiness A6)
//
// The per-network limit read the FIRST `X-Forwarded-For` hop, which the
// caller writes, so one machine could send a new address on every try and
// never reach the limit. It now counts the hop Render's proxy appended.
//
// A failed sign-in for a login that names no account wrote the typed text
// into the audit summary. People paste a password into the username box, so
// that row could hold a password. It now holds a keyed hash of the login.
// ---------------------------------------------------------------------------

process.env.JWT_SECRET = "test-secret-for-login-route-client-address";
delete process.env.TRUSTED_PROXY_HOPS;
delete process.env.CLOUDFLARE_IN_FRONT;

interface AuditInput {
  action: string;
  summary?: string;
  metadata?: Record<string, unknown>;
}

const limiterKeys: string[] = [];
const audits: AuditInput[] = [];
let accountExists = false;

const ACCOUNT = {
  id: "stu-1",
  studentId: "alice",
  displayName: "Alice",
  role: "student",
  passwordHash: "scrypt$abc$def",
  authProvider: "password",
  isActive: true,
  mfaEnabled: false,
  sessionVersion: 1,
  mustChangePassword: false,
  demoAccount: null,
};

mock.module("@/lib/auth", {
  namedExports: {
    verifyPasswordSafeWithStatus: () => ({ valid: false, needsRehash: false }),
    hashPassword: () => ({ hash: "scrypt$newhash$value", salt: "salt" }),
    normalizeStudentId: (raw: string) => raw.toLowerCase(),
    normalizeEmail: (raw: string) => raw.trim().toLowerCase(),
    sessionCachePrimer: () => () => undefined,
    setSessionCookie: async () => "fake-jwt-token",
    signMfaSessionToken: (id: string) => `mfa-token-for-${id}`,
    setMfaSessionCookie: async () => undefined,
  },
});

const fakeDb = {
  student: {
    findUnique: async () => (accountExists ? ACCOUNT : null),
    updateMany: async () => ({ count: 1 }),
  },
};
mock.module("@/lib/db", { namedExports: { prismaAdmin: fakeDb, prisma: fakeDb } });

mock.module("@/lib/rate-limit", {
  namedExports: {
    rateLimit: async (key: string) => {
      limiterKeys.push(key);
      return { success: true, remaining: 4, resetTime: Date.now() + 60_000, degraded: false };
    },
    refundRateLimit: async () => undefined,
  },
});

mock.module("@/lib/audit", {
  namedExports: {
    logAuditEvent: async (input: AuditInput) => {
      audits.push(input);
    },
  },
});

let loginRoute: Awaited<typeof import("../route")>;

before(async () => {
  loginRoute = await import("../route");
});

beforeEach(() => {
  limiterKeys.length = 0;
  audits.length = 0;
  accountExists = false;
});

async function signIn(login: string, forwardedFor: string | null): Promise<number> {
  const res = await loginRoute.POST(
    mockRequest("/api/auth/login", {
      method: "POST",
      body: { studentId: login, password: "wrong-password" },
      headers: forwardedFor === null ? {} : { "x-forwarded-for": forwardedFor },
    }) as never,
  );
  return res.status;
}

function networkKeys(): string[] {
  return limiterKeys.filter((key) => key.startsWith("login:") && !key.startsWith("login:unknown:") && !key.startsWith("login:user:"));
}

describe("POST /api/auth/login: the per-network limit counts the client Cloudflare forwarded to Render", () => {
  it("counts one address however the caller rotates a forged first hop", async () => {
    for (let i = 0; i < 5; i += 1) {
      assert.equal(await signIn("alice", `10.0.${i}.${i}, 198.51.100.4, 172.70.1.9`), 401);
    }

    assert.deepEqual([...new Set(networkKeys())], ["login:198.51.100.4"]);
    assert.equal(networkKeys().length, 5);
  });

  it("puts a request with no proxy header in the one shared bucket", async () => {
    assert.equal(await signIn("alice", null), 401);

    assert.deepEqual(networkKeys(), ["login:unknown"]);
  });

  it("records the counted address on the audit row, not the forged one", async () => {
    await signIn("alice", "6.6.6.6, 198.51.100.4, 172.70.1.9");

    assert.equal(audits.length, 1);
    assert.equal(audits[0]?.metadata?.ip, "198.51.100.4");
  });

  it("limits an IPv6 client by its /64 and records the full address on the audit row", async () => {
    await signIn("alice", "2001:db8:1:2:aaaa::7, 2400:cb00::1");
    await signIn("alice", "2001:db8:1:2:bbbb::8, 2400:cb00::1");

    assert.deepEqual([...new Set(networkKeys())], ["login:2001:db8:1:2::/64"]);
    assert.deepEqual(audits.map((row) => row.metadata?.ip), ["2001:db8:1:2:aaaa::7", "2001:db8:1:2:bbbb::8"]);
  });
});

describe("POST /api/auth/login: a failed sign-in keeps no typed text for a login with no account", () => {
  const PASTED_PASSWORD = "Hunter2-pasted-in-the-wrong-box";

  it("stores a hash of the typed login, never the text", async () => {
    await signIn(PASTED_PASSWORD, "198.51.100.4");

    assert.equal(audits.length, 1);
    const row = JSON.stringify(audits[0]);
    assert.ok(!row.toLowerCase().includes(PASTED_PASSWORD.toLowerCase()), "the typed text is not in the audit row");
    assert.match(String(audits[0]?.metadata?.loginHash), /^[0-9a-f]{16}$/);
  });

  it("gives the same login the same hash, so repeated tries can still be grouped", async () => {
    await signIn("Ghost-User", "198.51.100.4");
    await signIn("ghost-user", "198.51.100.4");

    assert.equal(audits.length, 2);
    assert.equal(audits[0]?.metadata?.loginHash, audits[1]?.metadata?.loginHash);
  });

  it("keeps a real account's login out of the summary: the target id already names the account (H15)", async () => {
    accountExists = true;

    await signIn("alice", "198.51.100.4");

    assert.equal(audits.length, 1);
    assert.doesNotMatch(String(audits[0]?.summary), /alice/);
    assert.equal(audits[0]?.metadata?.loginHash, undefined);
  });
});
