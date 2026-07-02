import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentTool } from "./types";
import { validateToolArgs } from "./validation";

const sampleTool: AgentTool = {
  name: "sample_tool",
  description: "Test tool",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string" },
      limit: { type: "integer" },
      resourceId: { type: "string", enum: ["goals", "portfolio"] },
      tags: { type: "array", items: { type: "string" } },
    },
    required: ["query"],
  },
  requiredRoles: ["student"],
  riskTier: "read",
  enabled: true,
  async execute() {
    return { status: "success", summary: "ok" };
  },
};

describe("validateToolArgs", () => {
  it("accepts arguments that match the declared tool schema", () => {
    const result = validateToolArgs(sampleTool, {
      query: "resume",
      limit: 3,
      resourceId: "portfolio",
      tags: ["career", "proof"],
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.args, {
        query: "resume",
        limit: 3,
        resourceId: "portfolio",
        tags: ["career", "proof"],
      });
    }
  });

  it("rejects non-object arguments before tool execution", () => {
    const result = validateToolArgs(sampleTool, null);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /must be a JSON object/);
    }
  });

  it("rejects undeclared arguments instead of silently passing them through", () => {
    const result = validateToolArgs(sampleTool, {
      query: "resume",
      adminOverride: true,
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /Unsupported argument "adminOverride"/);
    }
  });

  it("rejects missing required arguments", () => {
    const result = validateToolArgs(sampleTool, { limit: 3 });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /Missing required argument "query"/);
    }
  });

  it("rejects invalid primitive and enum values", () => {
    const badInteger = validateToolArgs(sampleTool, {
      query: "resume",
      limit: "3",
    });
    const badEnum = validateToolArgs(sampleTool, {
      query: "resume",
      resourceId: "settings",
    });

    assert.equal(badInteger.ok, false);
    assert.equal(badEnum.ok, false);
    if (!badInteger.ok) assert.match(badInteger.error, /limit must be an integer/);
    if (!badEnum.ok) assert.match(badEnum.error, /resourceId must be one of/);
  });

  it("validates nested array items", () => {
    const result = validateToolArgs(sampleTool, {
      query: "resume",
      tags: ["ok", 123],
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /tags\[1\] must be a string/);
    }
  });
});
