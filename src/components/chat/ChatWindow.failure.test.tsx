import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";

import { FailedReplyActions, PROGRAM_SETUP_HREF } from "./FailedReplyActions";
import MessageBubble from "./MessageBubble";

// E1: a failed send shows one message and, when a retry can help, one Try
// again. Only an admin gets a link, and only to Program Setup.

describe("FailedReplyActions", () => {
  const noop = () => undefined;

  it("renders one Try again that looks like a button, with a 44px target", () => {
    const html = renderToString(<FailedReplyActions onRetry={noop} offerRetry setupHref={null} />);
    assert.equal(html.match(/<button/g)?.length, 1);
    assert.match(html, />Try again<\/button>/);
    for (const cls of ["min-h-11", "rounded-xl", "border", "border-[var(--chat-panel-border)]", "px-4"]) {
      assert.ok(html.includes(cls), cls);
    }
  });

  it("shows no link when none is given, which is the student case", () => {
    const html = renderToString(<FailedReplyActions onRetry={noop} offerRetry setupHref={null} />);
    assert.doesNotMatch(html, /Settings|Setup|href=/);
  });

  it("links an admin to Program Setup, with no Try again when a retry cannot help", () => {
    const html = renderToString(<FailedReplyActions onRetry={noop} offerRetry={false} setupHref={PROGRAM_SETUP_HREF} />);
    assert.equal(PROGRAM_SETUP_HREF, "/teacher/manage");
    assert.match(html, /href="\/teacher\/manage"/);
    assert.match(html, />Open Program Setup</);
    assert.doesNotMatch(html, /<button/);
  });

  it("renders nothing when there is nothing to offer", () => {
    assert.equal(renderToString(<FailedReplyActions onRetry={noop} offerRetry={false} setupHref={null} />), "");
  });
});

describe("MessageBubble for a failed reply", () => {
  it("uses the house error pattern so dark mode does not read as plain text", () => {
    const html = renderToString(<MessageBubble role="assistant" content="Sage is off right now." failed />);
    assert.match(html, /flex items-start gap-2/);
    assert.match(html, /<svg[^>]*aria-hidden="true"[^>]*class="shrink-0"/);
  });

  it("draws an ordinary reply without the icon", () => {
    const html = renderToString(<MessageBubble role="assistant" content="Hello" />);
    assert.doesNotMatch(html, /<svg[^>]*class="shrink-0"/);
  });
});
