import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";

import TypingIndicator from "./TypingIndicator";
import { SLOW_REPLY_WORDS, TYPING_SR_WORDS } from "./wait-and-stop";

function statusRegions(html: string): string[] {
  return html.match(/role="status"/g) ?? [];
}

describe("TypingIndicator (E2.1)", () => {
  it("shows only the dots before five seconds", () => {
    const html = renderToString(<TypingIndicator />);
    assert.ok(!html.includes(SLOW_REPLY_WORDS));
    assert.equal(statusRegions(html).length, 1);
  });

  it("shows the words under the dots once Sage is slow, in the same single status", () => {
    const html = renderToString(<TypingIndicator slow />);
    assert.ok(html.includes(SLOW_REPLY_WORDS), html);
    // One polite status; the words are its content, not an aria-label that a
    // screen reader would not announce when it changes.
    assert.equal(statusRegions(html).length, 1);
    assert.doesNotMatch(html, /aria-live="assertive"|role="alert"/);
    assert.doesNotMatch(html, /role="status"[^>]*aria-label=/);
  });

  it("keeps the dots out of the screen reader's way", () => {
    const html = renderToString(<TypingIndicator slow />);
    assert.match(html, /aria-hidden="true"[^>]*>(<span[^>]*><\/span>){3}/);
  });

  it("says one thing at a time: the hidden words before five seconds, only the wait words after (E2b 4)", () => {
    const before = renderToString(<TypingIndicator />);
    assert.match(before, new RegExp(`class="sr-only">${TYPING_SR_WORDS}<`));
    const after = renderToString(<TypingIndicator slow />);
    assert.ok(!after.includes(TYPING_SR_WORDS), after);
    assert.doesNotMatch(after, /sr-only/);
    assert.ok(after.includes(SLOW_REPLY_WORDS), after);
  });
});
