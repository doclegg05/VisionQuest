/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding must accept many signatures */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { $Enums } from "@prisma/client";
import type { DemoAccountKind } from "./config";

const mockWarn = mock.fn() as any;

mock.module("@/lib/logger", {
  namedExports: {
    logger: {
      debug: mock.fn(),
      info: mock.fn(),
      get warn() {
        return mockWarn;
      },
      error: mock.fn(),
    },
  },
});

let config: typeof import("./config");

before(async () => {
  config = await import("./config");
});

beforeEach(() => {
  mockWarn.mock.resetCalls();
});

describe("isCohortDemoEnabled", () => {
  it("turns on only for true, ignoring case and spaces", () => {
    for (const v of ["true", "TRUE", " True "]) {
      assert.equal(config.isCohortDemoEnabled({ COHORT_DEMO_MODE: v }), true);
    }
    for (const v of [undefined, "", "1", "yes", "false"]) {
      assert.equal(config.isCohortDemoEnabled({ COHORT_DEMO_MODE: v }), false);
    }
  });

  it("is off when the variable is missing from the environment", () => {
    assert.equal(config.isCohortDemoEnabled({}), false);
  });
});

describe("getDemoLimits", () => {
  it("uses the spec defaults", () => {
    assert.deepEqual(config.getDemoLimits({}), {
      perNetworkHourly: 10,
      siteHourly: 40,
      siteDaily: 200,
      sageDaily: 2000,
      instructorSageHourly: 300,
      instructorSageDaily: 1000,
    });
  });

  it("reads overrides and falls back on junk, never below 1", () => {
    assert.equal(config.getDemoLimits({ COHORT_DEMO_STUDENTS_PER_DAY: "500" }).siteDaily, 500);
    for (const v of ["abc", "0", "-5", "2.5", ""]) {
      assert.equal(config.getDemoLimits({ COHORT_DEMO_STUDENTS_PER_HOUR: v }).siteHourly, 40);
    }
    assert.equal(config.getDemoLimits({ COHORT_DEMO_SAGE_PER_DAY: "abc" }).sageDaily, 2000);
  });

  it("reads each of the three overrides into its own limit", () => {
    const limits = config.getDemoLimits({
      COHORT_DEMO_STUDENTS_PER_HOUR: "7",
      COHORT_DEMO_STUDENTS_PER_DAY: "70",
      COHORT_DEMO_SAGE_PER_DAY: "700",
    });
    assert.equal(limits.siteHourly, 7);
    assert.equal(limits.siteDaily, 70);
    assert.equal(limits.sageDaily, 700);
    assert.equal(limits.perNetworkHourly, 10);
    assert.equal(limits.instructorSageHourly, 300);
    assert.equal(limits.instructorSageDaily, 1000);
  });

  it("accepts a padded whole number and rejects a number with a suffix", () => {
    assert.equal(config.getDemoLimits({ COHORT_DEMO_STUDENTS_PER_DAY: " 25 " }).siteDaily, 25);
    assert.equal(config.getDemoLimits({ COHORT_DEMO_STUDENTS_PER_DAY: "25abc" }).siteDaily, 200);
    assert.equal(config.getDemoLimits({ COHORT_DEMO_STUDENTS_PER_DAY: "1e3" }).siteDaily, 200);
  });

  it("falls back for a number too large to count exactly", () => {
    const huge = "9".repeat(30);
    assert.equal(config.getDemoLimits({ COHORT_DEMO_STUDENTS_PER_DAY: huge }).siteDaily, 200);
  });

  it("warns once per rejected override, naming the variable and not its value", () => {
    const limits = config.getDemoLimits({ COHORT_DEMO_STUDENTS_PER_HOUR: "abc" });
    assert.equal(limits.siteHourly, 40);
    assert.equal(mockWarn.mock.callCount(), 1);
    const [message, context] = mockWarn.mock.calls[0].arguments as [string, Record<string, unknown>];
    assert.match(message, /demo/i);
    assert.equal(context.variable, "COHORT_DEMO_STUDENTS_PER_HOUR");
    assert.ok(!JSON.stringify(mockWarn.mock.calls[0].arguments).includes("abc"));
  });

  it("stays quiet when an override is unset or blank", () => {
    config.getDemoLimits({});
    config.getDemoLimits({ COHORT_DEMO_STUDENTS_PER_HOUR: "" });
    config.getDemoLimits({ COHORT_DEMO_STUDENTS_PER_HOUR: "   " });
    config.getDemoLimits({ COHORT_DEMO_STUDENTS_PER_DAY: "500" });
    assert.equal(mockWarn.mock.callCount(), 0);
  });

  it("never throws on a bad override", () => {
    assert.doesNotThrow(() =>
      config.getDemoLimits({
        COHORT_DEMO_STUDENTS_PER_HOUR: "NaN",
        COHORT_DEMO_STUDENTS_PER_DAY: "-1",
        COHORT_DEMO_SAGE_PER_DAY: "Infinity",
      }),
    );
  });
});

describe("DEMO_ACCOUNT_KINDS", () => {
  it("matches the Prisma enum", () => {
    const prismaKinds: DemoAccountKind[] = Object.values($Enums.DemoAccountKind);
    assert.deepEqual([...prismaKinds].sort(), [...config.DEMO_ACCOUNT_KINDS].sort());
  });
});

describe("demo identity constants", () => {
  it("name the shared instructor and class", () => {
    assert.equal(config.DEMO_INSTRUCTOR_LOGIN, "demo-instructor");
    assert.equal(config.DEMO_INSTRUCTOR_NAME, "Demo Instructor");
    assert.equal(config.DEMO_CLASS_CODE, "cohort-demo");
    assert.equal(config.DEMO_CLASS_NAME, "Cohort Demo Class");
  });

  it("keeps the starter prefix inside the visitor prefix", () => {
    assert.equal(config.DEMO_STUDENT_LOGIN_PREFIX, "demo-");
    assert.equal(config.DEMO_STARTER_LOGIN_PREFIX, "demo-starter-");
    assert.ok(config.DEMO_STARTER_LOGIN_PREFIX.startsWith(config.DEMO_STUDENT_LOGIN_PREFIX));
  });
});
