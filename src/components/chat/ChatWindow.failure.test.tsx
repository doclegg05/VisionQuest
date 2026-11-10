import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";

import { FailedReplyActions } from "./ChatWindow";

// E1: a failed send shows one message and one Try again. A student never
// gets a Settings link; staff get one only when Sage is not set up.

describe("FailedReplyActions", () => {
  const noop = () => undefined;

  it("renders one Try again button with a 44px target", () => {
    const html = renderToString(<FailedReplyActions onRetry={noop} settingsHref={null} />);
    assert.equal(html.match(/<button/g)?.length, 1);
    assert.match(html, />Try again<\/button>/);
    assert.match(html, /min-h-11/);
  });

  it("shows no Settings link when none is given, which is the student case", () => {
    const html = renderToString(<FailedReplyActions onRetry={noop} settingsHref={null} />);
    assert.doesNotMatch(html, /Settings|href=/);
  });

  it("links staff to their settings when Sage is not set up", () => {
    const html = renderToString(<FailedReplyActions onRetry={noop} settingsHref="/teacher/settings" />);
    assert.match(html, /href="\/teacher\/settings"/);
    assert.match(html, />Open Settings</);
  });
});
