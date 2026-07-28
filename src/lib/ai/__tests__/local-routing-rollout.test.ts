import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import {
  activateLocalTaskRouting,
  LocalRoutingActivationError,
} from "../local-routing-rollout";

const input = {
  actorId: "synthetic-admin",
  defaultModel: "gemma4:12b",
  speedModel: "qwen3.5:9b",
  qualityModel: "gemma4:26b",
  enabled: true,
} as const;

describe("local task routing activation", () => {
  it("makes no configuration write when inventory validation fails", async () => {
    const persist = mock.fn(async () => undefined);

    await assert.rejects(
      activateLocalTaskRouting(input, {
        inspectInventory: async () => ({
          healthy: true,
          chatValidated: true,
          models: ["gemma4:12b", "qwen3.5:9b"],
        }),
        persist,
      }),
      (error: unknown) =>
        error instanceof LocalRoutingActivationError &&
        /missing required model gemma4:26b/i.test(error.message),
    );
    assert.equal(persist.mock.callCount(), 0);
  });

  it("hands all configuration keys to one audited persistence operation", async () => {
    const persist = mock.fn(async () => undefined);

    const result = await activateLocalTaskRouting(input, {
      inspectInventory: async () => ({
        healthy: true,
        chatValidated: true,
        models: ["gemma4:12b", "qwen3.5:9b", "gemma4:26b"],
      }),
      persist,
    });

    assert.equal(result.enabled, true);
    assert.equal(persist.mock.callCount(), 1);
    const persisted = persist.mock.calls[0].arguments[0];
    assert.equal(persisted.actorId, "synthetic-admin");
    assert.deepEqual(persisted.values, [
      ["ai_local_model_default", "gemma4:12b"],
      ["ai_local_model_default_available", "true"],
      ["ai_local_model_speed", "qwen3.5:9b"],
      ["ai_local_model_speed_available", "true"],
      ["ai_local_model_quality", "gemma4:26b"],
      ["ai_local_model_quality_available", "true"],
      ["ai_local_task_routing_enabled", "true"],
    ]);
  });
});
