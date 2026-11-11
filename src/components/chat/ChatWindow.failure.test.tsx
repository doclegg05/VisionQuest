import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToString } from "react-dom/server";

import { composite, contrastRatio, cssTokenValue, parseColor } from "@/lib/wcag-contrast";

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
    // E1c 11: the panel border measured about 1.5:1 in dark; the input border clears 3:1.
    for (const cls of ["min-h-11", "rounded-xl", "border", "border-[var(--chat-input-border)]", "px-4"]) {
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

  it("(10) changes its background on hover, since the text color cannot change", () => {
    const html = renderToString(<FailedReplyActions onRetry={noop} offerRetry setupHref={PROGRAM_SETUP_HREF} />);
    assert.equal(html.match(/hover:bg-\[var\(--chat-sage-mark-bg\)\]/g)?.length, 2);
    assert.doesNotMatch(html, /hover:text-\[var\(--ink-strong\)\]/);
  });

  it("(8) points Try again at the failed text, so a screen reader hears why", () => {
    const html = renderToString(<FailedReplyActions onRetry={noop} offerRetry setupHref={null} describedById="failed-text-err-1" />);
    assert.match(html, /<button[^>]*aria-describedby="failed-text-err-1"/);
  });

  it("renders nothing when there is nothing to offer", () => {
    assert.equal(renderToString(<FailedReplyActions onRetry={noop} offerRetry={false} setupHref={null} />), "");
  });
});

describe("the Try again border in both themes (E1c 11)", () => {
  const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
  for (const theme of ["light", "dark"] as const) {
    it(`reaches 3:1 against the chat background in ${theme}`, () => {
      const border = cssTokenValue(css, "--chat-input-border", theme);
      const ground = cssTokenValue(css, "--chat-area-bg", theme);
      assert.ok(border && ground, "both tokens are defined");
      const ratio = contrastRatio(composite(parseColor(border!), parseColor(ground!)), ground!);
      assert.ok(ratio >= 3, `${theme}: ${ratio.toFixed(2)}:1`);
    });
  }
});

describe("MessageBubble for a failed reply", () => {
  it("(8) gives the text an id that Try again can point at", () => {
    for (const failed of [true, false]) {
      const html = renderToString(<MessageBubble role="assistant" content="Sage is busy." failed={failed} textId="failed-text-err-1" />);
      assert.match(html, /<p[^>]*id="failed-text-err-1"[^>]*>Sage is busy\.</, String(failed));
    }
  });

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
