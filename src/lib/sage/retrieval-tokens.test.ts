import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { expandOnboardingPaperworkQuery } from "./retrieval-tokens";

describe("onboarding paperwork retrieval", () => {
  for (const question of [
    "What papers I gotta sign when I first start?",
    "I'm new here. What forms do I fill out?",
    "Before my first class, what do I sign?",
    "What paperwork do I need when joining SPOKES?",
  ]) {
    it(`finds the orientation reference for: ${question}`, () => {
      const expanded = expandOnboardingPaperworkQuery(question);
      assert.ok(expanded.startsWith(question));
      assert.match(expanded, /orientation onboarding checklist/);
    });
  }
  for (const question of [
    "Where do I sign in each day?",
    "How do I sign in to my new account?",
    "What papers do I sign on my first day at a new job?",
    "What paperwork do I need to start work with my employer?",
    "What time is my first class?",
    "Where is my attendance contract?",
  ]) {
    it(`preserves other questions: ${question}`, () => {
      assert.equal(expandOnboardingPaperworkQuery(question), question);
    });
  }
});
