import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { resolveStreamOutcome, resolveSendError } from "./send-outcome";

describe("resolveStreamOutcome", () => {
  it("offers retry and a plain-language fallback when the stream produced zero content", () => {
    const outcome = resolveStreamOutcome(true, "");
    assert.equal(outcome.offerRetry, true);
    assert.equal(outcome.content, "I didn't receive a complete response. Please try again.");
  });

  it("offers retry on zero content even when the stream never reported done", () => {
    const outcome = resolveStreamOutcome(false, "");
    assert.equal(outcome.offerRetry, true);
    assert.equal(outcome.content, "I didn't receive a complete response. Please try again.");
  });

  it("offers retry and marks partial content as possibly incomplete when the stream did not finish", () => {
    const outcome = resolveStreamOutcome(false, "Here's what I found so far");
    assert.equal(outcome.offerRetry, true);
    assert.equal(outcome.content, "Here's what I found so far (Response may be incomplete)");
  });

  it("does not offer retry when the stream completed with content", () => {
    const outcome = resolveStreamOutcome(true, "All done!");
    assert.equal(outcome.offerRetry, false);
    assert.equal(outcome.content, "All done!");
  });
});

describe("resolveSendError", () => {
  it("offers retry when an error is thrown before any content streamed in", () => {
    const outcome = resolveSendError(new Error("Failed to send message."), "");
    assert.equal(outcome.offerRetry, true);
    assert.equal(outcome.bannerMessage, "Failed to send message.");
    assert.equal(outcome.displayContent, "Failed to send message.");
  });

  it("does not offer retry when the error interrupted a reply that already had content", () => {
    const outcome = resolveSendError(new Error("stream interrupted"), "partial reply text");
    assert.equal(outcome.offerRetry, false);
  });

  it("swaps in the API-key guidance message without losing the raw banner text", () => {
    const outcome = resolveSendError(
      new Error("Sage is not configured for this account (no API key)."),
      "",
    );
    assert.equal(outcome.offerRetry, true);
    assert.match(outcome.bannerMessage, /Sage is not configured/);
    assert.match(outcome.displayContent, /Open Settings/);
  });

  it("falls back to a generic message for a non-Error throw", () => {
    const outcome = resolveSendError("boom", "");
    assert.equal(outcome.bannerMessage, "Sorry, I had trouble responding. Please try again.");
    assert.equal(outcome.offerRetry, true);
  });
});
