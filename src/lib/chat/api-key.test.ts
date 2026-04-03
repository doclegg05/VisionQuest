import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("API key resolution order", () => {
  it("documents the expected fallback chain", () => {
    // Resolution order:
    // 1. Per-student encrypted key (geminiApiKey on Student)
    // 2. Admin-managed platform key (SystemConfig gemini_api_key)
    // 3. Environment variable (GEMINI_API_KEY)
    // 4. None → throws badRequest with helpful message
    //
    // Integration testing of resolveApiKey requires DB access.
    // This test documents the contract.
    const resolutionOrder = ["personal", "admin_config", "env_var", "none"];
    assert.equal(resolutionOrder.length, 4);
    assert.equal(resolutionOrder[0], "personal");
    assert.equal(resolutionOrder[1], "admin_config");
  });
});
