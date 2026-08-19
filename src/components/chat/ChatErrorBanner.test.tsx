import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";

import { ChatErrorBanner } from "./ChatErrorBanner";

describe("ChatErrorBanner", () => {
  it("always links to the Help page and names asking a teacher as a second path", () => {
    const html = renderToString(<ChatErrorBanner message="Failed to send message." />);
    assert.ok(html.includes('href="/help"'), "expected an /help link");
    assert.ok(html.includes("ask your teacher"), "expected 'ask your teacher' phrasing");
  });

  it("shows the raw error text", () => {
    const html = renderToString(<ChatErrorBanner message="Failed to send message." />);
    assert.ok(html.includes("Failed to send message."));
  });

  it("adds a Settings link only for API-key configuration errors", () => {
    const apiKeyHtml = renderToString(
      <ChatErrorBanner message="Sage is not configured for this account (no API key)." />,
    );
    assert.ok(apiKeyHtml.includes('href="/settings"'));

    const genericHtml = renderToString(<ChatErrorBanner message="Failed to send message." />);
    assert.ok(!genericHtml.includes('href="/settings"'));
  });

  it("keeps the Help link even on an API-key error — help is never conditional", () => {
    const html = renderToString(
      <ChatErrorBanner message="Sage is not configured for this account (no API key)." />,
    );
    assert.ok(html.includes('href="/help"'));
  });

  it("renders as an alert region for assistive tech", () => {
    const html = renderToString(<ChatErrorBanner message="Failed to send message." />);
    assert.ok(html.includes('role="alert"'));
  });
});
