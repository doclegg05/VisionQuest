import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { prepareRetry, resolveStreamOutcome, resolveSendError, SageSendError } from "./send-outcome";
import { SAGE_FAILURE_CODES, sageFailureMessage } from "./sage-failure";

describe("resolveStreamOutcome", () => {
  it("offers retry and a plain-language fallback when the stream produced zero content", () => {
    const outcome = resolveStreamOutcome(true, "");
    assert.equal(outcome.offerRetry, true);
    assert.equal(outcome.content, "Sage did not send an answer. Your message was not lost. Tap Try again.");
  });

  it("offers retry on zero content even when the stream never reported done", () => {
    const outcome = resolveStreamOutcome(false, "");
    assert.equal(outcome.offerRetry, true);
    assert.equal(outcome.content, "Sage did not send an answer. Your message was not lost. Tap Try again.");
  });

  it("offers retry and marks partial content as possibly incomplete when the stream did not finish", () => {
    const outcome = resolveStreamOutcome(false, "Here's what I found so far");
    assert.equal(outcome.offerRetry, true);
    assert.equal(outcome.content, "Here's what I found so far\n\n(Sage got cut off. Tap Try again for the full answer.)");
  });

  it("does not offer retry when the stream completed with content", () => {
    const outcome = resolveStreamOutcome(true, "All done!");
    assert.equal(outcome.offerRetry, false);
    assert.equal(outcome.content, "All done!");
  });
});

describe("resolveSendError", () => {
  const CRISIS_BLOCK = "\n\nIf you are in crisis, call or text 988.";

  it("shows the server's sentence once and offers Try again", () => {
    const text = sageFailureMessage("busy", { audience: "student", messageSaved: true });
    const outcome = resolveSendError(new SageSendError(text, "busy"), "", "student");
    assert.equal(outcome.displayContent, text);
    assert.equal(outcome.failure, "busy");
    assert.equal(outcome.offerRetry, true);
  });

  it("does not offer retry when the error interrupted a reply that already had content", () => {
    const outcome = resolveSendError(new SageSendError("Sage is off right now.", "off"), "partial reply text", "student");
    assert.equal(outcome.offerRetry, false);
  });

  for (const code of SAGE_FAILURE_CODES) {
    it(`keeps the server's 988 block for a student on ${code}`, () => {
      const text = sageFailureMessage(code, { audience: "student", messageSaved: true }) + CRISIS_BLOCK;
      const outcome = resolveSendError(new SageSendError(text, code), "", "student");
      assert.equal(outcome.displayContent, text);
    });
  }

  it("never gives a student API-key instructions or a Settings link", () => {
    const text = sageFailureMessage("not_set_up", { audience: "student", messageSaved: false });
    const outcome = resolveSendError(new SageSendError(text, "not_set_up"), "", "student");
    assert.doesNotMatch(outcome.displayContent, /API|key|Settings/i);
    assert.equal(outcome.showSettingsLink, false);
  });

  it("keeps the Settings link for staff when Sage is not set up", () => {
    const text = sageFailureMessage("not_set_up", { audience: "staff", messageSaved: false });
    const outcome = resolveSendError(new SageSendError(text, "not_set_up"), "", "staff");
    assert.equal(outcome.showSettingsLink, true);
    assert.equal(outcome.displayContent, text);
  });

  it("shows other server sentences as written, such as a rate limit", () => {
    const outcome = resolveSendError(
      new SageSendError("Too many messages this hour. Please wait before sending more.", null),
      "",
      "student",
    );
    assert.equal(outcome.displayContent, "Too many messages this hour. Please wait before sending more.");
    assert.equal(outcome.showSettingsLink, false);
  });

  it("hides a browser's own error text behind the safe sentence", () => {
    for (const err of [new TypeError("Failed to fetch"), "boom", undefined]) {
      const outcome = resolveSendError(err, "", "student");
      assert.equal(
        outcome.displayContent,
        sageFailureMessage("unknown", { audience: "student", messageSaved: false }),
      );
      assert.equal(outcome.failure, "unknown");
      assert.equal(outcome.offerRetry, true);
    }
  });
});

describe("prepareRetry", () => {
  const messages = [
    { id: "u0", role: "user" as const, content: "first" },
    { id: "a0", role: "assistant" as const, content: "reply" },
    { id: "u1", role: "user" as const, content: "second" },
    { id: "err-1", role: "assistant" as const, content: "Sage is off right now." },
  ];

  it("removes the failure and the message it answered, so a retry adds each once", () => {
    const prepared = prepareRetry(messages, "err-1");
    assert.deepEqual(prepared, { messages: messages.slice(0, 2), text: "second" });
  });

  it("does not change the list it was given", () => {
    const copy = messages.map((message) => ({ ...message }));
    prepareRetry(messages, "err-1");
    assert.deepEqual(messages, copy);
  });

  it("returns null when the failed message or its question is gone", () => {
    assert.equal(prepareRetry(messages, "missing"), null);
    assert.equal(prepareRetry([{ id: "err-1", role: "assistant", content: "x" }], "err-1"), null);
  });
});
