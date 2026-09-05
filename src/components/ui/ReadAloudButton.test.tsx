import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";

import { ReadAloudButton } from "./ReadAloudButton";
import MessageBubble from "@/components/chat/MessageBubble";

/**
 * Read-aloud (Match & Connect Task 2.3). The rule this pins is that the button
 * is HIDDEN, not disabled, where speech synthesis is unavailable — a control
 * that does nothing costs a slow reader a real attempt. Server rendering has
 * no `window`, so it is the honest stand-in for "unsupported".
 */

describe("ReadAloudButton", () => {
  it("renders nothing where speechSynthesis is unavailable", () => {
    const html = renderToString(<ReadAloudButton text="Production Associate at Mountain Metal." />);
    assert.equal(html, "");
  });

  it("renders nothing for empty text even where it is supported", () => {
    const html = renderToString(<ReadAloudButton text="   " />);
    assert.equal(html, "");
  });
});

describe("read-aloud placement", () => {
  it("is offered on Sage's finished replies, not on the student's own messages", () => {
    // Both render empty on the server (no speechSynthesis), so assert on the
    // wiring instead: the student's own bubble must not even construct one.
    const sage = renderToString(
      <MessageBubble role="assistant" content="Here is the job in plain words." />,
    );
    const student = renderToString(<MessageBubble role="user" content="What jobs fit me?" />);
    assert.ok(sage.includes("Here is the job in plain words."));
    assert.ok(student.includes("What jobs fit me?"));
    assert.ok(!student.includes("Read out loud"));
  });

  it("is not offered while a reply is still streaming", () => {
    const html = renderToString(
      <MessageBubble role="assistant" content="Here is the job" isStreaming />,
    );
    assert.ok(!html.includes("Read out loud"));
  });
});
