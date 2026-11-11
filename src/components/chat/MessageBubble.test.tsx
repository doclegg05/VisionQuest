import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToString } from "react-dom/server";
import MessageBubble from "./MessageBubble";

// A reply stopped before any text is saved as "\n\n(Sage stopped here.)" plus
// the 988 help. The leading break must stay in the saved text (it is how a
// Try again knows the row was cut off), but drawn with pre-wrap it would open
// the bubble with an empty gap.
describe("MessageBubble draws a saved stopped reply without a leading gap", () => {
  it("drops leading line breaks on screen only", () => {
    const html = renderToString(<MessageBubble role="assistant" content={"\n\n(Sage stopped here.)"} />);
    assert.match(html, /<p[^>]*>\(Sage stopped here\.\)/);
  });

  it("keeps breaks inside the reply", () => {
    const html = renderToString(<MessageBubble role="assistant" content={"Part one\n\n(Sage stopped here.)"} />);
    assert.match(html, /Part one\n\n\(Sage stopped here\.\)/);
  });
});
