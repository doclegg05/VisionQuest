import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it, mock } from "node:test";

// Review F19 / SEC-07 (2026-09-01): VISIONQUEST_DISABLE_RATE_LIMITS switched
// off the chat caps in every environment and was undocumented. The predicate
// under test is the single reader of that variable; both call sites (the chat
// send route and the crisis-record cap) go through it.

const mockLoggerWarn = mock.fn();
mock.module("@/lib/logger", {
  namedExports: {
    logger: { debug: mock.fn(), info: mock.fn(), warn: mockLoggerWarn, error: mock.fn() },
  },
});

let rateLimitsDisabled: typeof import("./rate-limit-switch").rateLimitsDisabled;

const previousFlag = process.env.VISIONQUEST_DISABLE_RATE_LIMITS;
const previousNodeEnv = process.env.NODE_ENV;

/** Indexed by a string variable: Next's types mark NODE_ENV itself read-only. */
function setEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

before(async () => {
  ({ rateLimitsDisabled } = await import("./rate-limit-switch"));
});

after(() => {
  setEnv("VISIONQUEST_DISABLE_RATE_LIMITS", previousFlag);
  setEnv("NODE_ENV", previousNodeEnv);
});

describe("rateLimitsDisabled", () => {
  beforeEach(() => {
    mockLoggerWarn.mock.resetCalls();
    delete process.env.VISIONQUEST_DISABLE_RATE_LIMITS;
    setEnv("NODE_ENV", undefined);
  });

  it("is false when the variable is unset", () => {
    assert.equal(rateLimitsDisabled(), false);
    assert.equal(mockLoggerWarn.mock.callCount(), 0);
  });

  it("accepts only the exact string 'true'", () => {
    process.env.VISIONQUEST_DISABLE_RATE_LIMITS = "1";
    assert.equal(rateLimitsDisabled(), false);
    process.env.VISIONQUEST_DISABLE_RATE_LIMITS = "TRUE";
    assert.equal(rateLimitsDisabled(), false);
  });

  it("is true outside production when set to 'true'", () => {
    process.env.VISIONQUEST_DISABLE_RATE_LIMITS = "true";
    assert.equal(rateLimitsDisabled(), true);
    setEnv("NODE_ENV", "development");
    assert.equal(rateLimitsDisabled(), true);
    setEnv("NODE_ENV", "test");
    assert.equal(rateLimitsDisabled(), true);
    assert.equal(mockLoggerWarn.mock.callCount(), 0);
  });

  // Last on purpose: the once-only warning is module state.
  it("is ignored in production and warns once, not on every call", () => {
    process.env.VISIONQUEST_DISABLE_RATE_LIMITS = "true";
    setEnv("NODE_ENV", "production");
    assert.equal(rateLimitsDisabled(), false);
    assert.equal(rateLimitsDisabled(), false);
    assert.equal(rateLimitsDisabled(), false);
    assert.equal(mockLoggerWarn.mock.callCount(), 1);
    const [message] = mockLoggerWarn.mock.calls[0].arguments as [string];
    assert.match(message, /VISIONQUEST_DISABLE_RATE_LIMITS/);
    assert.match(message, /ignored/);
  });
});
