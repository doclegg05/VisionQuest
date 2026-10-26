import assert from "node:assert/strict";
import { it } from "node:test";
import { buildMacWarmupRequests } from "./mac-warmup";
import { buildCacheableSystemPrompt } from "./system-prompts";
it("prepares both demo roles with their real shared prefixes without dynamic context", () => {
  const requests = buildMacWarmupRequests();
  assert.equal(requests.length, 2);
  for (const [offset, stage] of [[0, "discovery"], [1, "teacher_assistant"]] as const) {
    const first = requests[offset];
    const live = buildCacheableSystemPrompt(stage, { studentName: "New visitor", programType: "spokes" }, "compact");
    assert.equal(first.messages[0].content, live.text.slice(0, live.systemPrefixLength));
    assert.equal(first.messages.length, 1);
    assert.equal(first.messages[0].role, "system");
    assert.equal(first.stream, false); // preemptible by interactive requests
    assert.equal(first.keep_alive, "-1s");
    assert.equal(first.options.num_predict, 1);
    assert.ok(first.tools.length > 0);
    assert.equal(first.model, "gemma4:12b-mlx");
  }
});
