import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-32-chars-minimum-ok!!";

// Capture every call the module makes into the shared rate-limit store so we
// can assert WHICH helper (daily vs hourly) and WHICH limit each tier uses,
// without touching the database.
interface DailyCall {
  key: string;
  limit: number;
}
interface WindowCall {
  key: string;
  limit: number;
  windowMs: number;
}
const dailyCalls: DailyCall[] = [];
const windowCalls: WindowCall[] = [];
let nextSuccess = true;

mock.module("@/lib/rate-limit", {
  namedExports: {
    rateLimitDaily: async (key: string, limit: number) => {
      dailyCalls.push({ key, limit });
      return { success: nextSuccess, remaining: nextSuccess ? limit - 1 : 0, resetTime: 1_000 };
    },
    rateLimit: async (key: string, limit: number, windowMs: number) => {
      windowCalls.push({ key, limit, windowMs });
      return { success: nextSuccess, remaining: nextSuccess ? limit - 1 : 0, resetTime: 2_000 };
    },
  },
});

let checkToolRateLimit: typeof import("./rate-limit").checkToolRateLimit;

before(async () => {
  ({ checkToolRateLimit } = await import("./rate-limit"));
});

beforeEach(() => {
  dailyCalls.length = 0;
  windowCalls.length = 0;
  nextSuccess = true;
  delete process.env.SAGE_TOOL_RATE_CONSEQUENTIAL;
  delete process.env.SAGE_TOOL_RATE_REVERSIBLE;
  delete process.env.SAGE_TOOL_RATE_READ;
});

describe("checkToolRateLimit — window + default limits per tier", () => {
  it("consequential → daily window, default 5, namespaced key", async () => {
    const d = await checkToolRateLimit("stu-1", "book_appointment", "mutate_consequential");
    assert.equal(windowCalls.length, 0);
    assert.equal(dailyCalls.length, 1);
    assert.equal(dailyCalls[0].limit, 5);
    assert.equal(dailyCalls[0].key, "sage-tool:day:stu-1:book_appointment");
    assert.equal(d.allowed, true);
    assert.equal(d.window, "day");
    assert.equal(d.limit, 5);
  });

  it("reversible → daily window, default 20", async () => {
    await checkToolRateLimit("stu-1", "save_job", "mutate_reversible");
    assert.equal(dailyCalls.length, 1);
    assert.equal(dailyCalls[0].limit, 20);
    assert.equal(dailyCalls[0].key, "sage-tool:day:stu-1:save_job");
  });

  it("read → hourly window (3_600_000ms), default 200", async () => {
    const d = await checkToolRateLimit("stu-1", "present_form", "read");
    assert.equal(dailyCalls.length, 0);
    assert.equal(windowCalls.length, 1);
    assert.equal(windowCalls[0].limit, 200);
    assert.equal(windowCalls[0].windowMs, 60 * 60 * 1000);
    assert.equal(windowCalls[0].key, "sage-tool:hour:stu-1:present_form");
    assert.equal(d.window, "hour");
  });

  it("blocks when the underlying store denies", async () => {
    nextSuccess = false;
    const d = await checkToolRateLimit("stu-1", "book_appointment", "mutate_consequential");
    assert.equal(d.allowed, false);
    assert.equal(d.remaining, 0);
  });
});

describe("checkToolRateLimit — env overrides", () => {
  it("honors SAGE_TOOL_RATE_CONSEQUENTIAL", async () => {
    process.env.SAGE_TOOL_RATE_CONSEQUENTIAL = "3";
    await checkToolRateLimit("stu-1", "book_appointment", "mutate_consequential");
    assert.equal(dailyCalls[0].limit, 3);
  });

  it("honors SAGE_TOOL_RATE_READ", async () => {
    process.env.SAGE_TOOL_RATE_READ = "50";
    await checkToolRateLimit("stu-1", "present_form", "read");
    assert.equal(windowCalls[0].limit, 50);
  });

  it("ignores a non-positive / non-numeric override and keeps the default", async () => {
    process.env.SAGE_TOOL_RATE_REVERSIBLE = "-4";
    await checkToolRateLimit("stu-1", "save_job", "mutate_reversible");
    assert.equal(dailyCalls[0].limit, 20);

    dailyCalls.length = 0;
    process.env.SAGE_TOOL_RATE_REVERSIBLE = "abc";
    await checkToolRateLimit("stu-1", "save_job", "mutate_reversible");
    assert.equal(dailyCalls[0].limit, 20);
  });
});
