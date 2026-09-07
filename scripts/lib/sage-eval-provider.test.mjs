import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readDeidentifyNames, describeDeidentify, wrapWithDeidentification } from "./sage-eval-provider.mjs";

/**
 * AC5 — the eval harness must be able to measure the SHIPPED configuration.
 *
 * Production wraps every cloud `student_record` call in the de-identification
 * decorator, so an eval run against a raw provider measures a prompt no
 * student will ever produce. `--deidentify=Sam,Ms. Lee` puts the same
 * decorator in front of the eval's provider, and the label records it so a
 * run's provenance says which arm it was.
 */

describe("readDeidentifyNames", () => {
  it("returns null when the flag is absent — the default arm is unwrapped", () => {
    assert.equal(readDeidentifyNames(["--provider=gemini"]), null);
  });

  it("splits on commas and trims", () => {
    assert.deepEqual(readDeidentifyNames(["--deidentify=Sam, Ms. Lee"]), ["Sam", "Ms. Lee"]);
  });

  it("throws on an empty flag rather than silently running the unwrapped arm", () => {
    assert.throws(() => readDeidentifyNames(["--deidentify="]), /no names/i);
    assert.throws(() => readDeidentifyNames(["--deidentify=,, "]), /no names/i);
  });
});

describe("describeDeidentify", () => {
  it("names the arm in the label so a run's provenance shows it", () => {
    assert.equal(describeDeidentify(["Sam", "Ms. Lee"]), "deidentify(Sam, Ms. Lee)");
    assert.equal(describeDeidentify(null), "");
  });
});

describe("wrapWithDeidentification", () => {
  const fake = {
    name: "fake",
    lastSystemPrompt: null,
    async generateResponse(systemPrompt) {
      this.lastSystemPrompt = systemPrompt;
      return "Hi [STUDENT_NAME], ask [TEACHER_NAME_1].";
    },
    async *streamResponse() {
      yield "";
    },
    async generateStructuredResponse() {
      return "{}";
    },
  };

  it("returns the provider untouched when no names are given", async () => {
    assert.equal(await wrapWithDeidentification(fake, null), fake);
  });

  it("pseudonymises the first name as the student and the rest as staff", async () => {
    const wrapped = await wrapWithDeidentification(fake, ["Sam", "Ms. Lee"]);
    const reply = await wrapped.generateResponse("You are coaching Sam. Their teacher is Ms. Lee.", []);
    assert.equal(fake.lastSystemPrompt, "You are coaching [STUDENT_NAME]. Their teacher is [TEACHER_NAME_1].");
    assert.equal(reply, "Hi Sam, ask Ms. Lee.");
  });
});
