import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { renderToString } from "react-dom/server";

import { ActionNotice, SUCCESS_CLEARS_AFTER_MS } from "./ActionNotice";

/**
 * The one message an action leaves on the instructor's student page.
 *
 * It sat above the tabs, so a failed Verify far down the Progress tab showed
 * nothing on screen. It is now pinned to the bottom of the viewport, and an
 * error looks like one.
 */

const SOURCE = readFileSync(
  path.join(process.cwd(), "src/components/teacher/student-detail/ActionNotice.tsx"),
  "utf8",
);

const noop = () => {};

function text(html: string): string {
  return html.replace(/<[^>]+>/gu, " ").replace(/&[a-z#0-9]+;/gu, " ").replace(/\s+/gu, " ").trim();
}

describe("ActionNotice: an error", () => {
  const html = renderToString(
    <ActionNotice notice={{ kind: "error", text: "The note was not saved. Try again." }} onDismiss={noop} />,
  );

  it("is announced as an alert", () => {
    assert.match(html, /role="alert"/u);
    assert.doesNotMatch(html, /aria-live="polite"/u);
  });

  it("starts with Not saved:", () => {
    assert.match(text(html), /^Not saved: The note was not saved\. Try again\./u);
  });

  it("is pinned to the bottom of the viewport, not to the top of the page", () => {
    assert.match(html, /class="[^"]*\bfixed\b[^"]*\bbottom-4\b/u);
  });

  it("uses the danger role classes and a warning icon", () => {
    assert.match(html, /\bborder-danger\b/u);
    assert.match(html, /\bbg-danger-soft\b/u);
    assert.match(html, /<svg\b/u);
    assert.match(SOURCE, /WarningCircle/u);
  });

  it("has a Dismiss button at least 44px", () => {
    const button = html.match(/<button\b[^>]*>(?:(?!<\/button>)[\s\S])*Dismiss(?:(?!<\/button>)[\s\S])*<\/button>/u);
    assert.ok(button, html);
    assert.match(button[0], /\bmin-h-11\b/u);
    assert.match(button[0], /\bmin-w-11\b/u);
    assert.match(button[0], /type="button"/u);
  });

  it("uses no raw palette colors", () => {
    assert.doesNotMatch(SOURCE, /\b(?:bg|text|border)-(?:red|green|blue|yellow|amber|emerald|rose|slate|gray)-\d/u);
  });
});

describe("ActionNotice: a success", () => {
  const html = renderToString(<ActionNotice notice={{ kind: "success", text: "Case note saved." }} onDismiss={noop} />);

  it("is a status, not an alert, with the success classes and a check icon", () => {
    assert.match(html, /role="status"/u);
    assert.doesNotMatch(html, /role="alert"/u);
    assert.match(html, /\bborder-success\b/u);
    assert.match(SOURCE, /CheckCircle/u);
    assert.equal(text(html).startsWith("Case note saved."), true, text(html));
  });

  it("clears itself after about six seconds, and only a success does", () => {
    assert.equal(SUCCESS_CLEARS_AFTER_MS, 6000);
    assert.match(SOURCE, /notice\.kind !== "success"\) return/u);
    assert.match(SOURCE, /clearTimeout/u);
  });
});

describe("ActionNotice: nothing to say", () => {
  it("renders nothing", () => {
    assert.equal(renderToString(<ActionNotice notice={null} onDismiss={noop} />), "");
  });
});
