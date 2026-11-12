import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";

import TypingIndicator from "./TypingIndicator";
import { SLOW_REPLY_WORDS, STALLED_REPLY_WORDS, TYPING_SR_WORDS } from "./wait-and-stop";

/** Any live region. The chat's log (role="log", aria-live="polite") announces the dots and words (E9b 4). */
function liveRegions(html: string): string[] {
  return html.match(/role="(status|alert|log)"|aria-live=/g) ?? [];
}

describe("TypingIndicator (E2.1)", () => {
  it("shows only the dots before five seconds", () => {
    const html = renderToString(<TypingIndicator />);
    assert.ok(!html.includes(SLOW_REPLY_WORDS));
    assert.equal(liveRegions(html).length, 0);
  });

  it("shows the words under the dots once Sage is slow, with no live region of its own", () => {
    const html = renderToString(<TypingIndicator slow />);
    assert.ok(html.includes(SLOW_REPLY_WORDS), html);
    // No nested live region: it sits inside the chat's polite log, which is
    // not busy while Sage says nothing, so the log reads the words out. They
    // are content, not an aria-label that is never announced.
    assert.equal(liveRegions(html).length, 0);
    assert.doesNotMatch(html, /aria-live="assertive"|role="alert"/);
    assert.doesNotMatch(html, /aria-label=/);
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

  it("after two minutes says Stop works, in place of the wait words (E7 2)", () => {
    const html = renderToString(<TypingIndicator slow stalled />);
    assert.ok(html.includes(STALLED_REPLY_WORDS), html);
    assert.ok(!html.includes(SLOW_REPLY_WORDS), html);
    assert.equal(liveRegions(html).length, 0);
    assert.doesNotMatch(html, /sr-only/);
  });
});
