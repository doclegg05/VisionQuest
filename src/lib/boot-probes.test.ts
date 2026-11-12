/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding stands in for functions with several different signatures. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

// Student counts the demo-separation probe asks for. The probe passes a
// `where` with `demoAccount: null` (unmarked student accounts) or
// `demoAccount: { not: null }` (demo rows); the mock answers from these two.
const studentCounts = { demo: 0, unmarked: 0 };
const studentCount = mock.fn(async (args: { where: { demoAccount: unknown } }) =>
  args.where.demoAccount === null ? studentCounts.unmarked : studentCounts.demo,
) as any;

mock.module("@/lib/db", {
  namedExports: { prismaAdmin: { student: { count: studentCount } } },
});

let probes: Awaited<typeof import("./boot-probes")>;

before(async () => {
  probes = await import("./boot-probes");
});

const ENV_KEYS = [
  "NODE_ENV",
  "RLS_CONTEXT_INJECTION",
  "ADMIN_DATABASE_URL",
  "JWT_SECRET",
  "COHORT_DEMO_MODE",
  "REAL_STUDENT_DATA",
  "VQ_MAC_RELAY_ENABLED",
  "COHORT_DEMO_LOCAL_ONLY",
  "AI_LOCAL_ONLY",
  "AI_CLOUD_INFERENCE",
] as const;
const saved: Record<string, string | undefined> = {};

function setEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

/**
 * Everything a healthy production box has set. Since H4 that includes a
 * stated choice about cloud AI: the plain local only switch is on and no other
 * switch the check reads is set, so each test starts from one known state.
 */
function healthyProduction() {
  setEnv({
    VQ_MAC_RELAY_ENABLED: undefined,
    COHORT_DEMO_LOCAL_ONLY: undefined,
    AI_LOCAL_ONLY: "true",
    AI_CLOUD_INFERENCE: undefined,
  });
  setEnv({
    NODE_ENV: "production",
    RLS_CONTEXT_INJECTION: "true",
    ADMIN_DATABASE_URL: "postgresql://postgres:pw@db.example:5432/postgres",
    JWT_SECRET: "x".repeat(48),
    COHORT_DEMO_MODE: undefined,
    REAL_STUDENT_DATA: undefined,
  });
}

beforeEach(() => {
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  loggerError.mock.resetCalls();
  loggerInfo.mock.resetCalls();
  adminPrivileged.mock.resetCalls();
  adminPrivileged.mock.mockImplementation(async () => true);
  studentCounts.demo = 0;
  studentCounts.unmarked = 0;
  studentCount.mock.resetCalls();
  studentCount.mock.mockImplementation(async (args: { where: { demoAccount: unknown } }) =>
    args.where.demoAccount === null ? studentCounts.unmarked : studentCounts.demo,
  );
});

/** Lets a fire-and-forget probe finish its awaits before the test reads the log. */
async function settle() {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
}

function errorNames(): string[] {
  return loggerError.mock.calls.map((c: { arguments: [string] }) => c.arguments[0]);
}

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

// ---------------------------------------------------------------------------
// H2: demo and real students can never coexist.
//
// Cohort demo mode lets anyone with the link sign in without a password. Once
// real students exist (REAL_STUDENT_DATA=true), turning it back on would open
// their records to anyone with the link. Only the environment may stop the
// boot; a database finding only raises an alarm, because the live demo
// database holds mock students that may not all carry the demoAccount mark.
// ---------------------------------------------------------------------------

describe("demo mode against REAL_STUDENT_DATA (config probe)", () => {
  const combinations = [
    { demo: undefined, real: undefined, fails: false },
    { demo: "true", real: undefined, fails: false },
    { demo: undefined, real: "true", fails: false },
    { demo: "true", real: "true", fails: true },
    { demo: "false", real: "true", fails: false },
    { demo: "true", real: "false", fails: false },
  ] as const;

  for (const { demo, real, fails } of combinations) {
    it(`COHORT_DEMO_MODE=${JSON.stringify(demo)} REAL_STUDENT_DATA=${JSON.stringify(real)} ${fails ? "fails" : "passes"}`, () => {
      setEnv({ COHORT_DEMO_MODE: demo, REAL_STUDENT_DATA: real });
      const result = probes.demoAgainstRealDataProbe();
      if (fails) {
        assert.notEqual(result, null);
        assert.match(result ?? "", /COHORT_DEMO_MODE/);
        assert.match(result ?? "", /REAL_STUDENT_DATA/);
      } else {
        assert.equal(result, null);
      }
    });
  }

  it("treats REAL_STUDENT_DATA as on only for the exact string 'true'", () => {
    setEnv({ COHORT_DEMO_MODE: "true" });
    for (const value of ["TRUE", "1", "yes", " true"]) {
      setEnv({ REAL_STUDENT_DATA: value });
      assert.equal(probes.demoAgainstRealDataProbe(), null, JSON.stringify(value));
    }
  });

  it("reads demo mode the way the app does (trimmed, any case)", () => {
    setEnv({ COHORT_DEMO_MODE: " TRUE ", REAL_STUDENT_DATA: "true" });
    assert.notEqual(probes.demoAgainstRealDataProbe(), null);
  });

  it("stops a production start when both are on, naming both variables", async () => {
    healthyProduction();
    setEnv({ COHORT_DEMO_MODE: "true", REAL_STUDENT_DATA: "true" });
    await assert.rejects(
      () => probes.runBootProbes(),
      (err: Error) => {
        assert.match(err.message, /COHORT_DEMO_MODE/);
        assert.match(err.message, /REAL_STUDENT_DATA/);
        return true;
      },
    );
  });

  for (const [demo, real] of [
    [undefined, undefined],
    ["true", undefined],
    [undefined, "true"],
  ] as const) {
    it(`lets production start with COHORT_DEMO_MODE=${JSON.stringify(demo)} REAL_STUDENT_DATA=${JSON.stringify(real)}`, async () => {
      healthyProduction();
      setEnv({ COHORT_DEMO_MODE: demo, REAL_STUDENT_DATA: real });
      await probes.runBootProbes();
    });
  }

  it("only logs outside production when both are on", async () => {
    healthyProduction();
    setEnv({ NODE_ENV: "development", COHORT_DEMO_MODE: "true", REAL_STUDENT_DATA: "true" });
    await probes.runBootProbes();
    const text = JSON.stringify(loggerError.mock.calls.map((c: { arguments: unknown[] }) => c.arguments));
    assert.ok(text.includes("REAL_STUDENT_DATA"), "the failure is logged");
  });
});

describe("demo data separation (database probe, alarms only)", () => {
  it("alarms when demo mode is off and demo rows remain", async () => {
    setEnv({ COHORT_DEMO_MODE: undefined, REAL_STUDENT_DATA: undefined });
    studentCounts.demo = 7;
    await probes.demoDataSeparationProbe();
    const call = loggerError.mock.calls.find(
      (c: { arguments: [string] }) => c.arguments[0] === "boot_probe_demo_closeout_unfinished",
    );
    assert.ok(call, `saw ${JSON.stringify(errorNames())}`);
    assert.equal(call.arguments[1].demoAccounts, 7);
  });

  it("alarms with the count when demo mode is on and unmarked student accounts exist", async () => {
    setEnv({ COHORT_DEMO_MODE: "true", REAL_STUDENT_DATA: undefined });
    studentCounts.unmarked = 3;
    await probes.demoDataSeparationProbe();
    const call = loggerError.mock.calls.find(
      (c: { arguments: [string] }) => c.arguments[0] === "boot_probe_demo_open_with_unmarked_students",
    );
    assert.ok(call, `saw ${JSON.stringify(errorNames())}`);
    assert.equal(call.arguments[1].unmarkedStudents, 3);
    const where = studentCount.mock.calls
      .map((c: { arguments: [{ where: Record<string, unknown> }] }) => c.arguments[0].where)
      .find((w: Record<string, unknown>) => w.demoAccount === null);
    assert.deepEqual(where, { role: "student", demoAccount: null });
  });

  it("alarms when REAL_STUDENT_DATA is on and demo rows remain", async () => {
    setEnv({ COHORT_DEMO_MODE: undefined, REAL_STUDENT_DATA: "true" });
    studentCounts.demo = 2;
    await probes.demoDataSeparationProbe();
    const call = loggerError.mock.calls.find(
      (c: { arguments: [string] }) => c.arguments[0] === "boot_probe_demo_rows_beside_real_data",
    );
    assert.ok(call, `saw ${JSON.stringify(errorNames())}`);
    assert.equal(call.arguments[1].demoAccounts, 2);
  });

  it("raises no alarm when the database matches the switches", async () => {
    for (const [demo, real] of [
      [undefined, undefined],
      ["true", undefined],
      [undefined, "true"],
    ] as const) {
      setEnv({ COHORT_DEMO_MODE: demo, REAL_STUDENT_DATA: real });
      // Demo on: only demo rows exist. Demo off: nothing marked remains.
      studentCounts.demo = demo === "true" ? 5 : 0;
      studentCounts.unmarked = demo === "true" ? 0 : 4;
      await probes.demoDataSeparationProbe();
    }
    assert.equal(loggerError.mock.callCount(), 0, `saw ${JSON.stringify(errorNames())}`);
  });

  it("logs counts only, never a name or id", async () => {
    setEnv({ COHORT_DEMO_MODE: "true", REAL_STUDENT_DATA: "true" });
    studentCounts.demo = 1;
    studentCounts.unmarked = 1;
    await probes.demoDataSeparationProbe();
    for (const call of loggerError.mock.calls as Array<{ arguments: [string, Record<string, unknown>] }>) {
      for (const value of Object.values(call.arguments[1] ?? {})) {
        assert.equal(typeof value === "number" || typeof value === "string", true);
      }
      assert.deepEqual(
        Object.keys(call.arguments[1] ?? {}).filter((k) => !["demoAccounts", "unmarkedStudents", "reason"].includes(k)),
        [],
      );
    }
  });

  it("logs a failed query and does not throw", async () => {
    setEnv({ COHORT_DEMO_MODE: "true", REAL_STUDENT_DATA: undefined });
    studentCount.mock.mockImplementation(async () => {
      throw new Error("connect ECONNREFUSED");
    });
    await probes.demoDataSeparationProbe();
    assert.ok(errorNames().includes("boot_probe_demo_data_failed"), `saw ${JSON.stringify(errorNames())}`);
  });

  it("runs from runBootProbes and never stops a production start", async () => {
    healthyProduction();
    setEnv({ COHORT_DEMO_MODE: "true" });
    studentCounts.unmarked = 9;
    await probes.runBootProbes();
    await settle();
    assert.ok(errorNames().includes("boot_probe_demo_open_with_unmarked_students"), `saw ${JSON.stringify(errorNames())}`);

    loggerError.mock.resetCalls();
    studentCount.mock.mockImplementation(async () => {
      throw new Error("connect ECONNREFUSED");
    });
    await probes.runBootProbes();
    await settle();
    assert.ok(errorNames().includes("boot_probe_demo_data_failed"));
  });
});

// ---------------------------------------------------------------------------
// H4: the block on cloud AI is explicit.
//
// The owner's standing decision is that no student data goes to a cloud model.
// That block rested on three switches named for the demo and the relay. Delete
// them when the demo closes, or recreate the service from the blueprint, and
// cloud inference came back with no error. Production now refuses to start
// unless the deployment says which it is: local only, or cloud allowed on
// purpose. Saying both, saying neither and a misspelled value all refuse.
// ---------------------------------------------------------------------------

const LOCAL_ONLY_SWITCHES = [
  "COHORT_DEMO_MODE",
  "VQ_MAC_RELAY_ENABLED",
  "COHORT_DEMO_LOCAL_ONLY",
  "AI_LOCAL_ONLY",
] as const;
type LocalOnlySwitch = (typeof LOCAL_ONLY_SWITCHES)[number];

/** Clears every variable the check reads, then turns on the switches named. */
function setAiChoice(on: readonly LocalOnlySwitch[], cloud?: string) {
  setEnv({
    COHORT_DEMO_MODE: undefined,
    VQ_MAC_RELAY_ENABLED: undefined,
    COHORT_DEMO_LOCAL_ONLY: undefined,
    AI_LOCAL_ONLY: undefined,
    AI_CLOUD_INFERENCE: cloud,
  });
  for (const name of on) process.env[name] = "true";
}

/** What Render carries today (docs/runbooks/mac-sage-connection.md): demo mode on, behind the relay. */
const TODAYS_PRODUCTION: readonly LocalOnlySwitch[] = [
  "COHORT_DEMO_MODE",
  "VQ_MAC_RELAY_ENABLED",
  "COHORT_DEMO_LOCAL_ONLY",
];

describe("cloud AI choice (config probe): every combination of the switches", () => {
  const subsets = Array.from({ length: 2 ** LOCAL_ONLY_SWITCHES.length }, (_, mask) =>
    LOCAL_ONLY_SWITCHES.filter((_name, bit) => (mask >> bit) & 1),
  );

  for (const on of subsets) {
    for (const cloud of [undefined, "allowed", "alowed"] as const) {
      // The rule, stated once: exactly one of the two answers, and nothing misspelled.
      const passes = cloud !== "alowed" && (on.length > 0) !== (cloud === "allowed");
      const label = `${on.join(" + ") || "no switch"}, AI_CLOUD_INFERENCE=${JSON.stringify(cloud)}`;
      it(`${passes ? "passes" : "refuses"}: ${label}`, () => {
        setAiChoice(on, cloud);
        if (passes) assert.equal(probes.cloudAiChoiceProbe(), null);
        else assert.notEqual(probes.cloudAiChoiceProbe(), null);
      });
    }
  }
});

describe("cloud AI choice (config probe): the cases that matter", () => {
  it("passes for production as it runs today", () => {
    setAiChoice(TODAYS_PRODUCTION);
    assert.equal(probes.cloudAiChoiceProbe(), null);
  });

  it("passes with the demo closed and only the plain switch on", () => {
    setAiChoice(["AI_LOCAL_ONLY"]);
    assert.equal(probes.cloudAiChoiceProbe(), null);
  });

  it("refuses when nothing is set, and names both ways to choose", () => {
    setAiChoice([]);
    const result = probes.cloudAiChoiceProbe() ?? "";
    assert.match(result, /AI_LOCAL_ONLY/);
    assert.match(result, /AI_CLOUD_INFERENCE/);
  });

  it("follows the demo closeout: the block holds until the last switch is deleted, then the start is refused", () => {
    setAiChoice(TODAYS_PRODUCTION);
    setEnv({ COHORT_DEMO_MODE: undefined });
    assert.equal(probes.cloudAiChoiceProbe(), null, "relay and fence still on");
    setEnv({ COHORT_DEMO_LOCAL_ONLY: undefined });
    assert.equal(probes.cloudAiChoiceProbe(), null, "relay still on");
    setEnv({ VQ_MAC_RELAY_ENABLED: undefined });
    assert.notEqual(probes.cloudAiChoiceProbe(), null, "nothing left: this is the day cloud AI used to open silently");
  });

  it("passes when cloud AI is allowed on purpose and no switch is on", () => {
    setAiChoice([], "allowed");
    assert.equal(probes.cloudAiChoiceProbe(), null);
  });

  it("refuses every AI_CLOUD_INFERENCE value except the exact word, with or without a switch on", () => {
    const misspelled = [
      "alowed", "Allowed", "ALLOWED", " allowed", "allowed ", "allow", "true", "yes", "on", "1",
      "permissive", "cloud", "false", "blocked",
    ];
    for (const value of misspelled) {
      for (const on of [[], ["AI_LOCAL_ONLY"], TODAYS_PRODUCTION] as const) {
        setAiChoice(on, value);
        const result = probes.cloudAiChoiceProbe();
        assert.notEqual(result, null, `${JSON.stringify(value)} beside [${on.join(", ")}]`);
        assert.match(result ?? "", /AI_CLOUD_INFERENCE/);
      }
    }
  });

  it("reads a blank AI_CLOUD_INFERENCE as unset, never as a choice", () => {
    for (const blank of ["", "   "]) {
      setAiChoice(["AI_LOCAL_ONLY"], blank);
      assert.equal(probes.cloudAiChoiceProbe(), null, JSON.stringify(blank));
      setAiChoice([], blank);
      assert.notEqual(probes.cloudAiChoiceProbe(), null, JSON.stringify(blank));
    }
  });

  it("refuses when both answers are given, though the switch wins at run time", () => {
    for (const name of LOCAL_ONLY_SWITCHES) {
      setAiChoice([name], "allowed");
      const result = probes.cloudAiChoiceProbe() ?? "";
      assert.match(result, /AI_CLOUD_INFERENCE/, name);
      assert.match(result, new RegExp(name), `the message names ${name}`);
    }
  });

  it("refuses a misspelled AI_LOCAL_ONLY, even beside another switch or beside 'allowed'", () => {
    for (const value of ["ture", "1", "yes", "on", "enabled"]) {
      setAiChoice(["COHORT_DEMO_MODE"]);
      setEnv({ AI_LOCAL_ONLY: value });
      assert.match(probes.cloudAiChoiceProbe() ?? "", /AI_LOCAL_ONLY/, `${value} beside demo mode`);

      setAiChoice([], "allowed");
      setEnv({ AI_LOCAL_ONLY: value });
      assert.match(probes.cloudAiChoiceProbe() ?? "", /AI_LOCAL_ONLY/, `${value} beside allowed`);
    }
  });

  it("reads AI_LOCAL_ONLY the way the block does: 'true' is on, 'false' and blank are off", () => {
    for (const value of ["true", " TRUE ", "True"]) {
      setAiChoice([]);
      setEnv({ AI_LOCAL_ONLY: value });
      assert.equal(probes.cloudAiChoiceProbe(), null, JSON.stringify(value));
    }
    for (const value of ["false", " FALSE ", "", "  "]) {
      setAiChoice([]);
      setEnv({ AI_LOCAL_ONLY: value });
      assert.notEqual(probes.cloudAiChoiceProbe(), null, `${JSON.stringify(value)} alone chooses nothing`);

      setAiChoice([], "allowed");
      setEnv({ AI_LOCAL_ONLY: value });
      assert.equal(probes.cloudAiChoiceProbe(), null, `${JSON.stringify(value)} beside allowed`);
    }
  });

  it("never repeats a value it read", () => {
    setAiChoice([], "alowed-typo-xyz");
    assert.equal((probes.cloudAiChoiceProbe() ?? "").includes("alowed-typo-xyz"), false);
    setAiChoice(["COHORT_DEMO_MODE"]);
    setEnv({ AI_LOCAL_ONLY: "ture-typo-xyz" });
    assert.equal((probes.cloudAiChoiceProbe() ?? "").includes("ture-typo-xyz"), false);
  });
});

describe("cloud AI choice stops or allows a production start", () => {
  for (const [label, on, cloud] of [
    ["today's production settings", TODAYS_PRODUCTION, undefined],
    ["demo mode on and nothing else", ["COHORT_DEMO_MODE"], undefined],
    ["the demo closed and the plain switch on", ["AI_LOCAL_ONLY"], undefined],
    ["cloud AI allowed on purpose", [], "allowed"],
  ] as const) {
    it(`starts with ${label}`, async () => {
      healthyProduction();
      setAiChoice(on, cloud);
      await probes.runBootProbes();
      await settle();
      assert.deepEqual(errorNames(), []);
    });
  }

  for (const [label, on, cloud] of [
    ["nothing set", [], undefined],
    ["a misspelled AI_CLOUD_INFERENCE", [], "alowed"],
    ["a misspelled AI_CLOUD_INFERENCE beside today's production settings", TODAYS_PRODUCTION, "permissive"],
    ["both answers given", ["AI_LOCAL_ONLY"], "allowed"],
  ] as const) {
    it(`refuses to start with ${label}`, async () => {
      healthyProduction();
      setAiChoice(on, cloud);
      await assert.rejects(
        () => probes.runBootProbes(),
        (err: Error) => {
          assert.match(err.message, /Boot probe failure \(1\)/, "this check and no other");
          assert.match(err.message, /AI_CLOUD_INFERENCE/);
          return true;
        },
      );
    });
  }

  it("only logs outside production when nothing is set", async () => {
    healthyProduction();
    setEnv({ NODE_ENV: "development" });
    setAiChoice([]);
    await probes.runBootProbes();
    const failed = loggerError.mock.calls.filter(
      (c: { arguments: [string] }) => c.arguments[0] === "boot_probe_failed",
    );
    assert.equal(failed.length, 1);
    assert.match(JSON.stringify(failed[0].arguments), /AI_LOCAL_ONLY/);
  });
});

// A service recreated from render.yaml gets the values the file states and
// nothing else. Those values alone must pass the check with the block on, and
// the relay tokens must be listed without a value.
describe("the Render blueprint states the choice", () => {
  const blueprint = readFileSync(new URL("../../render.yaml", import.meta.url), "utf8");

  /** Each `- key:` entry and the one property line under it, as the file writes them. */
  function blueprintEntries(): Map<string, { property: string; value: string }> {
    const entries = new Map<string, { property: string; value: string }>();
    const pattern = /^ *- key: (\S+)\n *(value|sync|generateValue): (.*)$/gm;
    for (const [, key, property, raw] of blueprint.matchAll(pattern)) {
      entries.set(key, { property, value: raw.trim().replace(/^"(.*)"$/, "$1") });
    }
    return entries;
  }

  it("a service made from the blueprint alone passes the check, with cloud AI blocked", () => {
    const entries = blueprintEntries();
    setAiChoice([]);
    for (const name of [...LOCAL_ONLY_SWITCHES, "AI_CLOUD_INFERENCE"] as const) {
      const entry = entries.get(name);
      if (entry?.property === "value") process.env[name] = entry.value;
    }
    assert.equal(probes.cloudAiChoiceProbe(), null);
    assert.deepEqual(entries.get("AI_LOCAL_ONLY"), { property: "value", value: "true" });
    assert.equal(entries.has("AI_CLOUD_INFERENCE"), false, "the blueprint must not allow cloud AI");
    assert.equal(entries.has("COHORT_DEMO_MODE"), false, "the blueprint must not turn demo sign-in on");
  });

  it("lists what the relay needs, and no token value", () => {
    const entries = blueprintEntries();
    for (const secret of ["VQ_MAC_RELAY_AGENT_TOKEN", "VQ_MAC_RELAY_APP_TOKEN"]) {
      assert.deepEqual(entries.get(secret), { property: "sync", value: "false" }, secret);
    }
    assert.ok(entries.has("VQ_MAC_RELAY_ENABLED"), "the relay switch is listed");
    assert.deepEqual(entries.get("AI_LOCAL_APPROVED_ORIGIN"), {
      property: "value",
      value: "http://127.0.0.1:11437",
    });
  });

  // Production depends on the app's pool size, and the file did not say so.
  // It is listed for the owner to set once the app and the database share a
  // region, so the file carries no number and the default in code stays.
  it("lists the app's connection pool size, and no value for it", () => {
    assert.deepEqual(blueprintEntries().get("DB_POOL_SIZE"), { property: "sync", value: "false" });
    assert.doesNotMatch(blueprint, /DB_POOL_SIZE\s*\n\s*value:/, "no number in the blueprint");
  });
});
