import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateConfigChange } from "./admin-tools";

describe("validateConfigChange", () => {
  it("accepts valid provider values and rejects others", () => {
    assert.deepEqual(validateConfigChange("ai_provider", "cloud"), { value: "cloud" });
    assert.deepEqual(validateConfigChange("ai_provider", "local"), { value: "local" });
    assert.ok("error" in validateConfigChange("ai_provider", "openai"));
  });

  it("validates auth mode against the allowed set", () => {
    assert.deepEqual(validateConfigChange("ai_provider_auth_mode", "bearer"), { value: "bearer" });
    assert.ok("error" in validateConfigChange("ai_provider_auth_mode", "basic"));
  });

  it("bounds num_ctx and coerces to an integer string", () => {
    assert.deepEqual(validateConfigChange("ai_provider_num_ctx", "8192"), { value: "8192" });
    assert.ok("error" in validateConfigChange("ai_provider_num_ctx", "100")); // below floor
    assert.ok("error" in validateConfigChange("ai_provider_num_ctx", "999999")); // above ceiling
    assert.ok("error" in validateConfigChange("ai_provider_num_ctx", "abc"));
  });

  it("rejects an empty or overlong model name", () => {
    assert.ok("value" in validateConfigChange("ai_provider_model", "gemma3:12b"));
    assert.ok("error" in validateConfigChange("ai_provider_model", ""));
    assert.ok("error" in validateConfigChange("ai_provider_model", "x".repeat(201)));
  });

  it("REFUSES secret keys outright — secrets never flow through chat", () => {
    for (const secret of [
      "gemini_api_key",
      "ai_provider_api_key",
      "ai_provider_cloudflare_access_client_secret",
    ]) {
      const r = validateConfigChange(secret, "super-secret-value");
      assert.ok("error" in r, `${secret} must be refused`);
      assert.match(r.error, /Program Setup|never through Sage/i);
    }
  });

  it("refuses an unknown key", () => {
    assert.ok("error" in validateConfigChange("delete_everything", "yes"));
  });
});
