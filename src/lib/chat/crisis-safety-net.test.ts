import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ensureCrisisResources,
  CRISIS_RESOURCE_BLOCK,
  CRISIS_RESOURCE_BLOCK_ES,
} from "./crisis-safety-net";

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

describe("ensureCrisisResources — Spanish localization", () => {
  // Detection is bilingual, so the student-facing resource block must be too:
  // a Spanish-speaking student in crisis must not receive English-only
  // instructions. The block still carries the literal "988" (the deterministic
  // marker the evals and the reply-dedupe check assert on) and "instructor"
  // (asserted via mustMention in the crisis-spanish-* redteam fixtures).
  it("appends a Spanish-language block when the crisis signal matched a Spanish pattern", () => {
    const result = ensureCrisisResources(
      "Entiendo, eso suena muy difícil.",
      "ya no aguanto, me quiero morir",
    );
    assert.ok(result, "a Spanish crisis message must trigger the safety net");
    assert.match(result, /988/, "the deterministic 988 marker must survive localization");
    assert.match(result, /español/i, "the block must carry Spanish-language access instructions");
    assert.match(result, /instructor/i, "redteam fixtures assert 'instructor' via mustMention");
    assert.notEqual(
      result,
      CRISIS_RESOURCE_BLOCK,
      "a Spanish-speaking student must not receive the English-only block",
    );
    assert.equal(result, CRISIS_RESOURCE_BLOCK_ES);
  });

  it("keeps the eval-fixture contract in both blocks: '988' and 'instructor' substrings", () => {
    // The reply-dedupe marker is /988/ and the crisis-spanish-* redteam cases
    // assert mustMention ["988", "instructor"] — any future copy edit to
    // either block must preserve both substrings.
    for (const block of [CRISIS_RESOURCE_BLOCK, CRISIS_RESOURCE_BLOCK_ES]) {
      assert.match(block, /988/);
      assert.match(block, /instructor/i);
    }
  });

  it("covers the Spanish method-adjacent disclosure end to end", () => {
    const result = ensureCrisisResources(
      "Cuéntame más sobre tu día.",
      "esta noche me tomo todas las pastillas",
    );
    assert.ok(result, "a Spanish method-adjacent disclosure must trigger the safety net");
    assert.match(result, /988/);
    assert.match(result, /español/i);
  });

  it("still suppresses the append when the reply already carries 988 (Spanish trigger)", () => {
    const result = ensureCrisisResources(
      "Por favor llama o envía un mensaje de texto al 988 ahora mismo — tú importas.",
      "me quiero morir",
    );
    assert.equal(result, null);
  });

  it("keeps the English block for an English-pattern match even in mixed-language text", () => {
    // Deterministic tie-break: patterns are scanned in order and the English
    // families come first — a student who wrote the crisis phrase itself in
    // English gets the English resources.
    const result = ensureCrisisResources(
      "I hear you.",
      "estoy muy cansado de todo, i want to end it all",
    );
    assert.equal(result, CRISIS_RESOURCE_BLOCK);
  });
});
