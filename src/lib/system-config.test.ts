import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SYSTEM_CONFIG_KEYS, isValidConfigKey } from "./system-config";

describe("SYSTEM_CONFIG_KEYS", () => {
  it("includes gemini_api_key", () => {
    assert.ok(SYSTEM_CONFIG_KEYS.includes("gemini_api_key"));
  });
});

describe("isValidConfigKey", () => {
  it("accepts known keys", () => {
    assert.ok(isValidConfigKey("gemini_api_key"));
  });

  it("rejects unknown keys", () => {
    assert.ok(!isValidConfigKey("unknown_key"));
    assert.ok(!isValidConfigKey(""));
  });
});
