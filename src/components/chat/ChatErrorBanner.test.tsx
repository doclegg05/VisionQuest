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

  it("points the Settings link at the caller's role settings surface", () => {
    // Staff chat lives in the (teacher) group; /settings would redirect them
    // straight back out, so the banner must link where the role can actually go.
    const html = renderToString(
      <ChatErrorBanner
        message="Sage is not configured for this account (no API key)."
        settingsHref="/teacher/settings"
      />,
    );
    assert.ok(html.includes('href="/teacher/settings"'));
    assert.ok(!html.includes('href="/settings"'));
  });

  it("drops the Settings link entirely for roles with no settings surface", () => {
    const html = renderToString(
      <ChatErrorBanner
        message="Sage is not configured for this account (no API key)."
        settingsHref={null}
      />,
    );
    assert.ok(!html.includes("Open Settings"));
    // Help is never conditional, even when the settings path is.
    assert.ok(html.includes('href="/help"'));
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

  it("gives the Help page link a real 44px touch target, not just text-xs text", () => {
    const html = renderToString(<ChatErrorBanner message="Failed to send message." />);
    const anchorMatch = html.match(/<a [^>]*href="\/help"[^>]*>/);
    assert.ok(anchorMatch, 'expected an <a href="/help"> tag');
    assert.ok(anchorMatch![0].includes("min-h-11"), anchorMatch![0]);
  });
});
