import assert from "node:assert/strict";
import { test } from "node:test";
import { withMacEvalPromptLayout } from "./sage-eval-prompt-layout.mjs";
test("Mac eval layout preserves appended context and passes the matching trusted boundary", async () => {
  const seen = [];
  const inner = Object.fromEntries(["generateResponse", "streamResponse", "generateStructuredResponse", "streamWithTools"].map(method => [method, (...args) => { seen.push(args); return "ok"; }]));
  const { provider, buildSystemPrompt } = withMacEvalPromptLayout(inner, (stage, context, tier) => {
    assert.equal(tier, "compact");
    return { text: `static ${context.name}`, systemPrefixLength: 6 };
  });
  const text = buildSystemPrompt("discovery", { name: "A" });
  for (const method of ["generateResponse", "streamResponse", "generateStructuredResponse"]) {
    provider[method](text + " appended", [], undefined, { temperature: 0 });
    assert.deepEqual(seen.at(-1)[3], { temperature: 0, systemPrefixLength: 6 });
  }
  provider.streamWithTools(text, [], [], () => {}, { maxHops: 2 });
  assert.deepEqual(seen.at(-1)[4], { maxHops: 2, systemPrefixLength: 6 });
  buildSystemPrompt("discovery", { name: "B" });
  assert.throws(() => provider.generateResponse(text, []), /not built/);
});
