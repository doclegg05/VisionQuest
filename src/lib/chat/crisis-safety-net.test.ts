import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ensureCrisisResources, CRISIS_RESOURCE_BLOCK } from "./crisis-safety-net";

describe("ensureCrisisResources", () => {
  it("appends the crisis block when the detector matches and the reply lacks 988", () => {
    const result = ensureCrisisResources(
      "I hear you, that sounds really hard.",
      "I just want to end it all",
    );
    assert.equal(result, CRISIS_RESOURCE_BLOCK);
    assert.match(result ?? "", /988/);
  });

  it("returns null when the reply already contains 988", () => {
    const result = ensureCrisisResources(
      "That sounds really hard. Please call or text 988 right now — you matter.",
      "I just want to end it all",
    );
    assert.equal(result, null);
  });

  it("returns null when the detector does not match the incoming message", () => {
    const result = ensureCrisisResources(
      "Great question — let's break that certification down into steps.",
      "How do I finish my OSHA 10 certification?",
    );
    assert.equal(result, null);
  });

  it("matches on the incoming user message, not the reply text", () => {
    // Reply text alone should never trigger the net — only the student's message does.
    const result = ensureCrisisResources(
      "Some replies might discuss dying to a hobby idiom but that's not a crisis signal.",
      "I'm dying to see my certificate results",
    );
    assert.equal(result, null);
  });

  it("is idempotent-safe: a reply with an existing 988 mention embedded mid-sentence is not duplicated", () => {
    const result = ensureCrisisResources(
      "You can always call or text 988 if things feel unbearable.",
      "sometimes I think about killing myself",
    );
    assert.equal(result, null);
  });
});
