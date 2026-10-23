import assert from "node:assert/strict";
import { it } from "node:test";
import { buildMacWarmupRequests } from "./mac-warmup";
import { buildCacheableSystemPrompt } from "./system-prompts";
it("prepares both demo roles with their real shared prefixes and divergent synthetic identities", () => {
  const requests = buildMacWarmupRequests();
  assert.equal(requests.length, 4);
  for (const [offset, stage] of [[0, "discovery"], [2, "teacher_assistant"]] as const) {
    const first = requests[offset], second = requests[offset + 1];
    const live = buildCacheableSystemPrompt(stage, { studentName: "New visitor", programType: "spokes" }, "compact");
    assert.equal(first.messages[0].content, live.text.slice(0, live.systemPrefixLength));
    assert.equal(first.messages[0].content, second.messages[0].content);
    assert.notEqual(first.messages[1].content, second.messages[1].content);
    assert.equal(first.stream, false); // preemptible by interactive requests
    assert.equal(first.keep_alive, "-1s");
    assert.equal(first.options.num_predict, 1);
    assert.ok(first.tools.length > 0);
    assert.equal(first.model, "gemma4:12b-mlx");
  }
});
