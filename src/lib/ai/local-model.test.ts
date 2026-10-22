import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { pinnedLocalModel, usesMacPromptCache } from "./local-model";
const original = { ...process.env };
afterEach(() => { process.env = { ...original }; });
test("only explicit dedicated-relay MLX selection enables cache layout", () => {
  delete process.env.VQ_MAC_RELAY_ENABLED;
  process.env.VQ_MAC_RELAY_MODEL = "gemma4:12b-mlx";
  assert.equal(pinnedLocalModel(), "gemma4:12b");
  assert.equal(usesMacPromptCache(), false);
  process.env.VQ_MAC_RELAY_ENABLED = "true";
  assert.equal(pinnedLocalModel(), "gemma4:12b-mlx");
  assert.equal(usesMacPromptCache(), true);
  delete process.env.VQ_MAC_RELAY_MODEL;
  assert.equal(pinnedLocalModel(), "gemma4:12b");
  assert.equal(usesMacPromptCache(), false);
  for (const model of ["gemma4:26b", "gemma4:12b-cloud", "arbitrary"]) {
    process.env.VQ_MAC_RELAY_MODEL = model;
    assert.throws(pinnedLocalModel, /Unsupported/);
  }
});
