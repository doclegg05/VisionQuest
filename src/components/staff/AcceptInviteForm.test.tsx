import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToString } from "react-dom/server";
import { SendCodeButtonView } from "./AcceptInviteForm";

// MEMORY Known Issues: a button that ignores its in-flight state gets tapped
// again, and each tap here would email a new code and void the last one.

describe("SendCodeButtonView", () => {
  it("reads Send my code, is enabled, and meets the 44px target when idle", () => {
    const html = renderToString(<SendCodeButtonView pending={false} sent={false} onClick={() => {}} />);
    assert.match(html, />Send my code</);
    assert.doesNotMatch(html, /disabled=""/);
    assert.match(html, /min-h-11/);
  });

  it("changes its label and disables itself while the code is being sent", () => {
    const html = renderToString(<SendCodeButtonView pending sent={false} onClick={() => {}} />);
    assert.match(html, />Sending…</);
    assert.match(html, /disabled=""/);
    assert.match(html, /aria-busy="true"/);
  });

  it("offers a new code once one was sent", () => {
    const html = renderToString(<SendCodeButtonView pending={false} sent onClick={() => {}} />);
    assert.match(html, />Send a new code</);
  });
});
