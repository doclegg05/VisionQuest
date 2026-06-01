import assert from "node:assert/strict";
import test from "node:test";
import { detectCrisisSignal } from "./crisis-detection";

// ---------------------------------------------------------------------------
// Positive cases — must be caught (favor recall for safety)
// ---------------------------------------------------------------------------

const SHOULD_MATCH: { text: string; category: string }[] = [
  { text: "honestly I just want to kill myself", category: "self_harm" },
  { text: "sometimes I think about killing myself", category: "self_harm" },
  { text: "I want to end my life", category: "self_harm" },
  { text: "I'm done, I want to end it all", category: "self_harm" },
  { text: "I've been having suicidal thoughts", category: "self_harm" },
  { text: "maybe suicide is the only way out", category: "self_harm" },
  { text: "I just want to die", category: "self_harm" },
  { text: "I wish I was dead", category: "self_harm" },
  { text: "everyone would be better off dead without me", category: "self_harm" },
  { text: "there's no reason to live anymore", category: "self_harm" },
  { text: "I don't want to live like this", category: "self_harm" },
  { text: "I can't go on", category: "self_harm" },
  { text: "I've been cutting myself again", category: "self_harm" },
  { text: "I want to hurt myself", category: "self_harm" },
  { text: "I keep thinking about self-harm", category: "self_harm" },
  { text: "I want to hurt someone", category: "harm_others" },
  { text: "I'm going to kill him", category: "harm_others" },
  { text: "my boyfriend hits me at home", category: "abuse" },
  { text: "I think I'm being abused", category: "abuse" },
];

for (const { text, category } of SHOULD_MATCH) {
  test(`detectCrisisSignal flags: "${text}"`, () => {
    const result = detectCrisisSignal(text);
    assert.equal(result.matched, true, `expected a match for: ${text}`);
    assert.equal(result.category, category);
  });
}

// ---------------------------------------------------------------------------
// Negative cases — must NOT false-positive on common idioms
// ---------------------------------------------------------------------------

const SHOULD_NOT_MATCH = [
  "I'm dying to see my certificate results",
  "this is a killer deal on the course",
  "I'm dead tired after that shift",
  "my goal is to live a better life",
  "I want to live in a bigger city someday",
  "that test almost killed me lol",
  "I need to cut my spending this month",
  "I want to hurt my chances? no, I want to improve them",
  "",
  "I'm feeling great today, ready to go",
];

for (const text of SHOULD_NOT_MATCH) {
  test(`detectCrisisSignal ignores: "${text}"`, () => {
    const result = detectCrisisSignal(text);
    assert.equal(result.matched, false, `unexpected match for: ${text}`);
    assert.equal(result.category, null);
  });
}

test("detectCrisisSignal is case-insensitive", () => {
  assert.equal(detectCrisisSignal("I WANT TO KILL MYSELF").matched, true);
});

test("detectCrisisSignal handles non-string input safely", () => {
  // @ts-expect-error — intentionally passing a non-string to verify the guard
  assert.equal(detectCrisisSignal(null).matched, false);
  // @ts-expect-error — intentionally passing a non-string to verify the guard
  assert.equal(detectCrisisSignal(undefined).matched, false);
});
