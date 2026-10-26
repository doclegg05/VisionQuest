/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding stands in for functions with several different signatures. */
import assert from "node:assert/strict";
import { afterEach, before, beforeEach, describe, it, mock } from "node:test";

// ---------------------------------------------------------------------------
// Boot probes — 2026-09-06 hunt, follow-up (4), in the F63 shape.
//
// F63 named a class of bug rather than one bug: a security control whose
// "off" state is silent. `RLS_CONTEXT_INJECTION` unset makes the Prisma RLS
// extension a pass-through, so every policy-backed scope check — including
// assertStaffCanManageStudent — becomes a no-op and nothing anywhere says so.
// `ADMIN_DATABASE_URL` unset makes prismaAdmin the ordinary vq_app client, so
// cross-student reads return zero rows and writes are refused, again silently.
// The probes make the "off" state loud at boot instead of at the first
// incident.
// ---------------------------------------------------------------------------

const loggerError = mock.fn() as any;
const loggerInfo = mock.fn() as any;
const adminPrivileged = mock.fn(async () => true) as any;

mock.module("@/lib/logger", {
  namedExports: {
    logger: { debug: mock.fn(), info: loggerInfo, warn: mock.fn(), error: loggerError },
  },
});

mock.module("@/lib/nudges/admin-guard", {
  namedExports: {
    adminClientIsPrivileged: adminPrivileged,
    resetAdminClientProbe: () => {},
  },
});

let probes: Awaited<typeof import("./boot-probes")>;

before(async () => {
  probes = await import("./boot-probes");
});

const ENV_KEYS = ["NODE_ENV", "RLS_CONTEXT_INJECTION", "ADMIN_DATABASE_URL", "JWT_SECRET"] as const;
const saved: Record<string, string | undefined> = {};

function setEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

/** Everything a healthy production box has set. */
function healthyProduction() {
  setEnv({
    NODE_ENV: "production",
    RLS_CONTEXT_INJECTION: "true",
    ADMIN_DATABASE_URL: "postgresql://postgres:pw@db.example:5432/postgres",
    JWT_SECRET: "x".repeat(48),
  });
}

beforeEach(() => {
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  loggerError.mock.resetCalls();
  loggerInfo.mock.resetCalls();
  adminPrivileged.mock.resetCalls();
  adminPrivileged.mock.mockImplementation(async () => true);
});

afterEach(() => {
  for (const key of ENV_KEYS) setEnv({ [key]: saved[key] } as never);
});

describe("individual probes", () => {
  it("RLS_CONTEXT_INJECTION passes only on the literal string 'true'", () => {
    setEnv({ RLS_CONTEXT_INJECTION: "true" });
    assert.equal(probes.rlsContextInjectionProbe(), null);

    // The db.ts extension compares against "true" exactly, so anything else —
    // including the values an operator would reasonably expect to work — is
    // the OFF state and must read as a failure here too.
    for (const value of [undefined, "", "1", "TRUE", "yes", "false"]) {
      setEnv({ RLS_CONTEXT_INJECTION: value });
      assert.notEqual(
        probes.rlsContextInjectionProbe(),
        null,
        `RLS_CONTEXT_INJECTION=${JSON.stringify(value)} is not the on state`,
      );
    }
  });

  it("ADMIN_DATABASE_URL must be a non-empty value", () => {
    setEnv({ ADMIN_DATABASE_URL: "postgresql://postgres:pw@db.example:5432/postgres" });
    assert.equal(probes.adminDatabaseUrlProbe(), null);

    for (const value of [undefined, "", "   "]) {
      setEnv({ ADMIN_DATABASE_URL: value });
      assert.notEqual(probes.adminDatabaseUrlProbe(), null, JSON.stringify(value));
    }
  });

  it("JWT_SECRET must be present and at least 32 characters", () => {
    setEnv({ JWT_SECRET: "x".repeat(32) });
    assert.equal(probes.jwtSecretProbe(), null);

    setEnv({ JWT_SECRET: "x".repeat(31) });
    assert.notEqual(probes.jwtSecretProbe(), null, "31 characters is short");
    setEnv({ JWT_SECRET: undefined });
    assert.notEqual(probes.jwtSecretProbe(), null, "absent is a failure");
  });

  it("no probe reveals the value it checked", () => {
    setEnv({ JWT_SECRET: "hunter2-hunter2-hunter2", ADMIN_DATABASE_URL: "postgresql://postgres:s3cret@db/x" });
    const messages = [probes.jwtSecretProbe(), probes.adminDatabaseUrlProbe()].join(" ");
    assert.equal(messages.includes("hunter2"), false);
    assert.equal(messages.includes("s3cret"), false);
  });
});

describe("runBootProbes in production", () => {
  it("throws and names every failing probe when configuration is wrong", async () => {
    healthyProduction();
    setEnv({ RLS_CONTEXT_INJECTION: undefined, ADMIN_DATABASE_URL: undefined });

    await assert.rejects(
      () => probes.runBootProbes(),
      (err: Error) => {
        assert.match(err.message, /RLS_CONTEXT_INJECTION/);
        assert.match(err.message, /ADMIN_DATABASE_URL/);
        return true;
      },
    );
  });

  it("resolves quietly when everything is set", async () => {
    healthyProduction();
    await probes.runBootProbes();
    assert.equal(loggerError.mock.callCount(), 0);
  });

  it("does not let a database question stop the boot", async () => {
    // adminClientIsPrivileged returns false both for "ADMIN_DATABASE_URL points
    // at vq_app" and for "the database was unreachable just now". A fatal probe
    // that cannot tell those apart turns a blip into a container that will not
    // start and restarts straight back into the same failure. It alarms
    // instead — and it never blocks the boot, so it cannot add latency either.
    healthyProduction();
    adminPrivileged.mock.mockImplementation(async () => false);

    await probes.runBootProbes();
    await new Promise((resolve) => setImmediate(resolve));

    const names = loggerError.mock.calls.map((c: { arguments: [string] }) => c.arguments[0]);
    assert.ok(
      names.some((n: string) => /admin_client/.test(n)),
      `expected an alarm for the unprivileged admin client; saw ${JSON.stringify(names)}`,
    );
  });

  it("survives a probe that throws rather than returning false", async () => {
    healthyProduction();
    adminPrivileged.mock.mockImplementation(async () => {
      throw new Error("connect ECONNREFUSED");
    });

    await probes.runBootProbes();
    await new Promise((resolve) => setImmediate(resolve));
  });
});

describe("runBootProbes outside production", () => {
  it("logs an error for each failure and does not throw", async () => {
    setEnv({
      NODE_ENV: "development",
      RLS_CONTEXT_INJECTION: undefined,
      ADMIN_DATABASE_URL: undefined,
      JWT_SECRET: "short",
    });

    await probes.runBootProbes();

    assert.ok(loggerError.mock.callCount() >= 3, `one line per failing probe; got ${loggerError.mock.callCount()}`);
    const text = JSON.stringify(loggerError.mock.calls.map((c: { arguments: unknown[] }) => c.arguments));
    for (const key of ["RLS_CONTEXT_INJECTION", "ADMIN_DATABASE_URL", "JWT_SECRET"]) {
      assert.ok(text.includes(key), `${key} must be named in the log`);
    }
  });
});
